import type { Browser, Page } from 'playwright'
import { createAppGuard, isInAppScope } from './appGuard.js'
import { readAppView, screenshotMasked, withMasks } from './appRead.js'
import {
  isPageChanged,
  PAGE_CHANGED,
  perform,
  type ActionEnv,
  type ActionResult,
  type SessionAction,
} from './appSessionActions.js'
import type { AppSource, AppView, TestAccount } from './appTypes.js'
import {
  gotoGuarded,
  isTimeoutError,
  openRunContext,
  waitForNetworkIdle,
  withinTimeout,
  type GuardedNavigation,
  type RunContext,
} from './browser.js'
import { logCaptureFailure } from './captureLog.js'
import {
  APP_ACTION_TIMEOUT_MS,
  APP_LOGIN_FAILURES_BEFORE_UNUSABLE,
  APP_NETWORK_IDLE_WAIT_MS,
  APP_SETTLE_MS,
} from './config.js'
import { photographQuote as photographQuoteInWorld } from './highlight.js'
import type { IsolatedWorld } from './pageRead.js'
import { redactUrl } from './secrets.js'
import type { UrlGuard } from './urlGuard.js'

export type { ActionResult } from './appSessionActions.js'

export interface AccountRunState {
  readonly loginFailures: number
  readonly unusable: string | null
}

export interface SessionPoolOptions {
  browser: Browser
  baseGuard: UrlGuard
  app: AppSource
  accounts: TestAccount[]
  secretKey: Buffer
  signal: AbortSignal
  aborted: Promise<null>
}

export interface AppSession {
  account: TestAccount
  page: Page
  read(): Promise<AppView>
  execute(action: SessionAction): Promise<ActionResult>
  screenshot(): Promise<Buffer | null>
  gotoInApp(url: string): Promise<GuardedNavigation>
  photographQuote(quote: string): Promise<Buffer | null>
  /** `redactUrl(page.url())`, the only form of the live address that leaves the session. */
  currentUrl(): string
}

export interface AppSessionPool {
  open(accountId: string): Promise<AppSession>
  get(accountId: string): AppSession | null
  stateOf(accountId: string): AccountRunState
  noteLoginFailure(accountId: string): AccountRunState
  resetAll(): Promise<void>
  closeAll(): Promise<void>
}

const OUTSIDE_APP = 'The app moved to an address outside it, so the page was left.'
const TOOK_TOO_LONG = 'The action took too long, so it was given up.'
const FAILED = 'The action could not be carried out.'
const UNUSABLE_REASON = 'signing in failed twice'

interface OpenSession {
  session: AppSession
  context: RunContext
  /** Takes the session back to the app address. */
  reset(): Promise<void>
}

function describeFailure(err: unknown, page: Page): ActionResult {
  if (isPageChanged(err)) return { ok: false, detail: PAGE_CHANGED }
  if (isTimeoutError(err)) return { ok: false, detail: TOOK_TOO_LONG }
  // Only the kind of error: its message could hold text that was typed.
  logCaptureFailure('An action failed', redactUrl(page.url()), err instanceof Error ? err.name : 'error')
  return { ok: false, detail: FAILED }
}

async function createSession(opts: SessionPoolOptions, guard: UrlGuard, account: TestAccount): Promise<OpenSession> {
  const { app, signal } = opts
  const context = await openRunContext({
    browser: opts.browser,
    guard,
    signal,
    aborted: opts.aborted,
    timeoutMs: APP_ACTION_TIMEOUT_MS,
    logUrl: redactUrl(app.appUrl),
    followPageRedirects: true,
  })
  if (context === null) throw new Error(`Could not open a browser session for ${account.label}.`)
  try {
    const page = await context.context.newPage()
    page.setDefaultTimeout(APP_ACTION_TIMEOUT_MS)
    page.on('popup', (popup) => void popup.close().catch(() => undefined))
    const landed = await gotoGuarded(page, app.appUrl, guard, APP_ACTION_TIMEOUT_MS)
    if (landed.blockedReason !== null) throw new Error(`The app address could not be opened: ${landed.blockedReason}`)
    return { ...buildSession(opts, guard, account, page), context }
  } catch (err) {
    await context.end()
    throw err
  }
}

