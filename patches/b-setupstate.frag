/** 检查权限预设是否已配置（供设置页初始化卡片） */
function getSetupState() {
  const resolved = resolveProfilePatchPath()
  const state = {
    configured: false,
    patchPath: resolved.path,
    profile: resolved.profile || null,
    source: resolved.source,
    candidates: resolved.candidates || [],
    ambiguous: Boolean(resolved.ambiguous)
  }
  if (state.ambiguous) {
    state.hint = '检测到多个 profile 都有 cordis.patch.yml（' + state.candidates.join(', ') + '）。为避免写错文件已停止自动猜测：请在 allowlist.json 里设置 profilePatchPath，或设置环境变量 DSH_PROFILE / DSH_PROFILE_DIR 后重试。'
  }
  try {
    state.configured = readFileSync(resolved.path, 'utf8').includes('auto-approve:')
  } catch (error) {
    state.error = String((error && error.message) || error)
  }
  return state
}
