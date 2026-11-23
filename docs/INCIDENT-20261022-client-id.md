# 事故归因调查报告：桌面端「应用无法启动」（2026-10-22）

| 项 | 内容 |
|---|---|
| 事故等级 | P1（主界面不可进入；后端正常，数据无损） |
| 发生时间 | 2026-10-22 23:21:12 / 23:21:39（两次启动均失败） |
| 影响面 | `desktop` profile 的 Web 前端整体不可启动；服务端与全部数据文件无异常 |
| 恢复方式 | 用户在崩溃弹窗上选择「禁用第三方插件、备份 profile patch 并重启」（23:22） |
| 修复时间 | 2026-10-22 23:29（`client.js` 一行 + 守卫测试 + 文档更正） |
| 报告依据 | 两份 crash log、renderer console 捕获、宿主 `dsh-client-modules` 源码与文档、profile 配置与备份、32 个客户端插件的 id 全量审计 |

---

## 0. 摘要

**一句话结论：改包名时，同一件"身份"在两层里各存了一份，只改了宿主认得的那一份，bundle 自己认的那一份没人改，而没有任何东西会提前告诉你这两份必须一样。**

- **直接原因**：`client.js` 里 `window.__ModuleLoader__.load({ id })` 注册的是旧名 `dsh-approval-gate`，而宿主的浏览器模块身份是**解析后的包名** `@xiaochaz/dsh-approval-gate`。两者不等 → 该 row 永远"注册不上" → 模块系统回退到该 row 的单资源 URL 再执行一遍同一份 bundle → 第二次 `register()` 抛 `duplicate factory registration` → 该插件 import 失败 → 整页前端 boot 中止。
- **第一责任**：2026-10-22 凌晨那轮改动（执行方为本 harness 的 agent 会话，需求由用户提出）。错在三处：① 改包名时漏改 bundle 自注册 id；② 把这一处误判为"可保持原样"并写进 `FORK.md`；③ 在**没有做过一次真实页面启动**的情况下给出"配置已就绪、只差重启"的结论。
- **结构性责任**：`FORK.md` 的验证清单只有宿主侧（`--dump-config` + 数据文件 + 活体探针），没有"重启后页面能不能起来"这一项。**换任何人按这份清单执行，都会得到 PASS，也都会在重启时炸。** 这是本次最该修的东西。
- **放大器（非过错方）**：宿主 `@deepseek-ai/dsh-client-modules` 不校验注册 id 归属、把"id 不匹配"当成"batch 没注册上"来处理、且任一插件失败即整页 boot 抛错；报错文案指向旧 id 而不是"row 期望的 id"，把真正的病因藏了一层。
- **历史诱因**：上游 `client.js` 把自己的包名硬编码在 bundle 里，且没有任何关于"id 必须等于包名"的契约文档。上游没有承诺支持改名，这算技术债而非违约。
- **后果放大**：桌面端的「禁用第三方插件」恢复动作清空了 `dsh.profile.bundles`（全部第三方插件被关；仅 10-21 快照口径就有 24 个 bundle，另有其后新增的 wake-bridge / IM 连接），只备份了 `cordis.patch.yml`，`package.json` 没有备份。

---

## 1. 时间线（本地时间 Asia/Shanghai）

