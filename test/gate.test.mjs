// fork 自测（零依赖）：用假宿主(ctx)直接驱动插件，覆盖 0.5.3 修复的每条路径。
// 运行：node test/gate.test.mjs   （退出码 = 失败数）
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'gate-test-'))
process.env.DSH_HOME = dshHome
// 宿主（官方桌面版）会设置这两个变量；测试里必须清掉，否则解析永远指向真实 profile
delete process.env.DSH_PROFILE_DIR
delete process.env.DSH_PROFILE

const desktopPatch = join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml')
const headlessPatch = join(dshHome, 'profiles', 'headless', 'cordis.patch.yml')
mkdirSync(dirname(desktopPatch), { recursive: true })
mkdirSync(dirname(headlessPatch), { recursive: true })

const auditPath = join(dshHome, 'auto-approve', 'audit.log')
const readAudit = () => (existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '')
const clearAudit = () => writeFileSync(auditPath, '')

function makeHarness({ stream, presetOf }) {
  const routes = new Map()
  const listeners = new Map()
  const effects = []
  const calls = { presetArgs: [] }
  const ctx = {
    llm: { stream },
    permissionPresets: {
      current: (arg) => {
        calls.presetArgs.push(arg)
        if (presetOf) return presetOf(arg)
        return 'auto-approve'
      }
    },
    get: (name) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'agent', model: 'default' }) } : undefined),
    timeout: () => new Promise(() => {}),
    webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) } },
    on: (event, fn) => { listeners.set(event, fn) },
    effect: (fn) => { effects.push(fn) }
  }
  return { ctx, routes, listeners, effects, calls }
}

function makeReq({ method = 'GET', url = '/', headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = { remoteAddress }
  if (body != null) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    setImmediate(() => { req.emit('data', Buffer.from(text)); req.emit('end') })
  }
  return req
}

function makeRes() {
  const res = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res.headers = null
  res.payload = ''
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; res.headersSent = true }
  res.end = (chunk) => { if (chunk) res.payload += String(chunk) }
  res.destroy = () => {}
  return res
}

const SAFE_STREAM = async function* () { yield { type: 'text-delta', text: 'SAFE' }; yield { type: 'finish', reason: { kind: 'stop' } } }

