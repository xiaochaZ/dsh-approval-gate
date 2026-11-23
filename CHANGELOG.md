# 更新日志

本项目接续维护自 [`moon09300731/dsh-approval-gate`](https://github.com/moon09300731/dsh-approval-gate)（自 2026-10 起由 xiaochaZ 接手；原项目 MIT，版权归原作者）。
基线：上游 `main`（提交 `8419bc37`，version 0.5.2）。npm 上的 0.5.0 落后于 main（缺文件快照 B 层等），因此本项目以 main 为基线。
条目里标注的「上游 PR #N / issue #N」指上游仓库对应的提交与报告。

## 0.5.4

### 致命修复（前端 boot 整页失败）

- **客户端 bundle 的注册 id 改成包名**：`client.js` 里 `window.__ModuleLoader__.load({ id })` 仍是上游的 `dsh-approval-gate`，而宿主的浏览器模块身份是**解析后的包名**（改名后为 `@xiaochaz/dsh-approval-gate`）。两者不等时，这条 row 永远注册不上，客户端模块系统按设计回退到该 row 的单资源 combo URL、把同一份 bundle 再执行一次，第二次 `register()` 抛 `client-modules: duplicate factory registration for "dsh-approval-gate"`；该插件 import 失败，桌面端报 `web boot: 1 entry did not activate` 并弹「应用无法启动」。
  `NAME`、`$DSH_HOME/auto-approve/` 数据目录、UI 插槽 id 不受影响，仍然保持原样（它们不参与模块身份）。
- **新增守卫测试** `tools/check-client-id.mjs`（已并入 `npm test`）：断言 bundle 注册 id 等于包名；也可以 `node tools/check-client-id.mjs <profile>/node_modules` 一次性审计整机所有客户端插件。

### 影响范围

- 只影响前端 boot；服务端判定链路（预设读取、判定模型、审计、路由守卫）与 0.5.3 一致。
- 0.5.3 在 `desktop` profile 下无法启动 Web UI（0.5.2 及更早没有这个问题，因为当时包名与注册 id 同为 `dsh-approval-gate`），升级到 0.5.4 即恢复。
- 事故归因与责任划分见 [docs/INCIDENT-20261022-client-id.md](./docs/INCIDENT-20261022-client-id.md)。

## 0.5.3

首个自持维护版本。目标：修掉「装了但静默不工作」的致命问题，并消化上游长期未合并 PR/issue 中可自决的部分。

### 致命修复（装了但不生效）

- **权限预设读取签名**：审批瀑布里 `permissionPresets.current(session.events)` 传的是事件数组，宿主自 0.2.x 起要求传 `session` → 每次都在 `sessionProjections.stateOf` 抛错，被 `catch` 静默吞掉，插件永远走人工且不报错。改为 `current(session)`，失败时写审计（`ERROR permissionPresets.current failed`）后降级人工。
  覆盖 issue #3 #5 #15 #17 #21 #25（同一根因；宿主报错文案随版本漂移为 `reading 'header'` / `events is not iterable` / `snapshotEvents is not a function`）。
- **profile 路径不再硬编码 `profiles/web`**：解析顺序 `profilePatchPath` 配置 → 自身安装路径（`profiles/<name>/node_modules`）→ `DSH_PROFILE_DIR` → `DSH_PROFILE` → 目录扫描。官方桌面版下设置页不再误报未配置、一键配置不再写错文件。覆盖 issue #2 #25 与 PR #24。
- **多 profile 防误写**：检测到多个 profile 都有 `cordis.patch.yml` 时拒绝猜测写入，返回候选列表并提示显式配置（上游 PR #24 只按环境变量，多 profile 机型仍会猜错）。
- **一键初始化不再写坏 YAML**：profile patch 根节点为 `[]`（或空文件）时整体重写，而不是文本尾部追加（后者生成非法 YAML，宿主起不来、Web UI 也进不去）。写前留 `.bak-approval-gate` 备份。覆盖 issue #6。
- **失败可诊断**：新增 `describeError()`，异常折叠成一行写进审计与事件。

### 判定链路

- **判定模型可配**：新增 `judgeModel`（`provider/model`）配置、`GET /api/auto-approve/models` 与设置页输入框；解析顺序 `judgeModel` → agent 默认模型 → 内置 `deepseek-v4-flash`。覆盖 issue #8 #22 与 PR #11 #20。
- **`reasoningEffort: 'off'` 不被支持时自动降级**：首次失败即改走「不传 effort」并记住该路由，不再次次失败转人工。覆盖 issue #8 #22 与 PR #9。
- **`finish` chunk 的 `reason` 可选守卫**：部分宿主版本不返回 `chunk.reason`，原代码直接读 `.kind` 会 TypeError。覆盖 PR #10。
- **推理文本隔离**：`reasoning-delta` 不再拼进判定文本，避免思考过程污染 SAFE/RISKY 协议解析。覆盖 PR #20 的一部分。
- **判定失败原因进审计**：`withRetry` 失败时回传错误对象，审计与事件里带 `judgeError=`（原来只返回 `{failed:true}`）。覆盖 PR #20。
- **Session API 兼容**：会话事件优先 `session.snapshotEvents()`、回退 `session.events`；工作目录优先 `session.header.cwd`。覆盖 PR #16 #1 与 issue #4。

### 安全

- **插件路由访问守卫**：`/api/auto-approve/*` 只接受本机回环 + 同源请求（校验 `sec-fetch-site`、`Origin` 与 `Host`），非回环来源需在 `apiAllowAddresses` 显式列出。原来这些路由绕过宿主鉴权，任何本机进程或网页都能读审计、改规则、清快照。覆盖 issue #12 与 #4 的 P0-3。
- **默认白名单不再预置宽规则**：0.5.0 默认带 `{ mode: 'workspace-write' }`，等于所有工作区写入不经判定直接放行。默认改为空。覆盖 issue #4 的 P0-1。

### 误判

- **deny 关键词按词边界匹配**：`format` 不再命中 `Format-Table` / `--format`；需要老行为可设 `denyMatch: "substring"`。覆盖 issue #13。

### 工程

- **自测套件** `test/gate.test.mjs`（零依赖、假宿主驱动，8 例）：签名、失败留痕、词边界、effort 降级、`chunk.reason` 守卫、空 patch 重写、多 profile 拒绝、路由守卫。`npm test` 同时跑 `node --check` 与用例。
- **可重建的改造脚本**：`apply-fork.mjs`（服务端 24 处改造）+ `apply-fork-client.mjs`（前端 4 处）+ `patches/*.frag`，用于下次同步上游时复现改造。

### 已知未修

- `learning` 学习池仍可能因人工放行累积「同类样本」，宽泛样本会让后续相似操作直接放行（issue #4 的 P0-1 另一半）。当前可用设置页逐条终止学习项。
- 黑名单词表未按 issue 系统性重整（本轮只改匹配方式，不改词表）。
- `diff` / `revert` 的路径校验未做加固。

## 0.5.2 及更早

上游版本，见 [上游仓库](https://github.com/moon09300731/dsh-approval-gate)。