| 时间 | 事件 | 证据 |
|---|---|---|
| 10-21 23:42 | profile 快照：`bundles` 中含旧包 `dsh-approval-gate`；当时包名与注册 id 同为 `dsh-approval-gate`，能正常启动 | `profiles/desktop/package.json.bak-20261021-234252` |
| 10-22 02:05:48 | 插件管理器备份 profile，准备把插件切到 `link:` 的 fork 版本 | `profiles/desktop/.plugin-backup-20261022-020548/`（内含旧 npm 包副本、当时的 composed `cordis.yml` 第 1454-1455 行 `- id: dsh-approval-gate`） |
| 02:18:22 | fork 0.5.3 源码落地（`src/index.mjs`、`client.js`、`FORK.md`…），**`client.js` 保留上游 id** | 仓库 commit `02f47ec`、`7ad2c44` |
| 02:18 | `package.json` 依赖改为 `"@xiaochaz/dsh-approval-gate": "link:C:/Users/xxj09/Documents/dsh/xiaochaz-approval-gate"`；**包名自此变为 scoped** | `profiles/desktop/package.json` 第 17 行 |
| 02:20:06 | `FORK.md` 写入"内部标识为什么保持原样"，明确声称"客户端插件 id 也未改名"且安全 | `FORK.md`（修正前） |
| 05:42:36 | `pnpm install` 落盘，`pnpm-lock.yaml` 只剩 scoped 包，旧包从 `node_modules` 移除 | `pnpm-lock.yaml` 第 35-37 行 |
| 白天 | 宿主侧验证：`--dump-config` 确认挂载行是 `@xiaochaz/dsh-approval-gate`、体检 1–4 段全 PASS；结论记为"唯一未完成：重启 App" | memory handoff `state` 条目 |
| **23:21:12** | 第一次启动：前端 boot 失败，桌面弹「应用无法启动」 | `crash-2026-10-22T15-21-12-081Z-web-boot.log` |
| **23:21:39** | 重试启动，同样失败 | `crash-2026-10-22T15-21-39-377Z-web-boot.log`（与上一份内容一致，979 B） |
| 23:22:02 | 恢复动作改写 `package.json`：`bundles` 削成只剩 `@deepseek-ai/dsh-base` + `dsh-web-app` | `profiles/desktop/package.json`（现 1235 B） |
| 23:22:24 | 恢复动作备份并重写 profile patch（60 KB → 661 B） | `cordis.patch.yml.bak-1792682522581` |
| 23:22:34 | 启动成功（第三方插件全部关闭状态） | 用户确认 |
| 23:29 | 本轮定位与修复：`client.js` id 改为包名、新增 id 守卫测试、更正文档；`npm test` 8/8 通过 | 本报告 §6 |

**关键事实**：两次启动后端都成功了。23:21:34–23:21:44 之间 `task-board` / `dsh-im-connect` / `auto-memory` / `dsh-usage` / `wake-bridge` 都在正常写状态文件；失败的是**浏览器侧**。

---

## 2. 技术根因：完整失败链

### 2.1 宿主契约

`@deepseek-ai/dsh-client-modules` 的浏览器模块身份 = **解析后的包名**（该包 `README.zh.md` 原文：「解析出的 manifest（元数据清单）包名作为浏览器模块身份」）。bundle 由 `plugins/??<包名>/client.js&rev=…` 提供，按 row 分组进 combo 脚本。

### 2.2 实际发生了什么

```
manifest row.id = "@xiaochaz/dsh-approval-gate"
        │
        ├─ 批量 combo 执行 client.js
        │     └─ __ModuleLoader__.load({ id: 'dsh-approval-gate' })   ← 注册成旧名
        │
        ├─ factories.has("@xiaochaz/dsh-approval-gate") → false      ← row 判定"未注册"
        │
        ├─ 按设计不重放批量脚本，回退到该 row 的单资源 combo URL
        │     └─ 同一份 client.js 第二次执行
        │           └─ register({ id: 'dsh-approval-gate' })         ← 撞车
        │                 └─ throw "client-modules: duplicate factory registration for \"dsh-approval-gate\""
        │
        ├─ 该 row 的 import 被拒 → modules.importError(row) 有值
        │
        └─ 前端 boot 收尾：任何非 active entry → throw "web boot: 1 entry did not activate"
              └─ 桌面端捕获 → 弹窗「应用无法启动」
```

对应代码（`app.asar` 内 `@deepseek-ai/dsh-client-modules/lib/client.js`）：

- `register()`：只查重，不校验 id 是否属于 manifest 里存在的 row；
- `arrive()`：`preferred`（批量 URL）加载成功但 `factories.has(id)` 为假时，仍然会 `attempt(fallback)`（该 row 自己的 URL），并明确注释"a batch script that loaded without registering this row … is never re-executed"，于是必然二次执行同一份 bundle；
- 前端 boot 汇总函数：`if (i.fiber === void 0) r.push(\`${n}: import failed (see console for the import error)\`)` 后 `throw new Error("web boot: … did not activate")`。

