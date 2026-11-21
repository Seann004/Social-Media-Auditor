/**
 * Ranks the pages an app check saw by how much of the item's wording they hold, so the judge's small budget goes to the
 * pages that can answer it, not to whichever pages came last or were opened most often. Words only, no AI call.
 */
import type { Passage } from './types.js'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'can', 'does', 'did', 'has', 'have', 'with', 'that', 'this', 'from', 'their', 'there', 'they', 'them', 'who', 'what',
  'when', 'where', 'which', 'why', 'how', 'any', 'all', 'its', 'not', 'but', 'was', 'were', 'will', 'would', 'should', 'could', 'may', 'might',
  'user', 'users', 'account', 'accounts', 'app', 'people', 'other', 'others', 'able', 'allow', 'allows', 'built',
])

/** A light stem: drops a common ending and a doubled last letter, so "tagging" and "tag" meet. */
function stem(word: string): string {
  let w = word
  for (const ending of ['ing', 'ed', 'es', 's']) {
    if (w.length > ending.length + 2 && w.endsWith(ending)) {
      w = w.slice(0, -ending.length)
      break
    }
  }
  return w.length > 3 && w.at(-1) === w.at(-2) ? w.slice(0, -1) : w
}

/** The content words of a text, stemmed. */
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? []
  return new Set(words.filter((w) => !STOP_WORDS.has(w)).map(stem))
}

/** Two stems meet when they are equal, or one starts the other, or both are long and share their first five letters. */
function meets(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 3 && b.startsWith(a)) return true
  if (b.length >= 3 && a.startsWith(b)) return true
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)
}

/** How many of the item's words the text holds. */
export function relevance(itemWords: ReadonlySet<string>, text: string): number {
  const have = [...contentWords(text)]
  let hits = 0
  for (const word of itemWords) if (have.some((h) => meets(word, h))) hits++
  return hits
}

export interface RankablePage {
  pageId: string
  /** Who saw it: the same page text seen by two accounts is two pages, since each shows its own settings. */
  accountKey: string
  /** The page's passages, not counting step lines. */
  passages: Passage[]
}

/**
 * The pages in the order the judge should read them: pages the AI named as evidence first, then by how much of the item's
 * wording they hold, then newest first. A page whose text is the same as a newer page of the same account is dropped.
 * Each page's passages are put in the same order, the most relevant first.
 */
export function rankPages(itemText: string, pages: readonly RankablePage[], named: readonly string[] = []): RankablePage[] {
  const itemWords = contentWords(itemText)
  const seen = new Set<string>()
  const distinct: Array<{ page: RankablePage; score: number; age: number }> = []
  // Newest last in `pages`; walk from the newest so the newest copy of a repeated page is the one kept.
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i] as RankablePage
    const signature = `${page.accountKey}|${page.passages.map((p) => p.text).join('\n')}`
    if (seen.has(signature)) continue
    seen.add(signature)
    const passages = page.passages
      .map((p, at) => ({ p, at, score: relevance(itemWords, p.text) }))
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .map((x) => x.p)
    const score = relevance(itemWords, page.passages.map((p) => p.text).join(' '))
    distinct.push({ page: { ...page, passages }, score, age: pages.length - 1 - i })
  }
  const isNamed = (id: string): number => (named.includes(id) ? 0 : 1)
  return distinct.sort((a, b) => isNamed(a.page.pageId) - isNamed(b.page.pageId) || b.score - a.score || a.age - b.age).map((x) => x.page)
}
