[简体中文](README.md) | **English**

# @xiaochaz/dsh-approval-gate

**Automatic approval gate for DeepSeek Harness — minimal human intervention: safe operations pass automatically, dangerous ones always escalate to a human (fail-safe).**

> **Community continuation** of [`dsh-approval-gate`](https://github.com/moon09300731/dsh-approval-gate). Upstream has had no commits since 2026-08-20; this project has been maintained independently since 2026-10 (baseline 0.5.2, current 0.5.4).
> Not affiliated with the original maintainer: original code is MIT, copyright remains with the upstream author (see [`NOTICE`](./NOTICE)).
> See [`MAINTAINING.md`](./MAINTAINING.md) and [`CHANGELOG.md`](./CHANGELOG.md).

A Flash-model judge inspects every sandbox escalation: routine operations are approved automatically, while hard-risk categories (delete / credentials / remote / system paths / bulk-irreversible) always go to a human. Learning only ever generalizes from operations you personally confirmed, and a review UI shows the full timeline.

## ✨ Features

- ⚡ **Flash risk judge** — every sandbox escalation is classified as `SAFE` or `RISKY:<category>`; recoverable operations pass automatically
- 🛡️ **Hard risks are never automatic** — delete, credentials, remote/production, system paths, bulk-irreversible: always human, never learned
- 🎯 **Confirmation-based learning** — after N-1 confirmations the same operation passes; learned rules carry an operation fingerprint
- 🧠 **Semantic same-kind check** — rephrased but equivalent operations are compared against your confirmed samples, not keywords
- 🔧 **Hot-reloadable config** — edits to `allowlist.json` apply immediately
- ✅ **Review UI** — a green notice above the composer on auto-approval; an "Approvals" view with the session timeline
- 📄 **File diff & revert** — inspect a classic unified diff of affected files and revert with one click; manage snapshot storage
- 🩺 **Failures are diagnosable** — judging errors are audited and degrade to manual approval instead of failing silently

## 🚀 Install

```sh
dsh plugin --profile <your-profile> add github:xiaochaZ/dsh-approval-gate#v0.5.3
```

The official desktop app uses profile `desktop`; `dsh web` usually uses `web` (`ls ~/.dsh/profiles` if unsure).

For local development, clone the repo and register it as a `link:` dependency of the profile, then add `"@xiaochaz/dsh-approval-gate"` to `dsh.profile.bundles` and run `pnpm install`.

## ⚙️ Required: permission preset

Dynamic plugins cannot extend the host's frozen presets table, so the `auto-approve` preset must be written by hand into `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
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

If a `- id: permission` entry already exists, merge only the `auto-approve` block into `presets`. Restart DSH afterwards — the host loads bundles and presets at boot.

## ✅ Verify it actually works

```sh
dsh --profile <your-profile> --dump-config | grep xiaochaz
```

The bundle row must resolve and boot must not print `skipping profile bundle`. Then trigger a sandbox escalation in a session: an auto-approval should append a line to `$DSH_HOME/auto-approve/audit.log`:

```
[<ISO time>] ALLOW   <tool> mode=<sandbox-mode> (flash-safe)
```

A line containing `ERROR   permissionPresets.current failed` means the host API drifted — please open an issue with your DSH version.

## 📁 Data files

`$DSH_HOME/auto-approve/` (default `~/.dsh/auto-approve`) holds `allowlist.json`, `learning.json`, `audit.log`, `events.jsonl`, and `snapshots/`. The directory is independent of the package name, so switching between upstream and this project preserves all learned rules and audit history.

## 📄 License

MIT — see [`LICENSE`](./LICENSE). Original copyright notice retained. This project is community-maintained and not affiliated with the original maintainer.