### 2.3 为什么"就一个字符串"能整页起不来

因为这一个字符串是**模块身份**，而身份有两份副本、分属两层：

| 层 | 载体 | 谁读它 | 备份/校验 |
|---|---|---|---|
| 宿主侧 | manifest `row.id`（来自包名） | 模块系统、combo URL、样式归属 | 有：`--dump-config` 能看到 |
| bundle 侧 | `client.js` 里 `load({ id })` 的字符串 | 模块系统注册表 | **没有任何校验，dump 里也看不到** |

改名时第一层自动跟着变（它本来就是从包名推导的），第二层是手写常量。**没有任何工具、模板、类型或构建步骤要求两者一致**；宿主的检测方式又是"事后看 factories 里有没有"，于是失败表现为一个和真实原因隔了一层的 duplicate 报错。

---

## 3. 归因分析

### 3.1 责任矩阵

| # | 主体 | 具体行为 | 与事故的关系 | 定性 | 是否"做错" |
|---|---|---|---|---|---|
| 1 | 2026-10-22 凌晨那轮改动（执行：本 harness 的 agent 会话；需求：用户） | 把包名改成 `@xiaochaz/dsh-approval-gate`，同步改了依赖、`cordis.patch.yml` 的 `name`、文档，但漏改 `client.js` 的自注册 id | **直接原因**（触发器） | 人因疏漏 | **是** |
| 2 | 同上 | `FORK.md` 写「客户端插件 id 可保持原样」，把 UI 插槽 id / 数据目录（确实可保留）与模块注册 id（必须改）混为一类 | **诱因**（把错误固化成"设计"） | 认知错误且未经验证 | **是** |
| 3 | 同上 | 验证只做宿主侧（`--dump-config`、数据文件、活体探针），结论"只差重启" | **漏检**（本次事故能发生的必要条件） | 验证设计缺陷 | **是** |
| 4 | `FORK.md` 的验证清单 | 没有"重启后页面能否起来"这一项 | **结构性责任**：换谁执行都会误判 PASS | 流程缺陷 | **是**（清单） |
| 5 | 上游 `moon09300731/dsh-approval-gate` | `client.js` 手写硬编码自己的包名；无"id 必须等于包名"的任何说明 | 隐性技术债（改名/二次打包必踩） | 质量债，非违约 | 有责任，非本次过错 |
| 6 | 宿主 `@deepseek-ai/dsh-client-modules` | ① `register()` 不校验 id 归属；② 把"id 不匹配"当"batch 未注册"处理，回退导致二次执行；③ 任一插件失败即整页 boot 抛错；④ 报错文案指向旧 id，与病因隔一层 | **放大器**：命名错误 → 整页不可用 + 误导性报错 | 健壮性/可诊断性问题 | 无过错（契约如此），但有质量问题 |
| 7 | DSH 桌面端恢复流程 | 「禁用第三方插件」清空 `bundles`（全部第三方插件关闭），只备份 `cordis.patch.yml`，`package.json` 无备份；弹窗不给 import 错误本体 | **后果放大**：一个插件坏 → 全部第三方插件被关，且不可一键还原 | 产品设计问题 | 无过错，有改进空间 |
| 8 | 用户的操作 | 在不可进入 UI 的前提下点「禁用第三方插件」重启；提出改包名需求 | 标准恢复动作 / 合理需求 | — | **否** |

### 3.2 直接回答"是谁做错了"

1. **做错的是 fork 侧的这次改名，执行方是 2026-10-22 凌晨那轮 agent 会话（也就是本 harness 里的我）。** 三条具体错误见上表 #1–#3，其中 #3 是我在事实层面下了过早的结论——"配置已就绪"是对的，"可以重启了"是没验证的。
2. **但事故的可复现性来自流程，而不是某个人的手滑**：验证清单里压根没有前端启动项。这意味着同类事故不是"这次失误"，而是"迟早会再发生一次"。#4 的可修复价值高于 #1。
3. **上游有次要责任**：硬编码 + 无契约文档，让每一个 fork 都背着同一个坑。#5。
4. **宿主不是过错方，但是最有效率的改进点**：#6 的三条里任意一条做到，本次事故就只会变成一个"插件加载失败、点重试"的可恢复状态，而不是整页黑屏 + 误导性报错。

