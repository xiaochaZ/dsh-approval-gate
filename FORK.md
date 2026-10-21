# 关于本项目（Fork 说明）

本仓库是 [`moon09300731/dsh-approval-gate`](https://github.com/moon09300731/dsh-approval-gate) 的**社区维护 fork**，包名 `@xiaochaz/dsh-approval-gate`。

## 为什么 fork

上游自 **0.5.0**（npm 发布于 2026-08-18）后停止维护：

- GitHub `main` 最后提交 `8419bc37`（2026-08-20），此后无新提交、无 release、无新版本；
- 9 个 open PR 全部未被合并（含修同一个致命 bug 的多份重复提交）；
- 12+ 个 open issue 无一有维护者回应，其中包括 [#25](https://github.com/moon09300731/dsh-approval-gate/issues/25)——与本项目 fixes #1 完全一致的「换到官方桌面版后门控静默失效」。

于是我们接管维护：把上游最新代码 + 社区 PR + 我们自己定位的修复合成一个可用版本，并按 issue 逐条消化。

## 基线

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/moon09300731/dsh-approval-gate` |
| 基线版本 | 上游 `main`（提交 `8419bc37`，package version 0.5.2） |
| 基线提交 | `8419bc37`（2026-08-20） |
| 本 fork 版本 | `0.5.3` |
| 许可 | MIT（沿用上游，保留原作者版权声明，见 `LICENSE`） |

## 与原版的差异

全部差异记录在 [`CHANGELOG.md`](./CHANGELOG.md)。概括：

1. **修复：官方桌面版 / 任意 profile 下门控静默失效**（`permissionPresets.current()` 传参签名不匹配，异常被 catch 吞掉）。
   —— 这等价于上游 issue #25 与 PR #18。
2. **修复：profile 路径硬编码 `profiles/web`**，导致 `desktop`（官方桌面版）下设置页误报「未配置」、一键配置写错文件。
   —— 这等价于上游 PR #24。
3. **改进：失败不再完全静默**，判定失败写审计日志并降级人工，可由 `audit.log` 自诊断。
4. 合并社区 PR 中仍然有效的修复项（逐条列在 `CHANGELOG.md`，标注对应上游 PR 编号）。

## 内部标识为什么保持原样

`src/index.mjs` 的 `NAME = 'dsh-approval-gate'`、客户端插件 id、UI 插槽 id、`$DSH_HOME/auto-approve/` 数据目录**均未改名**：

- 数据目录与包名无关，改包名不会搬移或丢失 `allowlist.json` / `learning.json` / `audit.log`；
- UI 插槽 id 与前端状态键保持稳定，从上游版平滑替换时界面无需重建状态；
- 审计前缀不变，历史审计可持续追加。

## 与上游的同步策略

上游已停更，**不再做机械同步**。若上游恢复更新（有 PR 合并或新版本发布），处理原则：

1. 先读上游 diff，按 `CHANGELOG.md` 里记录的修复清单逐项比对，避免把已修的 bug 改回去；
2. 上游新增的功能特性优先并入，本 fork 的修复保持为独立提交，便于三方合并；
3. 每次并入后必须跑一遍「验证」章节的检查（`--dump-config` + 数据文件 + 活体探针）。

## 贡献

Issue / PR 都欢迎，尤其：

- 宿主 DSH 版本升级后的签名漂移（本插件依赖 `permissionPresets` / `sessionProjections` 内部 API）；
- 风险判定误报/漏报样本（附 `audit.log` 片段与操作类型）。

提交前请确保 `npm test`（即两个入口的 `node --check`）通过，并说明测试过的 DSH 版本与 profile 类型（`web` / `desktop`）。

## 本 fork 的改造方式（可重建）

上游 10 个 open PR 全部 **无法** `git apply` 到 main（PR 基线 `9e0eefd` 早于 `8419bc37`，patch context 已漂移），所以改造以「锚点替换脚本」形式保存，可直接复现、也可在上游再更新时重跑：

- `apply-fork.mjs`：服务端 `src/index.mjs` 的 24 处改造。每处都要求锚点**恰好命中 1 次**，改完自动 `node --check`，失败即中止（不会半途写坏）。
- `patches/*.frag`：各改造点的完整新代码（profile 解析、设置页状态、一键初始化、词边界匹配、判定模型解析、flash 调用、重试包装、路由守卫、模型 API）。
- `apply-fork-client.mjs`：前端 `client.js` 的 4 处改造（判定模型输入框、初始化卡片显示实际路径与歧义提示）。

同步上游新版本时的步骤：

1. 取上游新 tarball 覆盖 `src/`、`client.js`、`cordis.patch.yml`、`README*.md`、`LICENSE`；
2. 跑 `node apply-fork.mjs && node apply-fork-client.mjs`（锚点漂移会立刻报错，据此更新对应 `.frag`）；
3. `npm test`；
4. 更新版本号与 CHANGELOG。

## 上游关系

本仓库是 GitHub 意义上的**真 fork**（`forked from moon09300731/dsh-approval-gate`），历史建立在上游 `main`（`8419bc37`）之上，因此可以：

```sh
git remote add upstream https://github.com/moon09300731/dsh-approval-gate.git   # 首次
git fetch upstream && git log --oneline HEAD..upstream/main                      # 看上游有没有新提交
git diff upstream/main --stat                                                    # 看本 fork 相对上游的全部改动
```

若上游恢复维护，可直接在本仓库开 PR，或用 rebase 把本 fork 的提交叠到新的上游 `main` 上（若 `src/` 结构变化大，退回上面的锚点脚本流程更稳）。上游 issue #25 下留有一条根因说明（2026-10-22），供后来者检索。

## 已知未修（欢迎 PR）

- 学习池（`learning`）仍会因人工放行累积同类样本，宽泛样本会让后续相似操作直接放行（上游 issue #4 P0-1 的另一半）。
- 黑名单词表未系统性重整（本 fork 只改匹配方式为词边界）。
- `diff` / `revert` 的路径校验未加固（路径来自事件记录，未做工作区约束校验）。
- 路由守卫目前是「回环 + 同源」策略；若宿主将来提供官方鉴权 helper，应改为复用宿主鉴权。