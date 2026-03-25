const stripQuotes = (value: string) => value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim()

const formatLocalPart = (email: string) => {
  const at = email.indexOf('@')
  const local = at >= 0 ? email.slice(0, at) : email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => (part[0] ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(' ')
}

/** Turns RFC822-style From strings into a short label for NPC nameplates and UI. */
export const mailboxDisplayName = (raw: string): string => {
  const trimmed = raw.trim()
  if (!trimmed) return 'Unknown'

  const lt = trimmed.indexOf('<')
  if (lt !== -1) {
    const before = stripQuotes(trimmed.slice(0, lt).trim())
    let after = trimmed.slice(lt + 1).trim()
    const gt = after.lastIndexOf('>')
    if (gt !== -1) {
      after = after.slice(0, gt).trim()
    }
    if (before) return before
    if (after) return formatLocalPart(after) || after
    return 'Unknown'
  }

  if (/^[^\s<>]+@[^\s<>]+$/.test(trimmed)) {
    return formatLocalPart(trimmed) || 'Unknown'
  }

  return trimmed
}
