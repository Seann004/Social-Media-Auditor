/**
 * The safety rules for app runs. Pure functions: every action is checked here before it is taken,
 * and the first refusal wins. The rules refuse unless an action is positively safe.
 * Known limit: a label in a language the word lists miss is caught only by the rule that refuses
 * unknown controls in a person context. Blocking another user is allowed: it affects only the test account.
 */
import { isInAppScope } from './appGuard.js'
import type { AgentAccount, AppAction, AppElement, AppView } from './appTypes.js'
import { audienceIsPrivate, checkPublishing } from './appSafetyPublic.js'
import {
  checkLabel,
  checkTarget,
  choosesPrivateOption,
  checkTypeBox,
  checkTypedText,
  reachesPeople,
  sameGroup,
  type Check,
} from './appSafetyTargets.js'
import { decodeSafely, parseUrl, plain, wordsOfUrl } from './appSafetyText.js'
import { ACCOUNT_FIELD, DESTRUCTIVE_ACTION, LOGIN_PATH, PRICE } from './appSafetyWords.js'

export * from './appSafetyWords.js'
export { detectBlock } from './appSafetyBlock.js'
export { audienceIsPrivate }

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
const CHANGE_CREDENTIAL = /\b(?:new|confirm|current|old|repeat|re-?enter|change|update|reset)\b/i
const LOGIN_TITLE = /log ?in|sign ?in/i
/** An address that does something when it is opened, rather than showing a page. */
const ACTING_PATH = /(?:^|\/)(?:api|graphql|intent|follow|unfollow|send|share|publish|compose|tweet|repost|retweet|poke|wave|invite|connect|add-?friend|friend-?request|block|report)(?:[\/_-]|$)/i
const ACTING_QUERY = /(?:^|[?&])(?:action|text|status|message|follow)=/i
const DESTRUCTIVE_TYPES = ['click', 'toggle', 'select', 'type', 'open_link']

function refuse(rule: SafetyRule, reason: string): SafetyVerdict {
  return { allowed: false, rule, reason }
}

function fromCheck(rule: SafetyRule, check: Check): SafetyVerdict {
  return check.ok ? ALLOWED : refuse(rule, check.reason)
}

function refOf(action: AppAction): string | null {
  return 'ref' in action && action.ref !== undefined ? action.ref : null
}

function targetOf(action: AppAction): string | undefined {
  return action.type === 'click' || action.type === 'toggle' ? action.target : undefined
}

function checkOwnAccounts(action: AppAction, element: AppElement | null, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  if (action.type === 'switch_account') return fromCheck('own_accounts', checkLabel(ctx, action.account))
  if (action.type === 'fill_credential') return fromCheck('own_accounts', checkLabel(ctx, action.account))
  if (element === null || view === null) return ALLOWED
  const typed = action.type === 'type' ? checkTypedText(action.text, ctx) : ({ ok: true } as const)
  if (!typed.ok) return refuse('own_accounts', typed.reason)
  if (!['click', 'toggle', 'select', 'type'].includes(action.type)) return ALLOWED
  const target = targetOf(action)
  if (choosesPrivateOption(action, element)) return ALLOWED
  if (target === undefined && !reachesPeople(action, element, view)) return ALLOWED
  if (action.type === 'type') return fromCheck('own_accounts', checkTypeBox(element, view, ctx))
  return fromCheck('own_accounts', checkTarget(target, element, view, ctx))
}

function loginPage(view: AppView): boolean {
  const parsed = parseUrl(view.url)
  return view.hasPasswordField || LOGIN_TITLE.test(view.title) || (parsed !== null && LOGIN_PATH.test(parsed.pathname))
}

function checkFillCredential(action: Extract<AppAction, { type: 'fill_credential' }>, element: AppElement, view: AppView): SafetyVerdict {
  if (action.field === 'password' && !(element.tag === 'input' && element.inputType === 'password')) {
    return refuse('credentials', 'A password can only go into a password field.')
  }
  if (action.field === 'login' && !(element.tag === 'input' && (element.inputType === null || LOGIN_INPUT_TYPES.includes(element.inputType)))) {
    return refuse('credentials', 'A login name can only go into a text, email or phone field.')
  }
  const passwordFields = [element, ...sameGroup(view, element)].filter((other) => other.inputType === 'password').length
  if (!loginPage(view) || passwordFields > 1 || CHANGE_CREDENTIAL.test(element.name)) {
    return refuse('credentials', 'Credentials are only typed into the sign-in form.')
  }
  return ALLOWED
}

function checkCredentials(action: AppAction, element: AppElement | null, view: AppView | null): SafetyVerdict {
  if (element === null || view === null) return ALLOWED
  if (action.type === 'type' && element.inputType === 'password') {
    return refuse('credentials', 'Passwords are never typed as text; use fill_credential.')
  }
  return action.type === 'fill_credential' ? checkFillCredential(action, element, view) : ALLOWED
}

function destructiveText(text: string): boolean {
  return DESTRUCTIVE_ACTION.test(plain(text)) || PRICE.test(decodeSafely(text))
}

function checkDestructive(action: AppAction, element: AppElement | null, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  if (!DESTRUCTIVE_TYPES.includes(action.type)) return ALLOWED
  const base = view?.url ?? ctx.appUrl
  const addresses: string[] = []
  if (element !== null) {
    if (destructiveText(element.name)) return refuse('destructive', 'This could delete, pay for, log out of or change an account, so it is not allowed.')
    if (action.type === 'type' && ACCOUNT_FIELD.test(element.name)) {
      return refuse('destructive', 'The AI does not type into the email, username or phone of an account.')
    }
    if (element.href !== null) addresses.push(element.href)
  }
  if (action.type === 'open_link' && action.url !== undefined) addresses.push(action.url)
  for (const address of addresses) {
    if (destructiveText(wordsOfUrl(address, base)) || PRICE.test(address)) {
      return refuse('destructive', 'This address could delete, pay for, log out of or change an account, so it is not opened.')
    }
    const parsed = parseUrl(address, base)
    if (parsed !== null && (ACTING_PATH.test(parsed.pathname) || ACTING_QUERY.test(parsed.search))) {
      return refuse('destructive', 'This address does something when opened, instead of showing a page.')
    }
  }
  return ALLOWED
}

function checkPublic(action: AppAction, element: AppElement | null, view: AppView | null, ctx: SafetyContext): SafetyVerdict {
  if (!['click', 'toggle', 'select'].includes(action.type) || element === null || view === null) return ALLOWED
  if (choosesPrivateOption(action, element)) return ALLOWED
  const result = checkPublishing(element.name, element, view, ctx)
  return result.ok ? ALLOWED : refuse('nothing_public', result.reason)
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
  const element = ref === null ? null : (view?.elements.find((candidate) => candidate.ref === ref) ?? null)
  if (ref !== null && element === null) return refuse('unknown_element', 'That element is not on the page.')
  if (action.type === 'open_link' && ref === null && action.url === undefined) {
    return refuse('unknown_element', 'open_link needs an address or an element.')
  }
  const checks = [
    () => checkOwnAccounts(action, element, view, ctx),
    () => checkCredentials(action, element, view),
    () => checkDestructive(action, element, view, ctx),
    () => checkPublic(action, element, view, ctx),
    () => checkScope(action, element, view, ctx),
  ]
  for (const check of checks) {
    const verdict = check()
    if (!verdict.allowed) return verdict
  }
  return ALLOWED
}
