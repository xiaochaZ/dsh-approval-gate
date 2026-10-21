// 把上游 main（0.5.2）改造成 fork 基线：P0/P1 修复 + 上游 open PR/issue 中可自决的部分。
// 幂等性：每个替换都要求「锚点恰好出现一次」，重复执行会因 anchor 已变化而报错退出。
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcPath = join(here, 'src', 'index.mjs')
const frag = (name) => readFileSync(join(here, 'patches', name), 'utf8')

let src = readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n')
const applied = []

function replaceOnce(label, oldText, newText) {
  const parts = src.split(oldText)
  if (parts.length !== 2) {
    throw new Error(`[${label}] 锚点命中 ${parts.length - 1} 次（要求恰好 1 次）`)
  }
  src = parts[0] + newText + parts[1]
  applied.push(label)
}

function replaceBetween(label, startMarker, endMarker, newText) {
  const start = src.indexOf(startMarker)
  if (start === -1) throw new Error(`[${label}] 找不到起始锚点`)
  if (src.indexOf(startMarker, start + 1) !== -1) throw new Error(`[${label}] 起始锚点不唯一`)
  const end = src.indexOf(endMarker, start + startMarker.length)
  if (end === -1) throw new Error(`[${label}] 找不到结束锚点`)
  src = src.slice(0, start) + newText + src.slice(end)
  applied.push(label)
}

// 1. 依赖：需要 fileURLToPath 定位自身安装 profile
replaceOnce(
  'imports',
  "import { join } from 'node:path'\n",
  "import { join } from 'node:path'\nimport { fileURLToPath } from 'node:url'\n"
)

// 2. profile patch 路径：不再写死 profiles/web
replaceOnce(
  'profile-resolver',
  "const PROFILE_PATCH_PATH = join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')\n",
  frag('a-profile.frag')
)

// 3. 设置页状态
replaceBetween(
  'getSetupState',
  '/** 检查权限预设是否已配置（供设置页初始化卡片） */',
  '/** 一键初始化：',
  frag('b-setupstate.frag') + '\n'
)

// 4. 一键初始化（issue #6：空 patch 会写坏 YAML）
replaceBetween(
  'ensureAutoApprovePreset',
  '/** 一键初始化：',
  '/** 规则修改：',
  frag('c-ensure.frag') + '\n'
)

// 5. deny 关键词：裸子串 → 词边界（issue #13）
replaceBetween(
  'looksDeny',
  'function looksDeny(text) {',
  '// reason 格式：',
  frag('d-looksdeny.frag') + '\n'
)

// 6. 默认白名单不再预置宽规则（issue #4 P0-1）
replaceOnce(
  'default-allow-rules',
  "// 默认白名单规则：工作区写入（可回补）自动放行\nconst DEFAULT_ALLOW_RULES = [\n  { mode: 'workspace-write', description: '工作区写入（可回补，对应 acceptEdits/workspace-write）' }\n]\n",
  "// 默认白名单规则：默认空（issue #4 P0-1）。\n// 0.5.0 预置了 { mode: 'workspace-write' } 宽规则 → 所有工作区写入不经 flash 判定直接放行，\n// 等于绕过本插件的判定层。0.5.3 起不再预置；若已有 allowlist.json 仍带该条，需自行删除。\nconst DEFAULT_ALLOW_RULES = []\n"
)

// 7. 关键词去尾随空格（词边界匹配依赖 trim）
replaceOnce(
  'deny-keyword-trim',
  "'delete from', 'truncate table', 'truncate ', 'terraform destroy', 'revoke',",
  "'delete from', 'truncate table', 'truncate', 'terraform destroy', 'revoke',"
)

// 8. describeError：把异常折叠成可审计文本
replaceOnce(
  'describeError',
  'function audit(line) {',
  "/** 把未知异常折叠成一行可审计文本（0.5.0 只 console.error，审计与 UI 都看不到原因） */\nfunction describeError(error) {\n  if (!error) return ''\n  if (typeof error === 'string') return error.slice(0, 300)\n  const name = error.name ? String(error.name) : 'Error'\n  const message = error.message ? String(error.message) : String(error)\n  const code = error.code ? ` code=${error.code}` : ''\n  return `${name}${code}: ${message}`.slice(0, 300)\n}\n\nfunction audit(line) {"
)

