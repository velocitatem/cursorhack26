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

  const onlyAddr = trimmed.match(/^\s*<([^<>]+)>\s*$/)
  if (onlyAddr) {
    return formatLocalPart(onlyAddr[1].trim()) || 'Unknown'
  }

  const named = trimmed.match(/^(.+?)\s*<([^<>]+)>\s*$/)
  if (named) {
    const name = stripQuotes(named[1])
    if (name) return name
    return formatLocalPart(named[2].trim()) || 'Unknown'
  }

  if (/^[^\s<>]+@[^\s<>]+$/.test(trimmed)) {
    return formatLocalPart(trimmed) || 'Unknown'
  }

  return trimmed
}
