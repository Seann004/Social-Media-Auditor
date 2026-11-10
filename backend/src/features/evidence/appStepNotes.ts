/**
 * What a step line says about the page a step led to: a message the page started showing (a failed
 * sign-in), or an error page ("Not found"). The text comes from the view, which is already scrubbed of
 * the session's secrets; any fragment that still shows a hidden value is dropped whole.
 */
import { SECRET_PLACEHOLDER } from './appSecrets.js'
import { pathOf } from './appSteps.js'
import type { AppView } from './appTypes.js'
import { normaliseForMatch } from './quotes.js'

/** About how long a fragment of page text in a step line may be. */
export const NOTE_MAX_CHARS = 100
/** The most words a message may have: more is new content (a whole page at the same address), not a message. */
const MESSAGE_MAX_WORDS = 30
/** A page that opens with one of these is an error page. */
const ERROR_PAGE = /^(page not found|not found|404|forbidden|access denied)(?![\p{L}\p{N}])/iu
/** What redactUrl and the session put in place of a hidden value: a fragment showing one is dropped. */
const HIDDEN_MARKS = [SECRET_PLACEHOLDER.toLowerCase(), 'redacted']
const HAS_LETTER = /\p{L}/u

const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '')

function shorten(text: string): string {
  return text.length <= NOTE_MAX_CHARS ? text : `${text.slice(0, NOTE_MAX_CHARS).trimEnd()}…`
}

const showsHidden = (text: string): boolean => HIDDEN_MARKS.some((mark) => text.toLowerCase().includes(mark))

const comparable = (text: string): string => normaliseForMatch(text).toLowerCase()

/**
 * The words of `after` that are not in what it shares with `before` at its start and at its end. Null
 * when less than half of `before` was kept: the page was replaced, not given a message.
 */
function insertedWords(before: string[], after: string[]): string[] | null {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1
  if ((start + end) * 2 < before.length) return null
  return after.slice(start, after.length - end)
}

/**
 * The text the new view gained: the words between what it shares with the old view at its start and
 * at its end (the page text is one normalised string, so blocks are not lines). It is a message when
 * most of the old text stayed, and it has a letter and is short; anything else is new content. Text
 * that repeats any of `typed` (what the AI typed in this check) is the AI's own words, not the app's
 * message. Null when there is none, or when it shows a hidden value.
 */
export function newMessageOf(before: AppView, after: AppView, typed: readonly string[] = []): string | null {
  const words = insertedWords(wordsOf(before.text), wordsOf(after.text))
  if (words === null || words.length === 0 || words.length > MESSAGE_MAX_WORDS) return null
  const found = words.join(' ')
  if (!HAS_LETTER.test(found) || showsHidden(found)) return null
  const shown = comparable(found)
  if (typed.some((text) => text.trim() !== '' && shown.includes(comparable(text.trim())))) return null
  return shorten(found)
}

/** The error a page opens with ("Not found", "404", "Forbidden"...), as the page writes it; null for any other page. */
export function errorPageNote(after: AppView): string | null {
  const match = ERROR_PAGE.exec(after.text.trim())
  return match === null ? null : match[1]
}

/**
 * The detail of a done step that changed no setting: `page unchanged`, with what the page now shows
 * when it gained a message, or `page <path> opened`, with the error it said when it is an error page.
 */
export function pageDetail(before: AppView | null, after: AppView | null, afterUrl: string, typed: readonly string[] = []): string {
  if (before !== null && before.url === afterUrl) {
    const message = after === null ? null : newMessageOf(before, after, typed)
    return message === null ? 'page unchanged' : `page unchanged, now showing: "${message}"`
  }
  const opened = `page ${pathOf(afterUrl)} opened`
  const error = after === null ? null : errorPageNote(after)
  return error === null ? opened : `${opened}, but it said "${error}"`
}