// 9. 配置规整：judgeModel / profilePatchPath / denyMatch / apiAllowAddresses
replaceOnce(
  'normalizeConfig',
  "  cfg.learning = cfg.learning || { enabled: true }\n  return cfg",
  "  cfg.learning = cfg.learning || { enabled: true }\n  // judgeModel 必须是 provider/model，空或非法一律丢弃（issue #8/#22）\n  if (typeof cfg.judgeModel === 'string' && /^[^/\\s]+\\/[^\\s]+$/.test(cfg.judgeModel.trim())) cfg.judgeModel = cfg.judgeModel.trim()\n  else delete cfg.judgeModel\n  // profilePatchPath：多 profile 机器上显式指定要写入的 cordis.patch.yml\n  if (typeof cfg.profilePatchPath === 'string' && cfg.profilePatchPath.trim()) cfg.profilePatchPath = cfg.profilePatchPath.trim()\n  else delete cfg.profilePatchPath\n  if (cfg.denyMatch !== 'substring' && cfg.denyMatch !== 'boundary') delete cfg.denyMatch\n  if (!Array.isArray(cfg.apiAllowAddresses)) delete cfg.apiAllowAddresses\n  return cfg"
)

// 10. 快照里带上新配置项（设置页需要）
replaceOnce(
  'getRulesSnapshot',
  "      judgeTimeoutMs: config.judgeTimeoutMs || 20000,\n",
  "      judgeTimeoutMs: config.judgeTimeoutMs || 20000,\n      judgeModel: config.judgeModel || '',\n      denyMatch: config.denyMatch === 'substring' ? 'substring' : 'boundary',\n      profilePatchPath: config.profilePatchPath || '',\n      apiAllowAddresses: config.apiAllowAddresses || [],\n"
)

// 11. 配置写入：新增 set 类型
replaceOnce(
  'applyRuleOp',
  '  const list = config[kind]\n',
  "  // 字符串/枚举类配置（判定模型、profile patch 路径、deny 匹配方式、API 允许来源）\n  if (kind === 'judgeModel' || kind === 'profilePatchPath' || kind === 'denyMatch' || kind === 'apiAllowAddresses') {\n    if (op !== 'set') return { ok: false, error: `${kind} 使用 set 操作` }\n    const str = value == null ? '' : String(value).trim()\n    if (kind === 'denyMatch' && str && str !== 'boundary' && str !== 'substring') return { ok: false, error: 'denyMatch 只能是 boundary 或 substring' }\n    if (kind === 'judgeModel' && str && !/^[^/\\s]+\\/[^\\s]+$/.test(str)) return { ok: false, error: 'judgeModel 需为 provider/model 形式' }\n    if (kind === 'apiAllowAddresses') {\n      const addresses = str ? str.split(/[,\\s]+/).filter(Boolean) : []\n      config.apiAllowAddresses = addresses\n      saveJson(ALLOWLIST_PATH, config)\n      audit(`CONFIG  apiAllowAddresses → ${JSON.stringify(addresses)}`)\n      return { ok: true, set: true, value: addresses }\n    }\n    if (str) config[kind] = str\n    else delete config[kind]\n    saveJson(ALLOWLIST_PATH, config)\n    audit(`CONFIG  ${kind} → ${str || '(默认)'}`)\n    return { ok: true, set: true, value: str || null }\n  }\n\n  const list = config[kind]\n"
)

// 12. 路由守卫 + registerRoute 包装（issue #12）
replaceOnce(
  'api-guard',
  "    const PRESET_NAME = 'auto-approve'\n",
  "    const PRESET_NAME = 'auto-approve'\n\n" + frag('i-guard.frag')
)

// 13. 所有插件路由改走守卫
{
  const before = src.split('ctx.webServer.register({').length - 1
  if (before !== 7) throw new Error(`[route-guard] 期望 7 个路由注册点，实际 ${before}`)
  src = src.split('ctx.webServer.register({').join('registerRoute({')
  applied.push('route-guard')
}

// 14. 判定模型 API + 声明/清理
replaceOnce('offModelsRoute-decl', '    let offSetupRoute = null\n', '    let offSetupRoute = null\n    let offModelsRoute = null\n')
replaceOnce(
  'models-route',
  '        console.log(`[${NAME}] 规则/初始化 API 已注册：/api/auto-approve/rules, /setup`)',
  frag('j-modelsroute.frag') + "\n        console.log(`[${NAME}] 规则/初始化/模型 API 已注册：/api/auto-approve/rules, /setup, /models`)"
)
replaceOnce(
  'models-route-cleanup',
  '      if (offSetupRoute) { try { offSetupRoute() } catch (e) {} }\n',
  '      if (offSetupRoute) { try { offSetupRoute() } catch (e) {} }\n      if (offModelsRoute) { try { offModelsRoute() } catch (e) {} }\n'
)

