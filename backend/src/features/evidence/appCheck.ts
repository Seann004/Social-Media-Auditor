/**
 * One checklist item, checked inside the app: the AI chooses one action at a time, the safety rules
 * check it, the session carries it out, and every step is recorded as evidence. Setting changes are
 * recorded so that they can be put back.
 */
import { StepDecisionError, type AccountStatus, type DecideStep, type StepPrompt } from './appAgent.js'
import type { AppRepository } from './appRepository.js'
import { isRepeat, labelOf, pageState, REPEATED_ACTION, type DoneAction } from './appRepeat.js'
import { pageDetail } from './appStepNotes.js'
import { checkAction, detectBlock, type SafetyContext } from './appSafety.js'
import type { AppSession, AppSessionPool } from './appSession.js'
import {
  detectChange,
  FINISHED_TOO_EARLY,
  isAiFinish,
  ON_OFF_CHANGE_ROLES,
  pathOf,
  recordStep,
  touchesSetting,
  unknownChange,
  type DetectedChange,
  type StepContext,
  type StepInput,
} from './appSteps.js'
import type { AgentAccount, AppAction, AppChange, AppElement, AppSource, AppStep, AppView, StoppedBy } from './appTypes.js'
import type { AssessItem } from './assess.js'
import { APP_MAX_STEPS_PER_CHECK, APP_MAX_TOKENS_PER_RUN, APP_UNREADABLE_REPLIES_BEFORE_STOP } from './config.js'
import type { EvidenceRepository, ScreenshotStore } from './repository.js'
import type { TokenMeter } from './runnerAssess.js'
import type { StopReason } from './runnerFinish.js'
import { isGroqLimit, safeMessage } from './runnerShared.js'

export interface CheckInput {
  run: { id: string; projectId: string }
  item: AssessItem
  platform: string
  accounts: AgentAccount[]
  app: AppSource
  pool: AppSessionPool
  /** Changes earlier checks could not put back. */
  leftChanged: AppChange[]
  meter: TokenMeter
  signal: AbortSignal
  /** Called after each recorded step, with its position. */
  onStep?: (position: number) => Promise<void>
}

export interface CheckDeps {
  repo: EvidenceRepository
  screenshots: ScreenshotStore
  appRepo: AppRepository
  decideStep: DecideStep
  apiKey: string
  model: string
  maxSteps?: number
  tokenCap?: number
}

export interface CheckOutcome {
  steps: AppStep[]
  changes: AppChange[]
  finished: boolean
  evidenceSteps: number[]
  stoppedBy: StoppedBy | null
  /** 'error': the AI failed in a way other than a limit, which ends only this check. */
  stop: StopReason | 'error' | null
}

export { REPEATED_ACTION } from './appRepeat.js'

/** A submit that signs in. Enter in a credential field would count too, but no action presses Enter. */
export const SIGN_IN_CONTROL = /\b(sign ?in|log ?in)\b/i
const SAVE_CONTROL = /\b(save|apply|update|done|confirm)\b/i
/** A login-name box, by its label. */
const LOGIN_FIELD_NAME = /\b(?:user ?name|e-?mail|log ?in|phone,? (?:or|\/) e-?mail|e-?mail,? (?:or|\/) phone)\b/i
const LOGIN_FIELD_TYPES: (string | null)[] = [null, 'text', 'email']

const UNREADABLE = "The AI's reply could not be read."
const ASKED = 'asked the AI for the next step'
const PAGE_UNREADABLE = 'The app page could not be read, so the check stopped.'
const READ_PAGE = 'read the page'
/** Failed reads of the session's page in a row that end the check: the AI is not asked about pages it cannot see. */
const UNREADABLE_PAGES_BEFORE_STOP = 2
/** Done steps needed after the first sign-in before a finish is accepted at once. */
const DONE_STEPS_BEFORE_FINISH = 3
const NOT_A_CREDENTIAL_FIELD = 'A login name or password only goes into a sign-in name or password field.'
const NOT_THE_SIGN_IN_FORM = 'A login name only goes into the sign-in form, next to its password field.'
/** Stored as the action of a step the AI did not choose: an unreadable reply, or a page that stopped the check. */
const NO_ACTION: AppAction = { type: 'finish', observations: '', evidenceSteps: [] }