### 3.3 为什么"一直没人发现"

- 契约只写在宿主包的**实现细节**章节（`README.zh.md` 的实现部分），没有出现在插件开发指南、脚手架模板、lint 或 `--dump-config` 输出里；
- 上游是**手写** `client.js`（不是打包产物），官方包的 id 是构建时注入的，天然一致——所以"官方能跑"不能证明"手写也能跑"；
- 0.5.3 之前的验证方式都是"插件能不能工作"，而这次是"装了之后页面能不能起来"，是两个不同的失败面；
- 报错跨层：弹窗报 entry 名（`@xiaochaz/…`），console 报旧 id（`dsh-approval-gate`），两处信息不在一处，不主动去翻 console 根本无法关联。

---

## 4. 影响评估

| 维度 | 影响 |
|---|---|
| 可用性 | 前端整体不可进入约 11 分钟（23:21:12 → 23:22:34 恢复启动） |
| 数据 | 无损失。会话、审计、`auto-approve/*` 配置、快照均未受影响；`NAME` 与数据目录未改名 |
| 功能 | 恢复后所有第三方插件均关闭（10-21 快照口径 24 个 bundle，另有 wake-bridge / IM 连接等后续新增项），需手工逐个开回 |
| 配置 | `cordis.patch.yml` 由 60 KB 重写为 661 B（原文已备份）；`package.json` 的 `bundles` 列表被清空且**无备份**，需从 10-21 快照 + 现有依赖重建 |
| 用户信任成本 | 一次「应用打不开」的严重观感，实际只源于一个字符串 |

---

## 5. 根因树

```
桌面端「应用无法启动」
├── 触发：client.js 注册 id ≠ 包名（本 fork 改名未闭环）
│   ├── 为什么没改：改名清单里没有这一项（改了 name / dep / patch name / 文档）
│   ├── 为什么清单没有：该 id 的作用（模块身份）从未被文档化
│   └── 为什么误判为"可保留"：把 UI 插槽 id 的"可保留"结论外推到模块注册 id
├── 为什么没被测出：验证只覆盖宿主侧，无前端 boot 检查
│   └── 为什么缺口存在：0.2.x 之后前端是独立失败面，验证清单未随之更新
├── 为什么变成整页失败：宿主任一 entry 失败即 throw；且回退路径二次执行同一 bundle
└── 为什么后果扩大：恢复流程清空 bundles 且不备份 package.json
```

---

## 6. 已执行的纠正措施（2026-10-22 23:29）

| 措施 | 内容 | 验证 |
|---|---|---|
| 修复 | `client.js` 的 `id` 改为 `@xiaochaz/dsh-approval-gate`，并加注释说明约束 | `node --check` 通过；32 个客户端插件 id 全量审计 0 不一致 |
| 守卫 | 新增 `tools/check-client-id.mjs`（零依赖，单包模式 + 整机扫描模式），并入 `npm test` | `npm test` 8/8 通过；两模式均 exit 0 |
| 文档 | `FORK.md`「内部标识」按"必须等于包名 / 可保持原样"重写，写明失败链；补"从上游覆盖 `client.js` 后需手工改回 id"的提醒 | 已改 |
| 记录 | `CHANGELOG.md` 增 0.5.4 段（含报错原文，便于检索）；`package.json` 版本升至 0.5.4 | 已改 |

---

## 7. 待办（按性价比排序）