function approvalRequest(over = {}) {
  return {
    agent: { session: { id: 's1', header: { cwd: '/tmp' }, snapshotEvents: () => [] } },
    toolName: 'pwsh',
    reason: 'escalate sandbox to workspace-write: 写入工作区外的备份目录',
    callId: null,
    signal: null,
    ...over
  }
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

// T1：签名修复 —— permissionPresets.current 必须收到 session 对象，而不是 session.events 数组
test('P0 签名：current(session) 而非 current(session.events)', async () => {
  const h = makeHarness({ stream: SAFE_STREAM })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=1')).default
  plugin.apply(h.ctx)
  const handler = h.listeners.get('approval/request')
  assert.ok(handler, 'approval/request 未注册')
  const request = approvalRequest()
  const session = request.agent.session
  const out = await handler(request, async () => 'manual')
  assert.equal(out, 'allowed-once', 'flash SAFE 后应自动放行')
  assert.equal(h.calls.presetArgs.length, 1)
  assert.equal(h.calls.presetArgs[0], session, 'current() 收到的必须是 session 对象')
})

// T2：门控失败必须留痕（不能静默降级）
test('P0 失败留痕：current() 抛错时写 audit', async () => {
  clearAudit()
  const h = makeHarness({ stream: SAFE_STREAM, presetOf: () => { throw new TypeError("Cannot read properties of undefined (reading 'header')") } })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=2')).default
  plugin.apply(h.ctx)
  const out = await h.listeners.get('approval/request')(approvalRequest(), async () => 'manual')
  assert.equal(out, 'manual')
  const log = readAudit()
  assert.match(log, /ERROR\s+permissionPresets\.current failed/, '审计里应有 ERROR 行')
  assert.match(log, /reading 'header'/, '审计里应带原始错误文案')
})

// T3：deny 关键词按词边界匹配（issue #13）
test('P2 deny 词边界：Format-Table 不误判，rm -rf 仍拦', async () => {
  const h = makeHarness({ stream: SAFE_STREAM })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=3')).default
  plugin.apply(h.ctx)
  const handler = h.listeners.get('approval/request')

  let nextCalled = 0
  const out = await handler(approvalRequest({ reason: 'escalate sandbox to workspace-write: 用 Format-Table 看进程列表' }), async () => { nextCalled++; return 'manual' })
  assert.equal(out, 'allowed-once', 'Format-Table 不应命中 deny')
  assert.equal(nextCalled, 0)

  nextCalled = 0
  const out2 = await handler(approvalRequest({ reason: 'escalate sandbox to danger-full-access: rm -rf /tmp/x' }), async () => { nextCalled++; return 'manual' })
  assert.equal(out2, 'manual', 'rm -rf 必须转人工')
  assert.equal(nextCalled, 1)
})

// T4：reasoningEffort 'off' 不被支持时自动降级（issue #8/#22）
test('P1 effort 降级：不支持 off 时改不传 effort 重试', async () => {
  clearAudit()
  let attempts = 0
  const stream = async function* (options) {
    attempts++
    if (options.reasoningEffort === 'off') {
      throw new Error('reasoningEffort "off" is not supported by this model')
    }
    yield { type: 'text-delta', text: 'SAFE' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const h = makeHarness({ stream })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=4')).default
  plugin.apply(h.ctx)
  const out = await h.listeners.get('approval/request')(approvalRequest(), async () => 'manual')
  assert.equal(out, 'allowed-once', '降级后应拿到 SAFE')
  assert.equal(attempts, 2, '应恰好重试一次')
  assert.match(readAudit(), /reasoningEffort=off 不被当前模型支持/)
})

// T5：finish chunk 没有 reason 字段时不得 TypeError（issue #10）
test('P1 chunk.reason 守卫：finish 无 reason 不抛错', async () => {
  const stream = async function* () { yield { type: 'text-delta', text: 'SAFE' }; yield { type: 'finish' } }
  const h = makeHarness({ stream })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=5')).default
  plugin.apply(h.ctx)
  const out = await h.listeners.get('approval/request')(approvalRequest(), async () => 'manual')
  assert.equal(out, 'allowed-once')
})

// T6：一键初始化遇到根节点为 [] 的 patch 必须整体重写（issue #6）
test('P0 一键初始化：[] 占位文件重写为合法预设块', async () => {
  writeFileSync(desktopPatch, '[]\n', 'utf8')
  const h = makeHarness({ stream: SAFE_STREAM })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=6')).default
  plugin.apply(h.ctx)
  const setup = h.routes.get('/api/auto-approve/setup')
  assert.ok(setup, '/setup 未注册')
  process.env.DSH_PROFILE = 'desktop'
  const res = makeRes()
  await setup(makeReq({ method: 'POST' }), res)
  delete process.env.DSH_PROFILE
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.payload)
  assert.equal(payload.ok, true, '应写入成功: ' + res.payload)
  assert.equal(payload.status, 'rewrote-empty')
  const text = readFileSync(desktopPatch, 'utf8')
  assert.match(text, /auto-approve:/, '应含 auto-approve 预设')
  assert.doesNotMatch(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0], /^\[\]$/, '不能残留空列表')
})

// T7：多 profile 同时有 patch 文件时必须拒绝猜测（issue #6 的放大风险）
test('P0 多 profile：ambiguous 时拒绝写入并给出候选', async () => {
  writeFileSync(headlessPatch, '[]\n', 'utf8')
  const h = makeHarness({ stream: SAFE_STREAM })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=7')).default
  plugin.apply(h.ctx)
  const setup = h.routes.get('/api/auto-approve/setup')
  const res = makeRes()
  await setup(makeReq({ method: 'POST' }), res)
  const payload = JSON.parse(res.payload)
  assert.equal(payload.ok, false)
  assert.equal(payload.status, 'ambiguous-profile')
  assert.deepEqual(payload.candidates.sort(), ['desktop', 'headless'])
  assert.equal(readFileSync(headlessPatch, 'utf8'), '[]\n', '不得改动任何 profile 文件')
})

// T8：路由守卫 —— 跨源/跨站一律拒绝，本机同源放行（issue #12）
test('P1 路由守卫：跨源 403、同源 200', async () => {
  const h = makeHarness({ stream: SAFE_STREAM })
  const plugin = (await import(pathToFileURL(join(here, '..', 'src', 'index.mjs')).href + '?t=8')).default
  plugin.apply(h.ctx)
  const events = h.routes.get('/api/auto-approve/events')

  const evil = makeRes()
  await events(makeReq({ headers: { origin: 'http://evil.example', host: '127.0.0.1:7435' } }), evil)
  assert.equal(evil.statusCode, 403)

  const crossSite = makeRes()
  await events(makeReq({ headers: { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:7435' } }), crossSite)
  assert.equal(crossSite.statusCode, 403)

  const remote = makeRes()
  await events(makeReq({ headers: { host: '127.0.0.1:7435' }, remoteAddress: '192.168.1.9' }), remote)
  assert.equal(remote.statusCode, 403)

  const ok = makeRes()
  await events(makeReq({ headers: { origin: 'http://127.0.0.1:7435', host: '127.0.0.1:7435' } }), ok)
  assert.equal(ok.statusCode, 200)
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log('PASS  ' + name)
  } catch (error) {
    failed++
    console.log('FAIL  ' + name + '\n      ' + String((error && error.message) || error).split('\n').join('\n      '))
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed)