/** A password box, or a text or email box whose label says it takes a login name (ruling A14). */
function isCredentialField(el: AppElement): boolean {
  if (el.tag !== 'input') return false
  if (el.inputType === 'password') return true
  return LOGIN_FIELD_TYPES.includes(el.inputType) && LOGIN_FIELD_NAME.test(el.name)
}

/** A login-name box shares a form or dialog with a password field, or the page has a password field and no forms (ruling A14b). */
function besidePasswordField(el: AppElement, view: AppView): boolean {
  const passwords = view.elements.filter((other) => other.inputType === 'password')
  if (passwords.some((other) => other.groupId !== null && other.groupId === el.groupId)) return true
  return el.groupId === null && passwords.length > 0 && passwords.every((other) => other.groupId === null)
}

const unusableReason = (label: string, why: string): string => `${label} can't be used in this run: ${why}`

/**
 * The checks this loop makes before the safety rules: an unusable account signs in no more (ruling A19),
 * and credentials go only into credential fields (rulings A14, A14b). Null when none applies.
 */
function credentialRefusal(action: AppAction, el: AppElement | null, view: AppView | null, who: AgentAccount | null, unusable: string | null): string | null {
  const signingIn = action.type === 'fill_credential' || (action.type === 'click' && el !== null && SIGN_IN_CONTROL.test(el.name))
  if (signingIn && who !== null && unusable !== null) return unusableReason(who.label, unusable)
  if (action.type !== 'fill_credential' || el === null) return null
  if (!isCredentialField(el)) return NOT_A_CREDENTIAL_FIELD
  if (action.field === 'login' && view !== null && !besidePasswordField(el, view)) return NOT_THE_SIGN_IN_FORM
  return null
}

function tokensOf(err: unknown): number {
  const tokens = (err as { tokensUsed?: unknown } | null)?.tokensUsed
  return typeof tokens === 'number' ? tokens : 0
}

function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function leftChangedLine(change: AppChange): string {
  return `${change.accountLabel}: "${change.control}" on ${pathOf(change.pageUrl)} is ${change.after} (was ${change.before})`
}

/** `typed`: every text the AI typed in this check, so that the page repeating one is not quoted as its message (ruling A20). */
function doneDetail(change: DetectedChange | null, typed: readonly string[], before: AppView | null, after: AppView | null, afterUrl: string): string {
  if (change !== null) {
    if (change.chosen !== undefined) return `"${change.chosen}" is now on`
    return ON_OFF_CHANGE_ROLES.includes(change.role) ? `"${change.control}" is now ${change.after}` : `"${change.control}" set to "${change.after}"`
  }
  return pageDetail(before, after, afterUrl, typed)
}

