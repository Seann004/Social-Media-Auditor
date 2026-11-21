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

/** The item words the text holds. */
export function matchedWords(itemWords: ReadonlySet<string>, text: string): string[] {
  const have = [...contentWords(text)]
  return [...itemWords].filter((word) => have.some((h) => meets(word, h)))
}

/** How many of the item's words the text holds. */
export function relevance(itemWords: ReadonlySet<string>, text: string): number {
  return matchedWords(itemWords, text).length
}

export interface RankablePage {
  pageId: string
  /** Who saw it: the same page text seen by two accounts is two pages, since each shows its own settings. */
  accountKey: string
  /** The page's passages, not counting step lines. */
  passages: Passage[]
}

export interface RankedPage extends RankablePage {
  /** How much of the item's wording the page holds; a word that few pages hold counts for more. */
  score: number
}

/**
 * The pages in the order the judge should read them: pages the AI named as evidence first, then by how much of the item's
 * wording they hold, then newest first. A page whose text is the same as a newer page of the same account is dropped.
 * Each page's passages are put in the same order, the most relevant first. A word that every page holds (such as "teen"
 * on a teen account's pages) says little, so each item word counts for less the more pages hold it.
 */
export function rankPages(itemText: string, pages: readonly RankablePage[], named: readonly string[] = []): RankedPage[] {
  const itemWords = contentWords(itemText)
  const seen = new Set<string>()
  const distinct: Array<{ page: RankablePage; age: number; held: string[] }> = []
  // Newest last in `pages`; walk from the newest so the newest copy of a repeated page is the one kept.
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i] as RankablePage
    const signature = `${page.accountKey}|${page.passages.map((p) => p.text).join('\n')}`
    if (seen.has(signature)) continue
    seen.add(signature)
    distinct.push({ page, age: pages.length - 1 - i, held: matchedWords(itemWords, page.passages.map((p) => p.text).join(" ")) })
  }
  const holders = new Map<string, number>()
  for (const { held } of distinct) for (const word of held) holders.set(word, (holders.get(word) ?? 0) + 1)
  const weight = (word: string): number => 1 + Math.log((distinct.length + 1) / ((holders.get(word) ?? 0) + 1))
  const sum = (words: string[]): number => words.reduce((total, word) => total + weight(word), 0)
  const ranked = distinct.map(({ page, age, held }) => ({
    age,
    page: {
      ...page,
      score: sum(held),
      passages: page.passages
        .map((p, at) => ({ p, at, score: sum(matchedWords(itemWords, p.text)) }))
        .sort((x, y) => y.score - x.score || x.at - y.at)
        .map((x) => x.p),
    },
  }))
  const isNamed = (id: string): number => (named.includes(id) ? 0 : 1)
  return ranked.sort((x, y) => isNamed(x.page.pageId) - isNamed(y.page.pageId) || y.page.score - x.page.score || x.age - y.age).map((x) => x.page)
}
