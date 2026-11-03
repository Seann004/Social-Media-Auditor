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

/** A quote is verified only if it has at least 3 words and appears verbatim (after normalising) in the passage. */
export function isQuoteVerified(quote: string, passageText: string): boolean {
  const q = normaliseForMatch(quote)
  if (q.split(' ').filter(Boolean).length < MIN_QUOTE_WORDS) return false
  return normaliseForMatch(passageText).includes(q)
}