export async function runCheck(input: CheckInput, deps: CheckDeps): Promise<CheckOutcome> {
  const { pool, meter, signal } = input
  const maxSteps = deps.maxSteps ?? APP_MAX_STEPS_PER_CHECK
  const tokenCap = deps.tokenCap ?? APP_MAX_TOKENS_PER_RUN
  const stepCtx: StepContext = { run: input.run, itemId: input.item.id, repo: deps.repo, screenshots: deps.screenshots, appRepo: deps.appRepo }

  // The loop's state: every collection is replaced, never changed in place.
  let steps: readonly AppStep[] = []
  let changes: readonly AppChange[] = []
  let account: AgentAccount | null = null
  let view: AppView | null = null
  let unreadableInARow = 0
  let unreadPagesInARow = 0
  /** Per account, the path where the last password was filled: a sign-in that stays there failed. */
  let loginPaths: ReadonlyMap<string, string> = new Map()
  /** Per change, the form or dialog of its control, to tell which Save button saves it. */
  let changeGroups: ReadonlyMap<string, string | null> = new Map()
  /**
   * For the early-finish rule: the path reached right after the first sign-in (or, before any sign-in,
   * after the first account switch), the done steps since, and the paths they reached.
   */
  let landing: string | null = null
  let signedIn = false
  let doneSinceLanding = 0
  let pathsSinceLanding: ReadonlySet<string> = new Set()
  let earlyFinishRefused = false
  /** The last step when it was a done action: an identical action next, on an unchanged page, is refused. */
  let lastDone: DoneAction | null = null

  await pool.resetAll()

  const outcome = (extra: Partial<CheckOutcome> = {}): CheckOutcome => ({
    steps: [...steps],
    changes: [...changes],
    finished: false,
    evidenceSteps: [],
    stoppedBy: null,
    stop: null,
    ...extra,
  })
  const session = (): AppSession | null => (account === null ? null : pool.get(account.id))
  const safety = (): SafetyContext => ({ accounts: input.accounts, currentAccount: account, appUrl: input.app.appUrl, loginDomains: input.app.loginDomains })

  async function record(step: Omit<StepInput, 'position' | 'account'>): Promise<AppStep> {
    lastDone = null
    const saved = await recordStep(stepCtx, { ...step, account, position: steps.length + 1 })
    steps = [...steps, saved]
    await input.onStep?.(saved.position)
    return saved
  }

  /** The page of the current session, with its address as the session shows it. Null when there is none. */
  async function readView(): Promise<AppView | null> {
    const current = session()
    if (current === null) {
      // An account in use whose session is gone is a page that cannot be read; no account yet is not.
      if (account !== null) unreadPagesInARow += 1
      return null
    }
    try {
      const read = await current.read()
      unreadPagesInARow = 0
      return { ...read, url: current.currentUrl() }
    } catch (err) {
      unreadPagesInARow += 1
      console.error(`[appCheck] run ${input.run.id}: could not read the page of ${current.account.label}`, err instanceof Error ? err.name : 'error')
      return null
    }
  }

  /** Notes a done step for the early-finish rule. */
  function noteExplored(url: string, kind: 'sign-in' | 'switch' | 'other'): void {
    const path = pathOf(url)
    if (kind === 'sign-in' && !signedIn) {
      signedIn = true
      landing = path
      doneSinceLanding = 0
      pathsSinceLanding = new Set()
      return
    }
    if (landing === null) {
      if (kind === 'switch') landing = path
      return
    }
    doneSinceLanding += 1
    pathsSinceLanding = new Set(pathsSinceLanding).add(path)
  }

  /** Another page than the landing page was opened; a sign-in page (where a password was filled) does not count. */
  function leftLanding(): boolean {
    const signInPaths = new Set(loginPaths.values())
    return [...pathsSinceLanding].some((path) => path !== landing && !signInPaths.has(path))
  }

  /** A finish is refused once when it comes before the check has explored, unless it is the last step allowed. */
  function finishTooEarly(): boolean {
    if (earlyFinishRefused || steps.length + 1 >= maxSteps) return false
    return doneSinceLanding < DONE_STEPS_BEFORE_FINISH || !leftLanding()
  }

  const shoot = async (): Promise<Buffer | null> => (await session()?.screenshot()) ?? null

  async function refuse(action: AppAction, reason: string): Promise<void> {
    await record({ action, outcome: 'refused', detail: '', refusalReason: reason, view, screenshot: view === null ? null : await shoot() })
  }

  function accountStatus(a: AgentAccount): AccountStatus {
    const { unusable } = pool.stateOf(a.id)
    const status = unusable !== null ? `unusable: ${unusable}` : pool.get(a.id) !== null ? 'open' : 'not opened'
    return { id: a.id, label: a.label, ageGroup: a.ageGroup, age: a.age, handles: [...a.handles], session: status }
  }

  function prompt(): StepPrompt {
    return {
      item: input.item,
      platform: input.platform,
      accounts: input.accounts.map(accountStatus),
      currentAccount: account?.label ?? null,
      view,
      history: steps.map((s) => s.line),
      leftChanged: input.leftChanged.map(leftChangedLine),
      stepsLeft: maxSteps - steps.length,
    }
  }

  async function switchAccount(action: Extract<AppAction, { type: 'switch_account' }>): Promise<void> {
    const target = input.accounts.find((a) => sameLabel(a.label, action.account)) ?? null
    const unusable = target === null ? null : pool.stateOf(target.id).unusable
    if (target !== null && unusable !== null) return refuse(action, unusableReason(target.label, unusable))
    const verdict = checkAction(action, view, safety())
    if (!verdict.allowed) return refuse(action, verdict.reason)
    if (target === null) return refuse(action, 'That test account is not part of this run.')
    try {
      await pool.open(target.id)
    } catch (err) {
      console.error(`[appCheck] run ${input.run.id}: could not open the session of ${target.label}`, err instanceof Error ? err.name : 'error')
      await record({ action, outcome: 'failed', detail: `The session of ${target.label} could not be opened.`, refusalReason: null, view: null, screenshot: null })
      return
    }
    account = target
    view = await readView()
    const detail = view === null ? 'page unchanged' : pageDetail(null, view, view.url)
    await record({ action, outcome: 'done', detail, refusalReason: null, view, screenshot: view === null ? null : await shoot() })
    noteExplored(view?.url ?? pool.get(target.id)?.currentUrl() ?? '', 'switch')
  }

  async function noteChange(change: DetectedChange, at: AppView, el: AppElement, who: AgentAccount): Promise<void> {
    const row = await deps.appRepo.addChange({
      runId: input.run.id,
      itemId: input.item.id,
      accountId: who.id,
      accountLabel: who.label,
      pageUrl: at.url,
      role: change.role,
      control: change.control,
      before: change.before,
      after: change.after,
      saveControl: null,
    })
    changes = [...changes, row]
    changeGroups = new Map(changeGroups).set(row.id, el.groupId)
  }

  /** A Save-like click on the path of unsaved changes saves them: those in its own form or dialog, or else all of them. */
  async function noteSave(el: AppElement, at: AppView, who: AgentAccount): Promise<void> {
    if (!SAVE_CONTROL.test(el.name)) return
    const unsaved = changes.filter((c) => c.saveControl === null && c.accountId === who.id && pathOf(c.pageUrl) === pathOf(at.url))
    const sameGroup = unsaved.filter((c) => el.groupId !== null && changeGroups.get(c.id) === el.groupId)
    const saved = sameGroup.length > 0 ? sameGroup : unsaved
    for (const change of saved) {
      const updated = await deps.appRepo.updateChange(change.id, { saveControl: el.name })
      changes = changes.map((c) => (c.id === updated.id ? updated : c))
    }
  }

  async function act(action: Exclude<AppAction, { type: 'finish' } | { type: 'switch_account' }>): Promise<void> {
    const before = view
    const el = 'ref' in action && action.ref !== undefined ? (before?.elements.find((e) => e.ref === action.ref) ?? null) : null
    const refusal = credentialRefusal(action, el, before, account, account === null ? null : pool.stateOf(account.id).unusable)
    if (refusal !== null) return refuse(action, refusal)
    const verdict = checkAction(action, before, safety())
    if (!verdict.allowed) return refuse(action, verdict.reason)
    if (isRepeat(lastDone, action, el, before)) {
      // Kept, so that the same action a third time is refused too.
      const kept = lastDone
      await refuse(action, REPEATED_ACTION)
      lastDone = kept
      return
    }
    const current = session()
    const who = account
    if (current === null || who === null) {
      const detail = who === null ? 'No test account is in use.' : `The session of ${who.label} was not available.`
      await record({ action, outcome: 'failed', detail, refusalReason: null, view: null, screenshot: null })
      return
    }
    const result = await current.execute(action)
    const setting = before !== null && touchesSetting(action, before)
    // A setting action may have acted even when it reports failure, so its page is read again if need be (ruling A16).
    const after = (await readView()) ?? (setting ? await readView() : null)
    const afterUrl = after?.url ?? current.currentUrl()
    view = after
    const change = before === null ? null : after === null ? unknownChange(action, before) : detectChange(action, before, after)
    if (change !== null && before !== null && el !== null) await noteChange(change, before, el, who)
    if (!result.ok) {
      await record({ action, outcome: 'failed', detail: result.detail, refusalReason: null, view: after, describedOn: before, screenshot: after === null ? null : await shoot() })
      return
    }
    if (action.type === 'fill_credential' && action.field === 'password' && before !== null) {
      loginPaths = new Map(loginPaths).set(who.id, pathOf(before.url))
    }
    let signedInNow = false
    if (action.type === 'click' && el !== null && before !== null) {
      // Still on the login path with a password field showing: the sign-in failed (ruling A18).
      const stillSigningIn = loginPaths.get(who.id) === pathOf(afterUrl) && after?.hasPasswordField === true
      const signInControl = SIGN_IN_CONTROL.test(el.name)
      if (signInControl && stillSigningIn) pool.noteLoginFailure(who.id)
      // A sign-in counts only after a password was filled for the account: a "Log in" link on a public page is not one.
      signedInNow = signInControl && loginPaths.has(who.id) && !stillSigningIn
      await noteSave(el, before, who)
    }
    const typed = [...steps, { action }].flatMap((s) => (s.action.type === 'type' ? [s.action.text] : []))
    const detail = doneDetail(change, typed, before, after, afterUrl)
    await record({ action, outcome: 'done', detail, refusalReason: null, view: after, describedOn: before, screenshot: after === null ? null : await shoot() })
    if (before !== null && after !== null) {
      lastDone = { action, label: labelOf(el), before: pageState(before), after: pageState(after) }
    }
    noteExplored(afterUrl, signedInNow ? 'sign-in' : 'other')
  }

  while (steps.length < maxSteps) {
    if (signal.aborted) return outcome({ stop: 'timeout' })
    if (meter.used() >= tokenCap) return outcome({ stop: 'tokens' })
    if (view === null) view = await readView()
    if (view === null && unreadPagesInARow >= UNREADABLE_PAGES_BEFORE_STOP) {
      await record({ action: NO_ACTION, outcome: 'failed', detail: PAGE_UNREADABLE, refusalReason: null, view: null, screenshot: null, description: READ_PAGE })
      return outcome({ stop: 'error' })
    }
    const block = view === null ? null : detectBlock(view)
    if (view !== null && block !== null) {
      await record({ action: NO_ACTION, outcome: 'blocked', detail: block, refusalReason: null, view, screenshot: await shoot(), blocked: true })
      return outcome({ stoppedBy: { url: view.url, detail: block } })
    }

    let action: AppAction
    try {
      const decision = await deps.decideStep({ prompt: prompt(), apiKey: deps.apiKey, model: deps.model, signal, runId: input.run.id })
      meter.add(decision.tokensUsed)
      action = decision.action
      unreadableInARow = 0
    } catch (err) {
      meter.add(tokensOf(err))
      // The run's time ran out while the AI was being asked.
      if (signal.aborted) return outcome({ stop: 'timeout' })
      if (isGroqLimit(err)) return outcome({ stop: 'limit' })
      if (!(err instanceof StepDecisionError)) {
        console.error(`[appCheck] run ${input.run.id}, item ${input.item.id}: the AI failed, so the check ends`, safeMessage(err, deps.apiKey))
        return outcome({ stop: 'error' })
      }
      unreadableInARow += 1
      await record({ action: NO_ACTION, outcome: 'failed', detail: UNREADABLE, refusalReason: null, view: null, screenshot: null, description: ASKED })
      if (unreadableInARow >= APP_UNREADABLE_REPLIES_BEFORE_STOP) return outcome()
      continue
    }

    if (action.type === 'finish' && finishTooEarly()) {
      earlyFinishRefused = true
      // Recorded with no page, like an accepted finish, so the newest page of each account stays the one the AI acted on.
      await record({ action, outcome: 'refused', detail: '', refusalReason: FINISHED_TOO_EARLY, view: null, screenshot: null })
      continue
    }
    if (action.type === 'finish') {
      const known = steps.length
      const saved = await record({ action, outcome: 'done', detail: '', refusalReason: null, view: null, screenshot: null })
      const evidenceSteps = [...new Set(action.evidenceSteps)].filter((n) => n >= 1 && n <= known)
      return outcome({ finished: isAiFinish(saved), evidenceSteps })
    }
    if (action.type === 'switch_account') await switchAccount(action)
    else await act(action)
  }
  return outcome()
}
