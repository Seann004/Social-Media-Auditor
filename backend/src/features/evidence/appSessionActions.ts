import type { Page } from 'playwright'
import { chooseOption, DEAD_WORLD_ERROR, elementPoint, focusElement, followLink, markSecretField, opensNewTab } from './appRead.js'
import type { AppAction, AppSource, TestAccount } from './appTypes.js'
import { gotoGuarded } from './browser.js'
import { APP_ACTION_TIMEOUT_MS, APP_MIN_SECRET_CHARS } from './config.js'
import type { IsolatedWorld } from './pageRead.js'
import { decryptSecret, secretAad, SecretUnreadableError } from './secrets.js'
import type { UrlGuard } from './urlGuard.js'

export type ActionResult = { ok: true; detail: string } | { ok: false; detail: string }
export type SessionAction = Exclude<AppAction, { type: 'finish' } | { type: 'switch_account' }>

/** Everything an action needs from its session. Nothing here lets an action read the typed credentials back. */
export interface ActionEnv {
  page: Page
  guard: UrlGuard
  app: AppSource
  account: TestAccount
  secretKey: Buffer
  /** The world of the last read, or null before the first. */
  world(): IsolatedWorld | null
  /** Notes a credential as typed in this session, so that masks and scrubs look for it from then on. */
  remember(secret: string): void
}

export const COVERED = 'The element was covered or had moved, so it was not clicked.'
export const PAGE_CHANGED = 'The page changed before the action, so nothing was done.'

/** The world's document is gone: the page navigated since the last read. */
export class PageChangedError extends Error {
  constructor() {
    super(PAGE_CHANGED)
    this.name = 'PageChangedError'
  }
}

export function isPageChanged(err: unknown): boolean {
  return err instanceof PageChangedError || (err instanceof Error && DEAD_WORLD_ERROR.test(err.message))
}

const OPENED_HERE = 'Clicked. The link opens a new tab, so its page was opened in this one.'
const ok = (detail: string): ActionResult => ({ ok: true, detail })
const fail = (detail: string): ActionResult => ({ ok: false, detail })

function requireWorld(env: ActionEnv): IsolatedWorld {
  const world = env.world()
  if (world === null) throw new PageChangedError()
  return world
}

async function clickElement(env: ActionEnv, ref: string, done: string): Promise<ActionResult> {
  const point = await elementPoint(requireWorld(env), ref)
  if (point === null) return fail(COVERED)
  await env.page.mouse.click(point.x, point.y)
  return ok(done)
}

async function typeText(env: ActionEnv, ref: string, text: string): Promise<ActionResult> {
  if (!(await focusElement(requireWorld(env), ref))) return fail('The field could not be used, so nothing was typed.')
  await env.page.keyboard.insertText(text)
  return ok('Typed the text.')
}

async function openLink(env: ActionEnv, action: { ref?: string; url?: string }): Promise<ActionResult> {
  if (action.ref !== undefined) {
    // The real address is followed from inside the world: it never leaves it.
    return (await followLink(requireWorld(env), action.ref)) ? ok('Followed the link.') : fail('The link could not be followed.')
  }
  if (action.url === undefined) return fail('No link was named.')
  let target: string
  try {
    target = new URL(action.url, env.page.url()).href
  } catch {
    return fail('That is not a valid address.')
  }
  const navigation = await gotoGuarded(env.page, target, env.guard, APP_ACTION_TIMEOUT_MS)
  return navigation.blockedReason === null ? ok('Opened the address.') : fail(navigation.blockedReason)
}

async function goBack(env: ActionEnv): Promise<ActionResult> {
  const before = env.page.url()
  const response = await env.page.goBack({ waitUntil: 'domcontentloaded', timeout: APP_ACTION_TIMEOUT_MS })
  return response === null && env.page.url() === before ? fail('There is no earlier page.') : ok('Went back.')
}

const handleForm = (text: string): string => text.trim().replace(/^@/, '').toLowerCase()

/**
 * Whether a typed value is masked and scrubbed from then on. The password always is. A login name is
 * too unless it is shorter than APP_MIN_SECRET_CHARS or is one of the account's own handles: the handle
 * shows all over the account's own pages, and hiding it there would only lose evidence.
 */
function isKeptSecret(account: TestAccount, field: 'login' | 'password', value: string): boolean {
  if (field === 'password') return true
  if (Array.from(value).length < APP_MIN_SECRET_CHARS) return false
  return !account.handles.some((handle) => handleForm(handle) === handleForm(value))
}

/**
 * Types the account's login name or password into the field. The password is decrypted here and
 * nowhere else. Whatever goes wrong, the result names the account and the field and nothing
 * else: an error's own message could hold what was typed, so it is neither returned nor logged.
 */
async function fillCredential(env: ActionEnv, action: Extract<SessionAction, { type: 'fill_credential' }>): Promise<ActionResult> {
  const { account } = env
  const what = action.field === 'login' ? 'login name' : 'password'
  try {
    if (action.account.trim().toLowerCase() !== account.label.trim().toLowerCase()) {
      return fail(`This session belongs to ${account.label}, so another account's ${what} was not filled.`)
    }
    const value =
      action.field === 'login'
        ? account.loginName
        : decryptSecret(account.passwordCiphertext, env.secretKey, secretAad(account.projectId, account.id))
    if (isKeptSecret(account, action.field, value)) env.remember(value)
    const world = requireWorld(env)
    if (!(await focusElement(world, action.ref))) return fail(`Filling the ${what} of ${account.label} failed.`)
    await markSecretField(world, action.ref)
    await env.page.keyboard.press('ControlOrMeta+a')
    await env.page.keyboard.insertText(value)
    return ok(`Filled the ${what} of ${account.label}.`)
  } catch (err) {
    if (err instanceof SecretUnreadableError) return fail(`The saved password of ${account.label} can't be read. Enter it again.`)
    return fail(`Filling the ${what} of ${account.label} failed.`)
  }
}

/** Carries out one action on the page, with no waiting after it. Throws when the page cannot be worked with. */
export async function perform(env: ActionEnv, action: SessionAction): Promise<ActionResult> {
  switch (action.type) {
    case 'click':
      // New tabs are closed as they open, so a click on such a link would seem to do nothing.
      if (await opensNewTab(requireWorld(env), action.ref)) {
        return (await followLink(requireWorld(env), action.ref)) ? ok(OPENED_HERE) : fail('The link could not be followed.')
      }
      return clickElement(env, action.ref, 'Clicked.')
    case 'toggle':
      return clickElement(env, action.ref, 'Toggled.')
    case 'type':
      return typeText(env, action.ref, action.text)
    case 'select':
      return (await chooseOption(requireWorld(env), action.ref, action.option)) ? ok('Chose the option.') : fail('That option could not be chosen.')
    case 'open_link':
      return openLink(env, action)
    case 'back':
      return goBack(env)
    case 'fill_credential':
      return fillCredential(env, action)
  }
}
