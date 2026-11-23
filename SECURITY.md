# 安全策略

## 私下报告

请不要为安全问题开公开 issue。用任一种私密渠道：

1. GitHub 的 [私密漏洞报告](https://github.com/xiaochaZ/dsh-approval-gate/security/advisories/new)（推荐）；
2. 或发邮件给仓库所有者（见 GitHub 个人资料页公开邮箱）。

## 范围

本插件在宿主进程内运行，并注册 `/api/auto-approve/*` 系列路由，重点关注：

- 判定链绕过（白名单 / 学习池 / 来源校验）；
- 路由鉴权（跨源访问、未授权改写规则、注入撤销指令、删除快照）；
- `diff` / `revert` 的路径越界（路径来自事件记录，需约束在工作区内）。

## 处理方式

- 确认后优先出补丁版本，并在 CHANGELOG 里以「安全」小节说明（不披露利用细节）。
- 已知未修项见 [`MAINTAINING.md`](./MAINTAINING.md) 的「已知未修」章节。
