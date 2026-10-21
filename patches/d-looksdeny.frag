// deny 关键词匹配（issue #13：0.5.0 用裸子串，像 format 会命中 Format-Table / --format，
// 导致 PowerShell 常规命令被误判为「格式化磁盘」）。默认按词边界匹配；
// 边界字符集含 '-'，因此 --format / Format-Table / force-push 这类连字符前缀不再误命中。
// 需要老行为可在 allowlist.json 设 denyMatch: "substring"。
function denyKeywordRegex(keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return null
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp('(?<![a-z0-9_-])' + escaped + '(?![a-z0-9_-])')
  } catch {
    return null
  }
}

function looksDeny(text) {
  const lower = String(text || '').toLowerCase()
  const keywords = config.denyKeywords || DEFAULT_DENY_KEYWORDS
  const mode = config.denyMatch === 'substring' ? 'substring' : 'boundary'
  return keywords.some((keyword) => {
    const kw = String(keyword || '').trim().toLowerCase()
    if (!kw) return false
    if (mode === 'substring') return lower.includes(kw)
    const re = denyKeywordRegex(kw)
    return re ? re.test(lower) : lower.includes(kw)
  })
}
