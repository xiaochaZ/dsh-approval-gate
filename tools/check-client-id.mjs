#!/usr/bin/env node
// 校验「浏览器端 bundle 的注册 id」是否等于「包名」。
//
// 为什么必须相等
// -------------
// 宿主的客户端模块系统（@deepseek-ai/dsh-client-modules）把**解析后的包名**当作浏览器模块
// 身份（WebBootGraph 的 row.id），bundle 由 `plugins/??<包名>/client.js&rev=…` 提供。bundle 内部
// `window.__ModuleLoader__.load({ id })` 如果注册成别的 id：
//   1. 这条 row 永远「注册不上」（factories 里没有 row.id）；
//   2. 系统按设计**不会重放批量脚本**，而是回退到该 row 的单资源 combo URL，
//      把同一份 bundle 再执行一次；
//   3. 第二次 register() 撞上重复 → 抛 `client-modules: duplicate factory registration for "<id>"`
//      → 该插件 import 失败 → 整页前端 boot 中止（桌面端弹「应用无法启动」）。
//
// 2026-10-22 事故：本仓库改名成 @xiaochaz/dsh-approval-gate 后，client.js 仍注册旧名
// dsh-approval-gate，导致 0.5.3 在 desktop profile 下前端 boot 直接失败。
//
// 用法
// ----
//   node tools/check-client-id.mjs                     # 只校验本仓库（package.json name vs client.js）
//   node tools/check-client-id.mjs <node_modules 路径>  # 审计该目录下所有声明 dsh.client 的包
//
// 退出码：0 = 全部一致；1 = 有不一致或读不到。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

/** 从 bundle 源码里取出 __ModuleLoader__.load({ id }) 的 id。 */
function readBundleId(file) {
  const text = readFileSync(file, 'utf8')
  const at = text.indexOf('__ModuleLoader__.load(')
  if (at === -1) return { id: undefined, reason: '没有 __ModuleLoader__.load( 调用' }
  const window = text.slice(at, at + 400)
  const m = /id:\s*['"]([^'"]+)['"]/.exec(window)
  if (!m) return { id: undefined, reason: '从 __ModuleLoader__.load(...) 里解析不出 id' }
  return { id: m[1] }
}

/** 解析包的 client bundle 路径（exports['./client'] 优先，再回退常见位置）。 */
function resolveClientBundle(dir, pkg) {
  const candidates = []
  const exp = pkg.exports && (pkg.exports['./client'] || pkg.exports['./client.js'])
  if (typeof exp === 'string') candidates.push(join(dir, exp))
  else if (exp && typeof exp === 'object' && typeof exp.default === 'string') candidates.push(join(dir, exp.default))
  candidates.push(join(dir, 'client.js'), join(dir, 'lib', 'client.js'), join(dir, 'dist', 'client.js'))
  return candidates.find((p) => existsSync(p))
}

function checkOne(name, dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return undefined
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return undefined
  }
  if (!(pkg.dsh && pkg.dsh.client)) return undefined
  const file = resolveClientBundle(dir, pkg)
  if (file === undefined) return { name, id: undefined, ok: false, reason: '声明了 dsh.client，但找不到 client bundle 文件' }
  const { id, reason } = readBundleId(file)
  return { name, id, ok: id === name, reason }
}

const arg = process.argv[2]
const rows = []

if (arg === undefined) {
  // 单包模式：校验本仓库
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const row = checkOne(pkg.name, repoRoot)
  if (row === undefined) {
    console.error('check-client-id: package.json 没有 dsh.client 声明，无从校验')
    process.exit(1)
  }
  rows.push(row)
} else {
  // 扫描模式：审计一个 profile 的 node_modules
  const nm = resolve(arg)
  if (!existsSync(nm)) {
    console.error(`check-client-id: 目录不存在：${nm}`)
    process.exit(1)
  }
  const names = []
  for (const entry of readdirSync(nm)) {
    if (entry.startsWith('.')) continue
    const full = join(nm, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(full)) names.push(`${entry}/${sub}`)
    } else {
      names.push(entry)
    }
  }
  for (const name of names) {
    const row = checkOne(name, join(nm, name))
    if (row !== undefined) rows.push(row)
  }
}

const bad = rows.filter((r) => !r.ok)
for (const r of rows) {
  if (r.ok) continue
  const got = r.id === undefined ? `（读不到：${r.reason}）` : `bundle 注册成 "${r.id}"`
  console.error(`✗ ${r.name}: ${got} ≠ 包名`)
}

if (bad.length > 0) {
  console.error(`\ncheck-client-id: ${String(bad.length)} 个客户端插件的注册 id 与包名不一致。`)
  console.error('把 client.js 里的 `id:` 改成 package.json 的 `name`（其它内部标识可以保持原样）。')
  process.exit(1)
}

console.log(`check-client-id: ${String(rows.length)} 个客户端插件，注册 id 全部等于包名 ✓`)
