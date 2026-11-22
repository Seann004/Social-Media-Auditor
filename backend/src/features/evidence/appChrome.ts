/**
 * Takes the site's own menu out of the pages an app check saw, before the judge ranks them and
 * spends its small budget. Most apps repeat the same menu on every settings page ("Privacy and
 * reach, Preferences, Posting defaults, ..."); left in, it makes every page look as if it held the
 * item's words, and it uses the budget the page's own controls need. A control is menu when it
 * shows no state and most of the different pages show it; a control with a state or a value
 * (`[on]`, `[value: Public]`) is a setting and is always kept. Words only, no AI call.
 */
import type { RankablePage } from './appRelevance.js'
import type { Passage } from './types.js'

/** With fewer different pages than this, a menu cannot be told from the page's own controls. */
const MIN_PAGES = 3
/** A control on at least this share of the different pages is menu. */
const MENU_SHARE = 0.5
/** The `eN ` that starts each controls line: the same control has another number on each page. */
const REF_PREFIX = /^e\d+\s+/
/** A control line ending in a state or value, such as `[on]`, `[off]` or `[value: Public]`. */
const SHOWS_STATE = /\[[^\]]*\]\s*$/
/** The name of a controls line: `link "Privacy and reach"` gives `Privacy and reach`. */
const QUOTED_NAME = /"([^"]+)"/

const keyOf = (line: string): string => line.replace(REF_PREFIX, '').trim()

function controlLines(page: RankablePage): string[] {
  return page.passages.filter((p) => p.kind === 'controls').flatMap((p) => p.text.split('\n'))
}

/** One copy of each page: the same page seen again by the same account says nothing new. */
function distinctPages(pages: readonly RankablePage[]): RankablePage[] {
  const seen = new Set<string>()
  return pages.filter((page) => {
    const signature = `${page.accountKey}|${page.passages.map((p) => p.text.split('\n').map(keyOf).join('\n')).join('\n')}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

/** The controls, without their numbers, that show no state and are on most of the different pages. */
function menuKeys(pages: readonly RankablePage[]): Set<string> {
  const distinct = distinctPages(pages)
  if (distinct.length < MIN_PAGES) return new Set()
  const holders = new Map<string, number>()
  for (const page of distinct) {
    for (const key of new Set(controlLines(page).map(keyOf))) holders.set(key, (holders.get(key) ?? 0) + 1)
  }
  const needed = Math.max(MIN_PAGES, Math.ceil(distinct.length * MENU_SHARE))
  return new Set([...holders].filter(([key, count]) => count >= needed && key !== '' && !SHOWS_STATE.test(key)).map(([key]) => key))
}

/**
 * The page text without the menu's names at its start, where the menu is read out as plain words.
 * Each name goes once, as the menu shows it once: the page's own heading after it ("Posting
 * defaults" on the posting defaults page) stays.
 */
function withoutLeadingMenu(text: string, names: readonly string[]): string {
  let rest = text.trimStart()
  let left = names
  for (;;) {
    const name = left.find((n) => rest.startsWith(n) && (rest.length === n.length || /\s/.test(rest[n.length] as string)))
    if (name === undefined) return rest
    rest = rest.slice(name.length).trimStart()
    left = left.filter((n) => n !== name)
  }
}

function cleaned(passage: Passage, menu: ReadonlySet<string>, names: readonly string[]): Passage | null {
  const text =
    passage.kind === 'controls'
      ? passage.text
          .split('\n')
          .filter((line) => !menu.has(keyOf(line)))
          .join('\n')
      : withoutLeadingMenu(passage.text, names)
  if (text.trim() === '') return null
  return text === passage.text ? passage : { ...passage, text }
}

/**
 * New pages without the site's menu, except the newest page that shows it: the menu is read once,
 * since its entries ("Filters", "Blocked") say what the app offers. The pages given are left as they were.
 */
export function withoutChrome(pages: readonly RankablePage[]): RankablePage[] {
  const menu = menuKeys(pages)
  if (menu.size === 0) return [...pages]
  // Longest first, so "Privacy and reach" is taken whole before "Privacy".
  const names = [...menu].flatMap((key) => QUOTED_NAME.exec(key)?.[1] ?? []).sort((a, b) => b.length - a.length)
  const keeper = [...pages].reverse().find((page) => controlLines(page).some((line) => menu.has(keyOf(line))))
  return pages.map((page) =>
    page === keeper
      ? page
      : {
          ...page,
          passages: page.passages.flatMap((p) => {
            const kept = cleaned(p, menu, names)
            return kept === null ? [] : [kept]
          }),
        },
  )
}
