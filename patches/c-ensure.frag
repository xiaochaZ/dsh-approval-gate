/**
 * 一键初始化：在 cordis.patch.yml 中写入 auto-approve 权限预设（文本级操作，保留注释格式）。
 * issue #6：0.5.0 对根节点为 []（或空文件）的 patch 做纯文本尾部追加 → 生成非法 YAML，
 * 宿主起不来且 Web UI 也进不去。这里先识别空占位并整体重写，写前留备份。
 */
function ensureAutoApprovePreset() {
  const resolved = resolveProfilePatchPath()
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 'ambiguous-profile',
      needRestart: false,
      patchPath: resolved.path,
      candidates: resolved.candidates,
      error: '检测到多个 profile 都有 cordis.patch.yml（' + resolved.candidates.join(', ') + '），已停止自动写入。请设置 allowlist.json 的 profilePatchPath 或环境变量 DSH_PROFILE 后重试'
    }
  }

  const patchPath = resolved.path
  try {
    const text = readFileSync(patchPath, 'utf8')
    if (text.includes('auto-approve:')) return { ok: true, status: 'already', needRestart: false, patchPath }

    // 写前备份：写坏了用户能自己回滚（issue #6 的补救前提）
    try {
      writeFileSync(patchPath + '.bak-approval-gate', text, 'utf8')
    } catch { /* 备份失败不阻断，但下面仍会做结构校验 */ }

    // 空文件 / 只有注释 / 根节点为 [] 的占位 patch → 整体重写（追加会得到非法 YAML）
    const meaningful = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    const isEmptyPlaceholder = meaningful.length === 0 || (meaningful.length === 1 && meaningful[0] === '[]')

    if (isEmptyPlaceholder) {
      const next = FULL_PERMISSION_BLOCK + AUTO_APPROVE_PRESET_YAML
      writeFileSync(patchPath, next, 'utf8')
      return { ok: true, status: 'rewrote-empty', needRestart: true, patchPath }
    }

    const lines = text.split('\n')
    let permIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^- id:\s*permission\s*$/.test(lines[i])) { permIdx = i; break }
    }

    if (permIdx === -1) {
      // 无 permission 条目：追加完整预设块
      const next = text.replace(/\s*$/, '') + '\n' + FULL_PERMISSION_BLOCK + AUTO_APPROVE_PRESET_YAML
      writeFileSync(patchPath, next, 'utf8')
      return { ok: true, status: 'added-entry', needRestart: true, patchPath }
    }

    // 有 permission 条目：在其 presets 块末尾插入 auto-approve
    // presets 子项缩进 6；找到 presets: 后的最后一个缩进 ≥6 的连续行，在其后插入
    let presetsIdx = -1
    for (let i = permIdx; i < lines.length; i++) {
      if (/^ {4}presets:\s*$/.test(lines[i])) { presetsIdx = i; break }
      if (i > permIdx && /^- /.test(lines[i]) && !/^ {2,}- /.test(lines[i])) break // 下一个顶层条目
    }
    if (presetsIdx === -1) {
      return { ok: false, status: 'no-presets-key', needRestart: false, patchPath, error: 'permission 条目缺少 presets 键，请手动添加' }
    }
    // 从 presetsIdx 往下找最后一个 presets 子项行（缩进 6 且非注释空行），直到顶层条目/文件尾
    let insertAt = presetsIdx
    for (let i = presetsIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^ {6}\S/.test(line) || /^ {8}\S/.test(line)) { insertAt = i; continue }
      if (/^ {0,4}\S/.test(line) && !/^ {6,}\S/.test(line)) break // 缩进 <6 的非空行 = 离开 presets 区
      if (/^\s*$/.test(line)) continue
    }
    lines.splice(insertAt + 1, 0, AUTO_APPROVE_PRESET_YAML.replace(/\n$/, ''))
    const next = lines.join('\n')

    // 结构校验：写出的文件必须仍能被 YAML 顶层列表结构接受（缩进为 2 的倍数、无 Tab）
    if (/\t/.test(next)) {
      writeFileSync(patchPath + '.bak-approval-gate', text, 'utf8')
      return { ok: false, status: 'would-break-yaml', needRestart: false, patchPath, error: '插入后会引入 Tab 缩进（YAML 非法），已放弃写入；原文件已备份为 cordis.patch.yml.bak-approval-gate' }
    }
    writeFileSync(patchPath, next, 'utf8')
    return { ok: true, status: 'added-preset', needRestart: true, patchPath }
  } catch (error) {
    return { ok: false, status: 'error', needRestart: false, patchPath, error: String((error && error.message) || error) }
  }
}
