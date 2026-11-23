# 贡献指南

## 提 Issue

- 用 issue 模板，必须写清 **DSH 版本**、**profile 类型**（`web` / `desktop`）、**插件版本**。
- 「门控没生效 / 没弹审批」类问题：附 `audit.log` 片段（默认在 `~/.dsh/auto-approve/audit.log`）。
- 安全类问题**不要**开公开 issue，见 [`SECURITY.md`](./SECURITY.md)。

## 提 PR

- 目标分支 `main`，一个 PR 只做一件事。
- 本地先跑 `npm test`（两个入口 `node --check` + 客户端 bundle id 校验 + 8 条用例），把输出贴在描述里。
- 修的是上游遗留问题：标题写 `fix upstream#<号>`，正文贴上游 issue/PR 链接。
- 改了 `src/index.mjs`：说明改的是哪个锚点，并同步更新 `patches/*.frag` 与 `apply-fork.mjs`——否则下次同步上游时这次修改会丢。
- 改了 `client.js`：必须跑 `node tools/check-client-id.mjs`；`__ModuleLoader__.load({ id })` 的 id 必须等于包名，否则整页 web boot 会失败。

## 审核承诺

- **7 天内首次回应**。超过 7 天没动静，请在 PR 里 @ 维护者。
- 合并条件：CI 通过 + 至少一条说明「在哪个 DSH 版本、哪个 profile 上验证过」。

## 分支与版本

- `main` 为开发分支，受保护，需 CI 通过。
- 发布采取 `vX.Y.Z` tag + GitHub Release，CHANGELOG 标注对应上游编号。