1. **给宿主提 issue（最高性价比）**：三条——
   - `register()` 校验 `id` 是否存在于 manifest row 集合，不存在直接报 `bundle registered "<A>" but no row expects it`；
   - `arrive()` 在"batch 已执行过该 package 产物但未按 row.id 注册"时，不再回退重跑同一 bundle，而是直接抛"id 不匹配"；
   - 前端 boot 对**可选插件**失败不应整页 throw，应降级为"该插件不可用 + 重试入口"（DSH 插件页本就有重试能力）。
   最小复现：复制任一客户端插件，`package.json` 改名、`client.js` 的 `id` 保留旧名，装进 profile 启动即可 100% 复现。
2. **FORK.md 验证清单增加"前端 boot 检查"**：重启后至少确认页面进得去、目标插件在「设置 → 插件」里是 active；`--dump-config` 不能替代。
3. **`docs/GUIDE.md` 增加「改包名 checklist」**：`package.json` name / 依赖 specifier / `cordis.patch.yml` 的 `name` / `client.js` 的 `id` / 文档与 README 徽章 / `npm test`。
4. **发布 0.5.4**（`git tag v0.5.4`），并在 release 说明里点明 0.5.3 的桌面端启动缺陷与升级路径。
5. **恢复 profile**：按 10-21 快照 + 现有依赖重建 `bundles`，重新启用第三方插件，然后用 `node tools/check-client-id.mjs <profile>/node_modules` 复检整机。
6. （建议给 DSH 桌面端）恢复流程在禁用第三方插件前备份 `package.json`，并提供"恢复到上次配置"。

---

## 8. 证据索引

| 证据 | 位置 |
|---|---|
| 崩溃日志（两份，内容一致，979 B） | `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-2026-10-22T15-21-12-081Z-web-boot.log`、`…15-21-39-377Z-web-boot.log` |
| 报错原文 | `web boot: 1 entry did not activate` / `@xiaochaz/dsh-approval-gate: import failed (see console for the import error)` |
| renderer console | `client-modules: duplicate factory registration for "dsh-approval-gate" (bundle executed twice without invalidate?)` @ `dsh-app://app/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=383856c41d64:708` |
| 宿主实现 | `app.asar` → `@deepseek-ai/dsh-client-modules/lib/client.js`：`register()`（查重不校验归属）、`arrive()`（回退重跑）、前端 boot 汇总 `bZ()`（任一 entry 失败即 throw） |
| 宿主契约 | `@deepseek-ai/dsh-client-modules/README.zh.md`：「解析出的 manifest 包名作为浏览器模块身份」 |
| 惯例核验 | `app.asar` 内 8 个官方客户端 bundle 的 `load({ id })` 全部等于其包名 |
| 全量审计 | 32 个客户端插件中，事故前唯一不一致者为 `@xiaochaz/dsh-approval-gate`（注册成 `dsh-approval-gate`）；修复后 0 不一致 |
| 配置备份 | `profiles/desktop/cordis.patch.yml.bak-1792682522581`（60 021 B，崩溃前原文）；`package.json.bak-20261021-234252`（含旧 `bundles` 列表） |
| 改名前后对照 | `.plugin-backup-20261022-020548/`（旧 npm 包、旧 composed `cordis.yml`）、`pnpm-lock.yaml`（仅剩 scoped link） |

---

## 9. 结论

**事故不是"插件有 bug"，而是"改名这件事在系统里有两处副本，改动只覆盖了其中一处，而校验、报错、恢复三道环节都没有指向真正的差异"。**

- 人手层面：这轮改名的执行方（本 harness 的 agent 会话）确实做错了——漏改一个常量、把该常量误判为可保留、并在未做页面启动验证时下了"就绪"的结论。
- 流程层面：验证清单缺少前端启动项，使这个错误**必然**逃过所有宿主侧检查；这比单个字符串更要紧。
- 系统层面：上游的硬编码、宿主的静默契约与整页失败策略、桌面端不留 `package.json` 备份的恢复动作，共同把一个"一个字符串"的问题放大成"应用打不开、所有第三方插件全关"。

纠正措施已落地（§6），剩余项按 §7 推进。新增的 `tools/check-client-id.mjs` 是本次唯一能**在事故前**发现该问题的检查——它已经在 `npm test` 里了。
