import type { AppElementState, AppView } from './appTypes.js'
import { APP_MIN_SECRET_CHARS } from './config.js'
import { normaliseForMatch } from './quotes.js'

/** What stands in the view wherever a secret of the session was found. */
export const SECRET_PLACEHOLDER = '[secret]'

/** Only the characters that are syntax in a unicode-mode pattern may be escaped there. */
const PATTERN_SYNTAX = /[\^$\\.*+?()[\]{}|/]/g

function patternSource(secret: string): string | null {
  const characters = Array.from(secret.replace(/\s+/g, ''))
  if (characters.length < APP_MIN_SECRET_CHARS) return null
  return characters.map((ch) => ch.replace(PATTERN_SYNTAX, '\\$&')).join('\\s*')
}

/**
 * One pattern source per secret, as typed and as page text normalises it. Each matches the secret
 * in any case and with any whitespace between its characters, so that `TEEN-PASS-111` and text
 * split across blocks are found. Use with the flags `iu`, or `giu` to replace. Secrets shorter
 * than APP_MIN_SECRET_CHARS are left out: they would match almost anywhere, and the masks on
 * secret fields still cover them. Longest first, so that a longer secret is replaced whole.
 */
export function secretPatterns(secrets: readonly string[]): string[] {
  const sources = secrets.flatMap((secret) => [patternSource(secret), patternSource(normaliseForMatch(secret))])
  return [...new Set(sources.filter((source) => source !== null))].sort((a, b) => b.length - a.length)
}

/** Each secret as it is written in an address, for the query part of a url. */
function addressForms(secrets: readonly string[]): string[] {
  const forms = secrets
    .filter((secret) => Array.from(secret).length >= APP_MIN_SECRET_CHARS)
    .flatMap((secret) => [secret, encodeURIComponent(secret), new URLSearchParams({ s: secret }).toString().slice(2)])
  return [...new Set(forms)].sort((a, b) => b.length - a.length)
}

type Scrub = (text: string) => string

function textScrub(secrets: readonly string[]): Scrub {
  const sources = secretPatterns(secrets)
  if (sources.length === 0) return (text) => text
  const pattern = new RegExp(sources.map((source) => `(?:${source})`).join('|'), 'giu')
  return (text) => text.replace(pattern, SECRET_PLACEHOLDER)
}

/** Only the query: the scheme, host and path are kept whole, whatever the secrets are. */
function addressScrub(secrets: readonly string[]): Scrub {
  const forms = addressForms(secrets)
  if (forms.length === 0) return (url) => url
  return (url) => {
    const at = url.indexOf('?')
    if (at === -1) return url
    const query = forms.reduce((part, form) => part.split(form).join(SECRET_PLACEHOLDER), url.slice(at))
    return url.slice(0, at) + query
  }
}

function scrubState(state: AppElementState, scrub: Scrub): AppElementState {
  return {
    ...state,
    ...(state.value === undefined ? {} : { value: scrub(state.value) }),
    ...(state.options === undefined ? {} : { options: state.options.map(scrub) }),
  }
}

/**
 * The view with every secret of the session replaced by SECRET_PLACEHOLDER in its free text: the
 * title, the page text, and each element's name, context text, value and options, plus the query of
 * each address. Refs, roles, tags and the rest are never touched. A new view: nothing is changed in place.
 */
export function scrubView(view: AppView, secrets: readonly string[]): AppView {
  const text = textScrub(secrets)
  const address = addressScrub(secrets)
  return {
    ...view,
    url: address(view.url),
    title: text(view.title),
    text: text(view.text),
    frameUrls: view.frameUrls.map(address),
    elements: view.elements.map((el) => ({
      ...el,
      name: text(el.name),
      contextText: text(el.contextText),
      ...(el.groupLabel === undefined ? {} : { groupLabel: text(el.groupLabel) }),
      href: el.href === null ? null : address(el.href),
      state: scrubState(el.state, text),
    })),
  }
}
