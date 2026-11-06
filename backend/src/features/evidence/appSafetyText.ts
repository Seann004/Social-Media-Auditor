/** Small text helpers for the safety rules. Pure. */

const MENTION = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*)/gu
const HANDLE = /^[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*$/u

/** Compatibility-normalised (so a full-width at-sign is an at-sign) and with curly quotes made straight. */
export function normalised(text: string): string {
  return text.normalize('NFKC').replace(/[‘’ʼ]/g, "'")
}

/** Every @name in the text, lower-cased and whole: `@teen15.real` is `teen15.real`, never `teen15`. */
export function mentionsOf(text: string): string[] {
  return [...normalised(text).matchAll(MENTION)].map((match) => match[1].toLowerCase())
}

/** The handle as a bare lower-case name, or null when it is not an @-style name (a display name never counts). */
export function handleName(handle: string): string | null {
  const name = normalised(handle).trim().replace(/^@+/, '').toLowerCase()
  return HANDLE.test(name) ? name : null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The bare name standing alone in the text: no letter, digit, `_`, `.` or `-` continues it either way. */
export function holdsBareName(text: string, name: string): boolean {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.-])${escapeRegExp(name)}(?![\\p{L}\\p{N}_]|[.-][\\p{L}\\p{N}_])`, 'iu')
  return pattern.test(normalised(text))
}

export function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export function parseUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base)
  } catch {
    return null
  }
}

/** Words only: camelCase split, every separator a space. This is what the word lists are tested against. */
export function plain(text: string): string {
  return normalised(decodeSafely(text))
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The words of an address: its path and its query. */
export function wordsOfUrl(raw: string, base: string): string {
  const parsed = parseUrl(raw, base)
  return parsed === null ? plain(raw) : plain(`${parsed.pathname} ${parsed.search}`)
}

export function pathSegments(raw: string): string[] {
  const parsed = parseUrl(raw)
  if (parsed === null) return []
  return parsed.pathname
    .split('/')
    .map((segment) => normalised(decodeSafely(segment)).toLowerCase().replace(/^@+/, ''))
    .filter((segment) => segment !== '')
}