function buildSession(opts: SessionPoolOptions, guard: UrlGuard, account: TestAccount, page: Page): Omit<OpenSession, 'context'> {
  const { app } = opts
  // Private to the session: the last read's world, and the credentials typed so far.
  let world: IsolatedWorld | null = null
  let typed: readonly string[] = []

  const inScope = (): boolean => isInAppScope(page.url(), app.appUrl, app.loginDomains)

  const env: ActionEnv = {
    page,
    guard,
    app,
    account,
    secretKey: opts.secretKey,
    world: () => world,
    remember: (secret) => {
      typed = typed.includes(secret) ? typed : [...typed, secret]
    },
  }

  /** The new document is waited for, then the network, then a moment for the page to settle. */
  async function stabilise(before: string): Promise<void> {
    if (page.url() !== before) await page.waitForLoadState('domcontentloaded')
    await waitForNetworkIdle(page, APP_ACTION_TIMEOUT_MS, APP_NETWORK_IDLE_WAIT_MS)
    const settling = page.url()
    await page.waitForTimeout(APP_SETTLE_MS)
    if (page.url() !== settling) await page.waitForLoadState('domcontentloaded')
  }

  /** Goes back, and failing that to the app address. Never throws. */
  async function returnToApp(): Promise<void> {
    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: APP_ACTION_TIMEOUT_MS }).catch(() => null)
      await page.waitForTimeout(APP_SETTLE_MS)
      if (!inScope()) await gotoGuarded(page, app.appUrl, guard, APP_ACTION_TIMEOUT_MS)
    } catch (err) {
      logCaptureFailure('Could not return to the app', redactUrl(app.appUrl), err)
    }
  }

  async function execute(action: SessionAction): Promise<ActionResult> {
    const before = page.url()
    let result: ActionResult
    try {
      result = await withinTimeout(
        (async () => {
          const done = await perform(env, action)
          if (done.ok) await stabilise(before)
          return done
        })(),
        APP_ACTION_TIMEOUT_MS,
        'The action',
      )
    } catch (err) {
      result = describeFailure(err, page)
    }
    if (inScope()) return result
    await returnToApp()
    return { ok: false, detail: OUTSIDE_APP }
  }

  /** The world of the last read while it is the page's document; otherwise a throwaway one, so that the refs of the last read are left alone. */
  async function withWorld<T>(use: (current: IsolatedWorld) => Promise<T>): Promise<T> {
    if (world !== null && (await isAlive(world))) return use(world)
    const { world: fresh } = await readAppView(page, null, typed)
    try {
      return await use(fresh)
    } finally {
      await fresh.cdp.detach().catch(() => undefined)
    }
  }

  return {
    session: {
      account,
      page,
      async read() {
        const read = await withinTimeout(readAppView(page, world, typed), APP_ACTION_TIMEOUT_MS, 'Reading the page')
        world = read.world
        return read.view
      },
      execute,
      screenshot: () => withWorld((current) => screenshotMasked(page, current, typed)).catch(() => null),
      async gotoInApp(url) {
        const navigation = await gotoGuarded(page, url, guard, APP_ACTION_TIMEOUT_MS)
        if (!inScope()) await returnToApp()
        return navigation
      },
      async photographQuote(quote) {
        if (world === null || !(await isAlive(world))) return null
        const current = world
        try {
          return await withMasks(page, current, () => photographQuoteInWorld(current, quote, redactUrl(page.url()), APP_ACTION_TIMEOUT_MS), typed)
        } catch (err) {
          logCaptureFailure('Could not take the close-up', redactUrl(page.url()), err)
          return null
        }
      },
      currentUrl: () => redactUrl(page.url()),
    },
    async reset() {
      await gotoGuarded(page, app.appUrl, guard, APP_ACTION_TIMEOUT_MS)
      world = null
    },
  }
}

async function isAlive(world: IsolatedWorld): Promise<boolean> {
  try {
    return (await world.evaluate(`typeof globalThis.__evidenceApp === 'object'`)) === true
  } catch {
    return false
  }
}

const NEW_STATE: AccountRunState = { loginFailures: 0, unusable: null }

/** One guarded browser context per test account, each signed in once per run. */
export function createSessionPool(opts: SessionPoolOptions): AppSessionPool {
  const guard = createAppGuard(opts.baseGuard, opts.app.appUrl, opts.app.loginDomains)
  // Both maps are replaced, never changed in place.
  let opening: ReadonlyMap<string, Promise<OpenSession>> = new Map()
  let open: ReadonlyMap<string, OpenSession> = new Map()
  let states: ReadonlyMap<string, AccountRunState> = new Map()

  function openOne(accountId: string): Promise<OpenSession> {
    const account = opts.accounts.find((candidate) => candidate.id === accountId)
    if (account === undefined) return Promise.reject(new Error('That test account is not part of this run.'))
    return createSession(opts, guard, account)
  }

  const stateOf = (accountId: string): AccountRunState => states.get(accountId) ?? NEW_STATE

  return {
    async open(accountId) {
      const pending = opening.get(accountId) ?? openOne(accountId)
      if (!opening.has(accountId)) {
        opening = new Map(opening).set(accountId, pending)
        pending.then(
          (opened) => {
            open = new Map(open).set(accountId, opened)
          },
          () => {
            opening = new Map([...opening].filter(([id]) => id !== accountId))
          },
        )
      }
      return (await pending).session
    },
    get: (accountId) => open.get(accountId)?.session ?? null,
    stateOf,
    noteLoginFailure(accountId) {
      const current = stateOf(accountId)
      const loginFailures = current.loginFailures + 1
      const unusable = current.unusable ?? (loginFailures >= APP_LOGIN_FAILURES_BEFORE_UNUSABLE ? UNUSABLE_REASON : null)
      const next: AccountRunState = { loginFailures, unusable }
      states = new Map(states).set(accountId, next)
      return next
    },
    async resetAll() {
      await Promise.all(
        [...open.values()].map((opened) =>
          opened.reset().catch((err: unknown) => logCaptureFailure('Could not reset a session', redactUrl(opts.app.appUrl), err)),
        ),
      )
    },
    async closeAll() {
      const all = [...open.values()]
      open = new Map()
      opening = new Map()
      await Promise.all(all.map((opened) => opened.context.end()))
    },
  }
}
