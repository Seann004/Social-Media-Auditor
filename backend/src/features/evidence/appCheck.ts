/**
 * One checklist item, checked inside the app: the AI chooses one action at a time, the safety rules
 * check it, the session carries it out, and every step is recorded as evidence. Setting changes are
 * recorded so that they can be put back.
 */
import { StepDecisionError, type AccountStatus, type DecideStep, type StepPrompt } from './appAgent.js'
import type { AppRepository } from './appRepository.js'
import { checkAction, detectBlock, type SafetyContext } from './appSafety.js'
import type { AppSession, AppSessionPool } from './appSession.js'
import { detectChange, pathOf, recordStep, type StepContext, type StepInput } from './appSteps.js'
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

/** A submit that signs in. Enter in a credential field would count too, but no action presses Enter. */
export const SIGN_IN_CONTROL = /\b(sign ?in|log ?in)\b/i
const SAVE_CONTROL = /\b(save|apply|update|done|confirm)\b/i
/** A login-name box, by its label. */
const LOGIN_FIELD_NAME = /\b(?:user ?name|e-?mail|log ?in|phone,? (?:or|\/) e-?mail|e-?mail,? (?:or|\/) phone)\b/i
const LOGIN_FIELD_TYPES: (string | null)[] = [null, 'text', 'email']
const ON_OFF_ROLES = ['switch', 'checkbox', 'radio']

const UNREADABLE = "The AI's reply could not be read."
const ASKED = 'asked the AI for the next step'
const NOT_A_CREDENTIAL_FIELD = 'A login name or password only goes into a sign-in name or password field.'
/** Stored as the action of a step the AI did not choose: an unreadable reply, or a page that stopped the check. */
const NO_ACTION: AppAction = { type: 'finish', observations: '', evidenceSteps: [] }

/** A password box, or a text or email box whose label says it takes a login name (ruling A14). */
function isCredentialField(el: AppElement): boolean {
  if (el.tag !== 'input') return false
  if (el.inputType === 'password') return true
  return LOGIN_FIELD_TYPES.includes(el.inputType) && LOGIN_FIELD_NAME.test(el.name)
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

function doneDetail(change: { role: string; control: string; after: string } | null, beforeUrl: string | null, afterUrl: string): string {
  if (change !== null) {
    return ON_OFF_ROLES.includes(change.role) ? `"${change.control}" is now ${change.after}` : `"${change.control}" set to "${change.after}"`
  }
  return beforeUrl === afterUrl ? 'page unchanged' : `page ${pathOf(afterUrl)} opened`
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
  /** Per account, the path where the last password was filled: a sign-in that stays there failed. */
  let loginPaths: ReadonlyMap<string, string> = new Map()
  /** Per change, the form or dialog of its control, to tell which Save button saves it. */
  let changeGroups: ReadonlyMap<string, string | null> = new Map()

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
    const saved = await recordStep(stepCtx, { ...step, account, position: steps.length + 1 })
    steps = [...steps, saved]
    await input.onStep?.(saved.position)
    return saved
  }

  /** The page of the current session, with its address as the session shows it. Null when there is none. */
  async function readView(): Promise<AppView | null> {
    const current = session()
    if (current === null) return null
    try {
      const read = await current.read()
      return { ...read, url: current.currentUrl() }
    } catch (err) {
      console.error(`[appCheck] run ${input.run.id}: could not read the page of ${current.account.label}`, err instanceof Error ? err.name : 'error')
      return null
    }
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
    if (target !== null && unusable !== null) return refuse(action, `${target.label} can't be used in this run: ${unusable}`)
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
    const detail = view === null ? 'page unchanged' : `page ${pathOf(view.url)} opened`
    await record({ action, outcome: 'done', detail, refusalReason: null, view, screenshot: view === null ? null : await shoot() })
  }

  async function noteChange(change: NonNullable<ReturnType<typeof detectChange>>, at: AppView, el: AppElement, who: AgentAccount): Promise<void> {
    const row = await deps.appRepo.addChange({
      runId: input.run.id,
      itemId: input.item.id,
      accountId: who.id,
      accountLabel: who.label,
      pageUrl: at.url,
      ...change,
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
    if (action.type === 'fill_credential' && el !== null && !isCredentialField(el)) return refuse(action, NOT_A_CREDENTIAL_FIELD)
    const verdict = checkAction(action, before, safety())
    if (!verdict.allowed) return refuse(action, verdict.reason)
    const current = session()
    const who = account
    if (current === null || who === null) {
      const detail = who === null ? 'No test account is in use.' : `The session of ${who.label} was not available.`
      await record({ action, outcome: 'failed', detail, refusalReason: null, view: before, screenshot: null })
      return
    }
    const result = await current.execute(action)
    const after = await readView()
    const afterUrl = after?.url ?? current.currentUrl()
    view = after
    if (!result.ok) {
      await record({ action, outcome: 'failed', detail: result.detail, refusalReason: null, view: after, describedOn: before, screenshot: after === null ? null : await shoot() })
      return
    }
    const change = before !== null && after !== null ? detectChange(action, before, after) : null
    if (change !== null && before !== null && el !== null) await noteChange(change, before, el, who)
    if (action.type === 'fill_credential' && action.field === 'password' && before !== null) {
      loginPaths = new Map(loginPaths).set(who.id, pathOf(before.url))
    }
    if (action.type === 'click' && el !== null && before !== null) {
      if (SIGN_IN_CONTROL.test(el.name) && loginPaths.get(who.id) === pathOf(afterUrl)) pool.noteLoginFailure(who.id)
      await noteSave(el, before, who)
    }
    const detail = doneDetail(change, before?.url ?? null, afterUrl)
    await record({ action, outcome: 'done', detail, refusalReason: null, view: after, describedOn: before, screenshot: after === null ? null : await shoot() })
  }

  while (steps.length < maxSteps) {
    if (signal.aborted) return outcome({ stop: 'timeout' })
    if (meter.used() >= tokenCap) return outcome({ stop: 'tokens' })
    if (view === null) view = await readView()
    const block = view === null ? null : detectBlock(view)
    if (view !== null && block !== null) {
      await record({ action: NO_ACTION, outcome: 'blocked', detail: block, refusalReason: null, view, screenshot: await shoot(), blocked: true })
      return outcome({ stoppedBy: { url: view.url, detail: block } })
    }

    let action: AppAction
    try {
      const decision = await deps.decideStep({ prompt: prompt(), apiKey: deps.apiKey, model: deps.model })
      meter.add(decision.tokensUsed)
      action = decision.action
      unreadableInARow = 0
    } catch (err) {
      meter.add(tokensOf(err))
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

    if (action.type === 'finish') {
      const known = steps.length
      await record({ action, outcome: 'done', detail: '', refusalReason: null, view: null, screenshot: null })
      const evidenceSteps = [...new Set(action.evidenceSteps)].filter((n) => n >= 1 && n <= known)
      return outcome({ finished: true, evidenceSteps })
    }
    if (action.type === 'switch_account') await switchAccount(action)
    else await act(action)
  }
  return outcome()
}
