/** Small text helpers for the safety rules. Pure. */

/** Letters, digits, combining marks and `_`: anything that can continue a name. */
const CHAR = '\\p{L}\\p{N}\\p{M}\\p{Cf}_'
const NAME = `[${CHAR}]+(?:[.-][${CHAR}]+)*`
/** What makes an `@` part of a word (an address) rather than a mention. A combining mark does not: a mark then `@stranger` is a mention. */
const WORD_BEFORE_AT = '\\p{L}\\p{N}_'
/**
 * A handle runs to the end of an `@server.tld` tail: `@teen15@evil.social` is one whole handle. An `@` right
 * after the handle (`@teen15@`, `@teen15@-x`: no valid server) is caught by the last group and marks it.
 */
const MENTION = new RegExp(`(?<![${WORD_BEFORE_AT}])@(${NAME}(?:@${NAME})?)(@?)`, 'gu')
const ASCII_NAME = '[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*'
const ASCII_MENTION = new RegExp(`(?<![A-Za-z0-9_])@(${ASCII_NAME}(?:@${ASCII_NAME})?)`, 'g')
const HANDLE = new RegExp(`^${ASCII_NAME}(?:@${ASCII_NAME})?$`)
/** Marks a name that looked like a handle but is not plain ASCII; it never equals any handle. */
const NOT_ASCII = '\u0000'

/** Lower-cases the letters A-Z and nothing else. */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

/** Compatibility-normalised (so a full-width at-sign is an at-sign) and with curly quotes made straight. */
export function normalised(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[‘’ʼ]/g, "'")
}

/**
 * Every @name in the text, whole and with ASCII letters lower-cased: `@teen15.real` is `teen15.real`,
 * never `teen15`. A name that is not plain ASCII as written (full-width letters, Cyrillic look-alikes,
 * invisible characters, a full-width at-sign), or that is followed by an `@` with no valid server, is kept
 * but marked, so it matches no handle. So is a plain @name that only the raw text shows (after a letter
 * that a combining mark joins into a non-ASCII letter, `e` + U+0301 + `@stranger`): it is a stranger.
 */
export function mentionsOf(text: string): string[] {
  const plainNames = [...text.matchAll(ASCII_MENTION)].map((match) => asciiLower(match[1]))
  const names = [...normalised(text).matchAll(MENTION)].map((match) => {
    const name = asciiLower(match[1])
    const at = plainNames.indexOf(name)
    if (at >= 0) plainNames.splice(at, 1)
    return at < 0 || match[2] !== '' ? NOT_ASCII + name : name
  })
  return [...names, ...plainNames.map((name) => NOT_ASCII + name)]
}

/** The handle as a bare name with ASCII letters lower-cased, or null when it is not a plain ASCII @-style name. */
export function handleName(handle: string): string | null {
  const name = asciiLower(handle.trim().replace(/^@+/, ''))
  return HANDLE.test(name) ? name : null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The bare name standing alone in the text: no letter, digit, `_`, `.` or `-` continues it either way. */
export function holdsBareName(text: string, name: string): boolean {
  const pattern = new RegExp(`(?<![${CHAR}.-])${escapeRegExp(name)}(?![${CHAR}@]|[.-][${CHAR}])`, 'u')
  return pattern.test(asciiLower(text))
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
    .map((segment) => asciiLower(decodeSafely(segment)).replace(/^@+/, ''))
    .filter((segment) => segment !== '')
}
