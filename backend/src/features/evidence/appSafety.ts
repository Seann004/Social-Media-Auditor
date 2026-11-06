/** The safety rules for app runs. Pure functions: every action is checked here before it is taken. */
import { isInAppScope } from './appGuard.js'
import type { AgentAccount, AppAction, AppElement, AppView } from './appTypes.js'
import { BLOCK_TEXT_PATTERN, BLOCK_TITLE_PATTERN, CONTENT_WORDS } from './access.js'

export const PERSON_ACTION = /\b(message|send|follow|add friend|friend request|invite|comment|reply|tag|mention|chat|dm|connect|poke|wave)\b/i
export const PUBLISH_ACTION = /\b(post|publish|share|go live|tweet|repost|retweet|upload|broadcast|story|reel)\b/i
export const DESTRUCTIVE_ACTION = /\b(delete|deactivate|close account|remove account|change password|reset password|forgot password|change email|new email|email address|new phone|phone|payment|billing|card|purchase|buy|checkout|subscribe|upgrade|donate|gift|log ?out|sign ?out|other sessions)\b/i
export const PRIVATE_AUDIENCE = /\b(only me|just me|private)\b/i
export const PUBLIC_AUDIENCE = /\b(public|everyone|anyone|friends|followers)\b/i
export const TWO_FACTOR = /two-factor|2-step|two-step|verification code|security code|enter the code|authenticator/i
export const SUSPICIOUS = /suspicious activity|unusual activity|confirm it'?s you|we noticed unusual|account (is )?locked/i
export const CAPTCHA_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha/i

export interface SafetyContext {
  accounts: AgentAccount[]
  currentAccount: AgentAccount | null
  appUrl: string
  loginDomains: string[]
}

export type SafetyRule =
  | 'own_accounts'
  | 'nothing_public'
  | 'destructive'
  | 'stay_on_platform'
  | 'credentials'
  | 'unknown_element'
  | 'no_account'

export type SafetyVerdict = { allowed: true } | { allowed: false; rule: SafetyRule; reason: string }

const ALLOWED: SafetyVerdict = { allowed: true }
const LOGIN_INPUT_TYPES = ['text', 'email', 'tel']
const MENTION = /(?<![\w@])@([A-Za-z0-9_.]*[A-Za-z0-9_])/g

function refuse(rule: SafetyRule, reason: string): SafetyVerdict {
  return { allowed: false, rule, reason }
}

function stripAt(handle: string): string {
  return handle.trim().replace(/^@+/, '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function holdsWord(haystack: string, word: string): boolean {
  if (word === '') return false
  return new RegExp(`(?<![\\w])${escapeRegExp(word)}(?![\\w])`, 'i').test(haystack)
}

function mentionsOf(text: string): string[] {
  return [...text.matchAll(MENTION)].map((match) => match[1].toLowerCase())
}

function parseUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base)
  } catch {
    return null
  }
}

/** The path of an address, with separators turned into spaces so word lists can see inside it. */
function wordsOfPath(raw: string, base: string): string {
  const parsed = parseUrl(raw, base)
  const path = parsed === null ? raw : decodeSafely(parsed.pathname)
  return path.replace(/[/_]+/g, ' ')
}

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function findElement(view: AppView | null, ref: string): AppElement | null {
  return view?.elements.find((candidate) => candidate.ref === ref) ?? null
}

function refOf(action: AppAction): string | null {
  return 'ref' in action && action.ref !== undefined ? action.ref : null
}

function targetOf(action: AppAction): string | undefined {
  return action.type === 'click' || action.type === 'toggle' ? action.target : undefined
}

function accountNamed(ctx: SafetyContext, label: string): AgentAccount | null {
  return ctx.accounts.find((account) => account.label === label) ?? null
}

function checkTarget(action: AppAction, element: AppElement | null, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  const label = targetOf(action)
  const isPerson = (action.type === 'click' || action.type === 'toggle') && element !== null && PERSON_ACTION.test(element.name)
  if (label === undefined) {
    return isPerson ? refuse('own_accounts', `"${element.name}" needs a target, and it must be one of the test accounts.`) : ALLOWED
  }
  const target = accountNamed(ctx, label)
  if (target === null) return refuse('own_accounts', `"${label}" is not one of the test accounts.`)
  if (ctx.currentAccount !== null && target.id === ctx.currentAccount.id) {
    return refuse('own_accounts', `${label} is the account in use, so it cannot be the target.`)
  }
  const handles = target.handles.map(stripAt).filter((handle) => handle !== '')
  if (handles.length === 0) return refuse('own_accounts', `${label} has no display handle, so nothing can be sent to it.`)
  if (element === null || view === null) return refuse('own_accounts', `Cannot tell that this belongs to ${label}.`)
  if (handles.some((handle) => holdsWord(element.contextText, handle))) return ALLOWED
  const parsed = parseUrl(view.url)
  const place = `${parsed === null ? view.url : decodeSafely(parsed.pathname + parsed.search)} ${view.title}`
  const foreign = mentionsOf(element.contextText).some((name) => !handles.some((handle) => handle.toLowerCase() === name))
  if (handles.some((handle) => holdsWord(place, handle)) && !foreign) return ALLOWED
  return refuse('own_accounts', `Cannot tell that this belongs to ${label}, or it shows someone else.`)
}

function checkTypedText(action: AppAction, ctx: SafetyContext): SafetyVerdict {
  if (action.type !== 'type') return ALLOWED
  const known = new Set(ctx.accounts.flatMap((account) => account.handles.map((handle) => stripAt(handle).toLowerCase())))
  const stranger = mentionsOf(action.text).find((name) => !known.has(name))
  return stranger === undefined ? ALLOWED : refuse('own_accounts', `The text mentions @${stranger}, who is not a test account.`)
}

