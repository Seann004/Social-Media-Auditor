/**
 * Normalises text for quote matching: NFKC, curly quotes to straight, dashes
 * to "-", whitespace collapsed, case kept.
 *
 * Must stay pure and self-contained (no imports or outside references): it is
 * serialised into the browser with page.evaluate.
 */
export function normaliseForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const MIN_QUOTE_WORDS = 3
const WORD_CHAR = /[\p{L}\p{N}]/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== '' && WORD_CHAR.test(ch)
}

/**
 * A quote is verified only if it has at least 3 tokens containing a letter or
 * digit and appears verbatim (after normalising) in the passage, starting and
 * ending on word boundaries. Every occurrence is checked, not just the first.
 */
export function isQuoteVerified(quote: string, passageText: string): boolean {
  const q = normaliseForMatch(quote)
  const meaningful = q.split(' ').filter((t) => WORD_CHAR.test(t))
  if (meaningful.length < MIN_QUOTE_WORDS) return false
  const passage = normaliseForMatch(passageText)
  let from = 0
  for (;;) {
    const at = passage.indexOf(q, from)
    if (at === -1) return false
    const before = at > 0 ? passage[at - 1] : undefined
    const after = passage[at + q.length]
    const startOk = !isWordChar(before) || !isWordChar(q[0])
    const endOk = !isWordChar(after) || !isWordChar(q[q.length - 1])
    if (startOk && endOk) return true
    from = at + 1
  }
}
