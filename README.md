**简体中文** | [English](README.en.md)

# @xiaochaz/dsh-approval-gate

**DeepSeek Harness 自动审批门控 —— 最小人工介入，安全自动放行、危险转人工（fail-safe）。**

> **社区接续维护版** · 上游 [`dsh-approval-gate`](https://github.com/moon09300731/dsh-approval-gate) 自 2026-08-20 停更，本项目自 2026-10 起接手维护（基线 0.5.2，当前 0.5.4）。
> 与原维护者无隶属关系：原代码 MIT，版权归原作者，见 [`NOTICE`](./NOTICE)。已修「官方桌面版 / 任意 profile 下门控静默失效」等致命问题，并逐条消化上游 issue。
> 来源、差异与维护策略见 [`MAINTAINING.md`](./MAINTAINING.md) 与 [`CHANGELOG.md`](./CHANGELOG.md)。

Flash 模型预判每次沙箱越界：常规操作自动放行，硬风险操作（删除 / 凭据 / 远程 / 系统 / 批量）永远转人工确认；学习沉淀只针对你确认过的操作，并提供界面化人工审查入口。

## ✨ 特性

- ⚡ **Flash 风险预判**：每次沙箱越界由 Flash 模型判定（`SAFE` / `RISKY:<类别>`），可回补操作自动放行
- 🛡️ **硬风险永远人工**：删除、凭据、远程/生产、系统路径、批量不可回补五类操作直接转人工，不计数、不学习
- 🎯 **确认制学习**：同一操作确认 N-1 次后自动放行；沉淀规则携带**操作指纹**，只放行你确认过的操作
- 🧠 **语义同类验证**：措辞变化但意图相同的操作，由 Flash 对照你的确认样本语义判断，不再依赖关键词
- 🔧 **配置热更新**：`allowlist.json` 修改即时生效，无需重启
- ✅ **人工审查 UI**：自动放行时输入框上方出现绿色提示；「审批」视图（轨迹右侧）展示当前会话完整放行时间线
- 📄 **文件改动对比与撤销**：审批涉及的文件可点击查看经典 diff（仅变更行，绿加红删），一键「撤销此改动」投递指令让 AI 恢复文件；支持查看快照占用并一键清除 diff 记录
- 🩺 **失败可诊断**：判定链路异常不再完全静默，会写审计日志并降级人工（上游 0.5.0 的静默 catch 是本项目首先要修的坑）

## 🚀 安装

三种方式任选其一。装完后**必须**完成下一步「配置权限预设」，否则插件装了也不会生效。

### A. 从 GitHub 直装（推荐给他人使用）

```sh
dsh plugin --profile <你的 profile 名> add github:xiaochaZ/dsh-approval-gate#v0.5.3
```

使用官方桌面版（DeepSeek Harness App）时 profile 名通常是 `desktop`；用 `dsh web` 时通常是 `web`。不确定就 `ls ~/.dsh/profiles`。

### B. 本地源码 `link:`（推荐给参与开发/改代码的人）

```sh
git clone https://github.com/xiaochaZ/dsh-approval-gate.git
cd ~/.dsh/profiles/<profile 名>
pnpm add "link:<刚 clone 的绝对路径>"
```

然后在同一份 `package.json` 的 `dsh.profile.bundles` 里加上 `"@xiaochaz/dsh-approval-gate"`，再 `pnpm install`。

### C. 手工替换已装的 npm 版

把 profile 的 `package.json` 里原来的 `"dsh-approval-gate": "^0.5.0"` 换成 `"@xiaochaz/dsh-approval-gate": "link:<路径>"`，`dsh.profile.bundles` 里的条目同步改名，然后 `pnpm install`。

## ⚙️ 配置权限预设（必须）

动态插件**无法**扩展宿主冻结的 presets 表，所以 `auto-approve` 预设必须手工写进 profile 的 `cordis.patch.yml`（文件：`~/.dsh/profiles/<profile 名>/cordis.patch.yml`）。

如果该文件里还没有 `- id: permission` 条目，整段加上：

```yaml
# ── 自动审批模式 ─────────────────────────
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
      auto-approve:
        sandbox: workspace-write
        approval: ask
        name: 自动审批（Flash）
        description: Flash 预判写入/命令是否不可回补：安全自动批准，有风险转人工审批。
    defaultPreset: auto-approve
```

已经有 `- id: permission` 条目时，**只**把 `auto-approve:` 这一块插到 `presets:` 下面（注意缩进对齐到同级预设），并按需修改 `defaultPreset`。

改完**重启** DSH（宿主只在启动时加载插件与预设）。之后会话权限下拉里应出现「自动审批（Flash）」；若想开局即是该模式，确保 `defaultPreset: auto-approve`。

## ✅ 验证是否真的生效

插件最容易的失败方式是「装了、但静默不工作」。按下面三步确认：

1. **组合检查**（不需要启动 App）：

   ```sh
   dsh --profile <profile 名> --dump-config | findstr xiaochaz
   ```

   能搜到 `@xiaochaz/dsh-approval-gate` 这一行，且启动日志里**没有** `skipping profile bundle`。

2. **数据检查**：`~/.dsh/auto-approve/` 下应有 `allowlist.json`、`learning.json`、`audit.log`、`events.jsonl`、`snapshots/`。

3. **活体探针**：在会话里触发一次需要越界的操作（例如让 AI 往工作区外写文件 → 沙箱拒绝 → 带 `sandbox_permissions` 重试）。若自动放行，输入框上方出现绿色提示，且 `audit.log` 末尾立刻多出一行：

   ```
   [<ISO 时间>] ALLOW   <工具> mode=<沙箱模式> (flash-safe)
   ```

   若出现 `ERROR   permissionPresets.current failed: ... → 降级人工`，说明宿主 API 又变了，请带上宿主版本开 issue。

## 📁 数据文件

| 路径（`$DSH_HOME` 默认 `~/.dsh`） | 作用 |
|---|---|
| `auto-approve/allowlist.json` | 配置：`denyKeywords` / `allowRules` / `denyRules` / `hardCategories` 等，热更新 |
| `auto-approve/learning.json` | 确认制学习状态，跨会话持久化 |
| `auto-approve/audit.log` | 追加式审计：每次判定一行 |
| `auto-approve/events.jsonl` | 「审批」视图的时间线数据 |
| `auto-approve/snapshots/` | 文件 diff / 撤销所需快照 |

数据目录与包名无关：从上游版换到本项目（或反过来）**不会**丢历史学习与审计。

## 🧯 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 下拉里没有「自动审批（Flash）」 | `auto-approve` 预设没写进 `cordis.patch.yml`，或没重启 |
| 选了预设但从不自动放行 | 先看 `audit.log`：若是 `ERROR ... → 降级人工`，宿主 API 漂移（开 issue 附宿主版本）；若日志根本没增长，插件没被挂载（跑第 1 步 `--dump-config`） |
| 设置页说「未配置」，但明明配了 | 0.5.0 的路径硬编码 bug（只认 `profiles/web`）；本项目已修 |
| 升级 DSH 后突然失效 | 本插件依赖宿主内部 API（`permissionPresets` / `sessionProjections`），升级后请重跑「验证」三步 |

## ⚠️ 已知限制

- 依赖 DSH 宿主内部 API，宿主小版本升级可能改签名；升级后请重跑验证。
- 动态插件不能扩展宿主冻结的 presets 表 → 「配置权限预设」这一步永远需要手工做一次（上游同样如此）。
- 风险判定交给模型，本质是概率性的：硬风险类别做硬拦截，但仍建议对生产/凭据相关操作保持人工确认。

## 📖 版本与变更

- [`CHANGELOG.md`](./CHANGELOG.md)：每个版本的修复内容，标注对应的上游 PR / issue 编号
- [`MAINTAINING.md`](./MAINTAINING.md)：基线、与原版的差异、内部标识分类、与上游的关系与同步策略

## 📄 License

MIT，详见 [`LICENSE`](./LICENSE)（保留上游原作者版权声明）。本项目为社区接续维护，与原仓库维护者无关。
