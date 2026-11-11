import type { Browser, Page, Request } from 'playwright'
import { createAppGuard, isInAppScope } from './appGuard.js'
import { isWorldAlive, readAppView, screenshotMasked, withMasks } from './appRead.js'
import {
  isPageChanged,
  PAGE_CHANGED,
  perform,
  type ActionEnv,
  type ActionResult,
  type SessionAction,
} from './appSessionActions.js'
import { shownAddress } from './appSessionUrl.js'
import type { AppSource, AppView, TestAccount } from './appTypes.js'
import {
  gotoGuarded,
  isMainFrameNavigation,
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
  /** The live address with typed credentials and secret parameters hidden: the only form of the live address that leaves the session. */
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
const LINK_OUTSIDE = 'The link led outside the app, so it was not followed.'
const STILL_LOADING = 'The page was still loading.'

/** Whether a done action's result says the page had not settled: what it shows may still change. */
export function wasStillLoading(result: { ok: boolean; detail: string }): boolean {
  return result.ok && result.detail.endsWith(STILL_LOADING)
}
const TOOK_TOO_LONG = 'The action took too long, so it was given up.'
const FAILED = 'The action could not be carried out.'
const UNUSABLE_REASON = 'signing in failed twice'

interface OpenSession {
  session: AppSession
  context: RunContext
  /** Takes the session back to the app address. */
  reset(): Promise<void>
}

function describeFailure(err: unknown, address: string): ActionResult {
  if (isPageChanged(err)) return { ok: false, detail: PAGE_CHANGED }
  if (isTimeoutError(err)) return { ok: false, detail: TOOK_TOO_LONG }
  // Only the kind of error: its message could hold text that was typed.
  logCaptureFailure('An action failed', address, err instanceof Error ? err.name : 'error')
  return { ok: false, detail: FAILED }
}

async function createSession(opts: SessionPoolOptions, guard: UrlGuard, account: TestAccount): Promise<OpenSession> {
  const { app, signal } = opts
  // Files may come from any host the base guard allows; documents only from the app's scope (ruling A28).
  const context = await openRunContext({
    browser: opts.browser,
    guard: opts.baseGuard,
    documentGuard: guard,
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
  const shown = (): string => shownAddress(page.url(), typed)

  // How many main-frame navigations the guard has stopped so far: a stopped link leaves no trace in the address.
  let stopped = 0
  page.on('requestfailed', (request) => {
    if (isMainFrameNavigation(request) && request.failure()?.errorText.includes('ERR_BLOCKED_BY_CLIENT')) stopped += 1
  })

  // Main-frame navigations that have started and not yet finished, to tell a slow page from a click that did nothing.
  let loading: ReadonlySet<Request> = new Set()
  const finished = (request: Request): void => {
    loading = new Set([...loading].filter((other) => other !== request))
  }
  page.on('request', (request) => {
    if (isMainFrameNavigation(request)) loading = new Set([...loading, request])
  })
  page.on('requestfinished', finished)
  page.on('requestfailed', finished)

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

  /**
   * The action has been carried out: waiting for the page has its own budget, and running out of it is
   * not a failure (a false failure invites the AI to do it again).
   */
  async function settle(before: string, done: ActionResult): Promise<ActionResult> {
    try {
      await withinTimeout(stabilise(before), APP_ACTION_TIMEOUT_MS, 'Waiting for the page')
      return loading.size > 0 ? { ok: true, detail: `${done.detail} ${STILL_LOADING}` } : done
    } catch (err) {
      return isTimeoutError(err) ? { ok: true, detail: `${done.detail} ${STILL_LOADING}` } : describeFailure(err, shown())
    }
  }

  /** Goes back, and failing that to the app address. Bounded, and never throws. */
  async function returnToApp(): Promise<void> {
    const back = async (): Promise<void> => {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: APP_ACTION_TIMEOUT_MS }).catch(() => null)
      await page.waitForTimeout(APP_SETTLE_MS)
      if (!inScope()) await gotoGuarded(page, app.appUrl, guard, APP_ACTION_TIMEOUT_MS)
    }
    try {
      await withinTimeout(back(), APP_ACTION_TIMEOUT_MS, 'Returning to the app')
    } catch (err) {
      logCaptureFailure('Could not return to the app', shown(), err)
    }
  }

  async function execute(action: SessionAction): Promise<ActionResult> {
    const before = page.url()
    const stoppedBefore = stopped
    let result: ActionResult
    try {
      result = await withinTimeout(perform(env, action), APP_ACTION_TIMEOUT_MS, 'The action')
      if (result.ok) result = await settle(before, result)
    } catch (err) {
      result = describeFailure(err, shown())
    }
    const linkStopped = stopped > stoppedBefore
    if (inScope()) return linkStopped && result.ok ? { ok: false, detail: LINK_OUTSIDE } : result
    await returnToApp()
    return { ok: false, detail: linkStopped ? LINK_OUTSIDE : OUTSIDE_APP }
  }

  /** The world of the last read while it is the page's document; otherwise a throwaway one, so that the refs of the last read are left alone. */
  async function withWorld<T>(use: (current: IsolatedWorld) => Promise<T>): Promise<T> {
    if (world !== null && (await isWorldAlive(world))) return use(world)
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
      screenshot: () =>
        withinTimeout(
          withWorld((current) => screenshotMasked(page, current, typed)),
          APP_ACTION_TIMEOUT_MS,
          'Taking the screenshot',
        ).catch((err: unknown) => {
          logCaptureFailure('Could not take the screenshot', shown(), err)
          return null
        }),
      async gotoInApp(url) {
        const navigation = await gotoGuarded(page, url, guard, APP_ACTION_TIMEOUT_MS)
        if (!inScope()) await returnToApp()
        return navigation
      },
      async photographQuote(quote) {
        const current = world
        if (current === null) return null
        try {
          const shot = async (): Promise<Buffer | null> =>
            (await isWorldAlive(current))
              ? withMasks(page, current, () => photographQuoteInWorld(current, quote, shown(), APP_ACTION_TIMEOUT_MS), typed)
              : null
          return await withinTimeout(shot(), APP_ACTION_TIMEOUT_MS, 'Taking the close-up')
        } catch (err) {
          logCaptureFailure('Could not take the close-up', shown(), err)
          return null
        }
      },
      currentUrl: shown,
    },
    async reset() {
      // The old document is gone whatever happens next, so the next read opens a new world on whatever page is showing.
      world = null
      const reopened = await gotoGuarded(page, app.appUrl, guard, APP_ACTION_TIMEOUT_MS)
      if (reopened.blockedReason !== null) throw new Error(`The app address could not be reopened: ${reopened.blockedReason}`)
    },
  }
}

const NEW_STATE: AccountRunState = Object.freeze({ loginFailures: 0, unusable: null })

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
      // An open still under way finishes first, so that its context is closed too.
      await Promise.allSettled([...opening.values()])
      const all = [...open.values()]
      open = new Map()
      opening = new Map()
      await Promise.all(all.map((opened) => opened.context.end()))
    },
  }
}
