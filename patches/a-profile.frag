// 0.2.x 起 profile 名随发行形态变化（官方桌面版=desktop / Web=web / headless=headless）。
// 0.5.0 写死 profiles/web：官方桌面版下「一键配置」写错文件、设置页永远显示未配置（issue #2、#25）。
const PROFILE_ORDER = ['desktop', 'headless', 'web']

/** 本插件是被哪个 profile 安装并加载的：看自身模块路径里的 profiles/<name>/node_modules */
function installedProfileName() {
  try {
    const parts = fileURLToPath(import.meta.url).split(/[\\/]/)
    const i = parts.lastIndexOf('profiles')
    if (i >= 0 && parts[i + 1] && parts[i + 2] === 'node_modules') return parts[i + 1]
  } catch { /* 非 file: 协议或测试环境 → 走环境变量/扫描兜底 */ }
  return ''
}

/** 所有「确实存在 cordis.patch.yml」的 profile 名 */
function profilePatchCandidates() {
  const root = join(DSH_HOME, 'profiles')
  const names = []
  try {
    for (const name of readdirSync(root)) {
      try {
        if (statSync(join(root, name, 'cordis.patch.yml')).isFile()) names.push(name)
      } catch { /* 该目录没有 patch 文件 */ }
    }
  } catch { /* 没有 profiles 目录 */ }
  return names
}

/**
 * 解析当前生效 profile 的 cordis.patch.yml 路径。
 * 顺序：配置项 profilePatchPath → 自身安装路径 → DSH_PROFILE_DIR → DSH_PROFILE → 目录扫描。
 * 多 profile 同时有 patch 文件时标记 ambiguous（issue #6 的教训：猜错目录会写坏别人的配置文件）。
 */
function resolveProfilePatchPath() {
  const override = typeof config.profilePatchPath === 'string' ? config.profilePatchPath.trim() : ''
  if (override) return { path: override, profile: '', source: 'config', candidates: [], ambiguous: false }

  const candidates = profilePatchCandidates()
  const self = installedProfileName()
  if (self) return { path: join(DSH_HOME, 'profiles', self, 'cordis.patch.yml'), profile: self, source: 'installed-path', candidates, ambiguous: false }

  const envDir = process.env.DSH_PROFILE_DIR ? String(process.env.DSH_PROFILE_DIR).trim() : ''
  if (envDir) {
    const name = envDir.split(/[\\/]/).filter(Boolean).pop() || ''
    return { path: join(envDir, 'cordis.patch.yml'), profile: name, source: 'env:DSH_PROFILE_DIR', candidates, ambiguous: false }
  }

  const envName = process.env.DSH_PROFILE ? String(process.env.DSH_PROFILE).trim() : ''
  if (envName) return { path: join(DSH_HOME, 'profiles', envName, 'cordis.patch.yml'), profile: envName, source: 'env:DSH_PROFILE', candidates, ambiguous: false }

  if (candidates.length === 1) return { path: join(DSH_HOME, 'profiles', candidates[0], 'cordis.patch.yml'), profile: candidates[0], source: 'scan', candidates, ambiguous: false }

  const preferred = PROFILE_ORDER.find((n) => candidates.includes(n))
  if (preferred) {
    return { path: join(DSH_HOME, 'profiles', preferred, 'cordis.patch.yml'), profile: preferred, source: 'scan:guess', candidates, ambiguous: candidates.length > 1 }
  }
  return { path: join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml'), profile: '', source: 'fallback', candidates, ambiguous: false }
}