// 15. 判定模型解析（judgeModel 可配）
replaceBetween(
  'resolveJudgeModel',
  '    const resolveModel = () => {',
  '    /**\n     * 底层 flash 调用',
  frag('e-resolvejudge.frag') + '\n'
)

// 16. flash 调用：effort 降级 + chunk.reason 守卫 + reasoning 文本隔离
replaceBetween(
  'callFlash',
  '    /**\n     * 底层 flash 调用',
  '    /**\n     * 单次 flash 判定',
  frag('f-callflash.frag') + '\n'
)

// 17. 重试包装：失败原因回传（judgeError 进审计/事件）
replaceBetween(
  'withRetry',
  '    /**\n     * 通用超时 + 重试包装',
  '    /** 记录一次人工批准的样本',
  frag('g-retry.frag') + '\n'
)

// 18. 审批瀑布：签名（P0）+ 失败不再静默（P3）
replaceOnce(
  'preset-call',
  '          preset = permissionPresets.current(session.events)',
  '          preset = permissionPresets.current(session)'
)
replaceOnce(
  'preset-failure-audit',
  "        } catch (error) {\n          console.error(`[${NAME}] permissionPresets.current failed`, error)\n          return next()\n        }\n",
  "        } catch (error) {\n          // 不能静默失败：0.5.0 只 console.error，用户完全看不出门控没生效（issue #3/#5/#15/#17/#21/#25）\n          const detail = describeError(error)\n          audit(`ERROR   permissionPresets.current failed: ${detail} → 降级人工（本次审批未接管）`)\n          console.error(`[${NAME}] permissionPresets.current failed`, error)\n          return next()\n        }\n"
)

// 19. Session API：snapshotEvents() + header.cwd（issue #16/#1，兼容旧宿主）
replaceOnce(
  'session-api',
  "        // 会话工作目录：相对路径快照解析的基准（DSH SessionHeader.cwd）\n        const sessionCwd = (typeof session.cwd === 'string' && session.cwd) ? session.cwd : ''\n        // B 层：callId 回溯 tool/call 事件取结构化真实路径（edit/write 的 file_path / bash 的 command）\n        // C 层兜底：未命中时 recordApprovalEvent 内部回退 extractFiles(justification)\n        const toolFiles = resolveToolCallFiles(req.callId, session.events)\n",
  "        // 会话事件：0.2.x 起 session.events 不再是稳定访问器（issue #16/#1）→ 优先 snapshotEvents()，再退回 events 数组\n        const sessionEvents = (() => {\n          try {\n            if (typeof session.snapshotEvents === 'function') {\n              const snapshot = session.snapshotEvents()\n              if (Array.isArray(snapshot)) return snapshot\n            }\n          } catch (error) {\n            console.error(`[${NAME}] session.snapshotEvents() failed`, error)\n          }\n          return Array.isArray(session.events) ? session.events : []\n        })()\n        // 会话工作目录：相对路径快照解析的基准（DSH 0.2.x 在 SessionHeader.cwd）\n        const sessionHeader = session.header && typeof session.header === 'object' ? session.header : null\n        const sessionCwd = (sessionHeader && typeof sessionHeader.cwd === 'string' && sessionHeader.cwd)\n          ? sessionHeader.cwd\n          : ((typeof session.cwd === 'string' && session.cwd) ? session.cwd : '')\n        // B 层：callId 回溯 tool/call 事件取结构化真实路径（edit/write 的 file_path / bash 的 command）\n        // C 层兜底：未命中时 recordApprovalEvent 内部回退 extractFiles(justification)\n        const toolFiles = resolveToolCallFiles(req.callId, sessionEvents)\n"
)

// 20. 判定失败原因进审计
replaceOnce(
  'judge-destructure',
  '        const { verdict, category, timedOut, failed } = await judgeWithFlash(toolName, mode, justification)',
  '        const { verdict, category, timedOut, failed, judgeError } = await judgeWithFlash(toolName, mode, justification)'
)
replaceOnce(
  'failed-audit',
  "          audit(`FAILED  ${toolName} mode=${mode || 'none'} → 人工 | ${reason.slice(0, 120)}`)",
  "          audit(`FAILED  ${toolName} mode=${mode || 'none'} judgeError=${judgeError || 'unknown'} → 人工 | ${reason.slice(0, 120)}`)"
)

writeFileSync(srcPath, src, 'utf8')
console.log('applied ' + applied.length + ' patches:')
for (const name of applied) console.log('  - ' + name)
console.log('lines=' + src.split('\n').length)