function checkOwnAccounts(action: AppAction, element: AppElement | null, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  if (action.type === 'switch_account' && accountNamed(ctx, action.account) === null) {
    return refuse('own_accounts', `"${action.account}" is not one of the test accounts.`)
  }
  if (action.type === 'fill_credential' && accountNamed(ctx, action.account) === null) {
    return refuse('own_accounts', `"${action.account}" is not one of the test accounts.`)
  }
  const targeted = checkTarget(action, element, view, ctx)
  return targeted.allowed ? checkTypedText(action, ctx) : targeted
}

function checkCredentials(action: AppAction, element: AppElement | null): SafetyVerdict {
  if (element === null) return ALLOWED
  if (action.type === 'type' && element.inputType === 'password') {
    return refuse('credentials', 'Passwords are never typed as text; use fill_credential.')
  }
  if (action.type !== 'fill_credential') return ALLOWED
  if (action.field === 'password') {
    return element.tag === 'input' && element.inputType === 'password'
      ? ALLOWED
      : refuse('credentials', 'A password can only go into a password field.')
  }
  const fits = element.tag === 'input' && (element.inputType === null || LOGIN_INPUT_TYPES.includes(element.inputType))
  return fits ? ALLOWED : refuse('credentials', 'A login name can only go into a text, email or phone field.')
}

const DESTRUCTIVE_TYPES = ['click', 'toggle', 'select', 'type', 'open_link']

function checkDestructive(action: AppAction, element: AppElement | null, view: AppView | null): SafetyVerdict {
  if (!DESTRUCTIVE_TYPES.includes(action.type)) return ALLOWED
  const base = view?.url ?? 'https://invalid.invalid/'
  const probes: string[] = []
  if (element !== null) {
    probes.push(element.name)
    if (element.href !== null) probes.push(wordsOfPath(element.href, base))
  }
  if (action.type === 'open_link' && action.url !== undefined) probes.push(wordsOfPath(action.url, base))
  const hit = probes.find((probe) => DESTRUCTIVE_ACTION.test(probe))
  return hit === undefined ? ALLOWED : refuse('destructive', 'This could delete, pay for, log out of or change an account, so it is not allowed.')
}

/** True only when the control's own form, dialog or composer shows a private audience and no public one. */
export function audienceIsPrivate(view: AppView, publish: AppElement): boolean {
  if (publish.groupId === null) return false
  const group = view.elements.filter((candidate) => candidate.groupId === publish.groupId)
  const shown: string[] = []
  for (const candidate of group) {
    if (candidate.state.checked === true || candidate.state.selected === true) shown.push(candidate.name)
    if (candidate.role === 'combobox' && candidate.state.value !== undefined) shown.push(candidate.state.value)
  }
  return shown.some((text) => PRIVATE_AUDIENCE.test(text)) && !shown.some((text) => PUBLIC_AUDIENCE.test(text))
}

function checkPublic(action: AppAction, element: AppElement | null, view: AppView | null): SafetyVerdict {
  if (action.type !== 'click' || element === null || view === null) return ALLOWED
  if (!PUBLISH_ACTION.test(element.name) || audienceIsPrivate(view, element)) return ALLOWED
  return refuse('nothing_public', 'This could publish something, and the audience is not clearly private.')
}

function checkScope(action: AppAction, element: AppElement | null, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  if (action.type !== 'open_link') return ALLOWED
  const base = view?.url ?? ctx.appUrl
  const addresses = [action.url, element?.href ?? undefined].filter((address): address is string => address !== undefined)
  for (const address of addresses) {
    const parsed = parseUrl(address, base)
    const web = parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    if (!web || !isInAppScope(parsed.href, ctx.appUrl, ctx.loginDomains)) {
      return refuse('stay_on_platform', 'This address is outside the app and its login domains.')
    }
  }
  return ALLOWED
}

/** The first refusal wins. */
export function checkAction(action: AppAction, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  if (ctx.currentAccount === null && action.type !== 'switch_account') {
    return refuse('no_account', 'No test account is in use yet; choose one first.')
  }
  const ref = refOf(action)
  const element = ref === null ? null : findElement(view, ref)
  if (ref !== null && element === null) return refuse('unknown_element', 'That element is not on the page.')
  const checks = [
    () => checkOwnAccounts(action, element, view, ctx),
    () => checkCredentials(action, element),
    () => checkDestructive(action, element, view),
    () => checkPublic(action, element, view),
    () => checkScope(action, element, view, ctx),
  ]
  for (const check of checks) {
    const verdict = check()
    if (!verdict.allowed) return verdict
  }
  return ALLOWED
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

function hasCodeInput(view: AppView): boolean {
  return view.elements.some(
    (el) => el.tag === 'input' && (el.inputType === null || ['text', 'tel', 'number'].includes(el.inputType)) && /code/i.test(el.name),
  )
}

/** The plain reason a page cannot be used, or null. */
export function detectBlock(view: AppView): string | null {
  if (view.frameUrls.some((frame) => CAPTCHA_FRAME.test(frame))) return 'The page asks for a captcha.'
  if (BLOCK_TITLE_PATTERN.test(view.title)) return 'The page is a bot check or an access block.'
  const sparse = wordCount(view.text) < CONTENT_WORDS || hasCodeInput(view)
  if (!sparse) return null
  if (BLOCK_TEXT_PATTERN.test(view.text)) return 'The page asks to prove the visitor is human.'
  if (TWO_FACTOR.test(view.text)) return 'The page asks for a 2-factor code.'
  if (SUSPICIOUS.test(view.text)) return 'The page reports suspicious activity on the account.'
  return null
}
