/**
 * An app evidence run: for each checklist item the auditor picked, the AI checks it inside the
 * platform's web app with the test accounts, the steps are judged, and every changed setting is put
 * back. A re-assess judges the recorded steps again without a browser. Like a pages run, it never
 * changes an answer or the score.
 */
import { decideStep as groqDecideStep } from './appAgent.js'
import { runCheck, type CheckDeps } from './appCheck.js'
import { judgeItem, liveHighlighter, type JudgeInput } from './appJudge.js'
import type { AppRepository } from './appRepository.js'
import { restoreChanges } from './appRestore.js'
import { unfinishedAppItems } from './appRunPlan.js'
import type { SafetyContext } from './appSafety.js'
import { createSessionPool, type AppSessionPool } from './appSession.js'
import { isAiFinish } from './appSteps.js'
import type { AgentAccount, AppChange, AppSource, AppStep, StoppedBy, TestAccount } from './appTypes.js'
import type { AssessItem } from './assess.js'
import { APP_MAX_TOKENS_PER_RUN } from './config.js'
import type { TokenMeter } from './runnerAssess.js'
import { autoMatchAnswers, carryForward, type StopReason } from './runnerFinish.js'
import {
  categoryKey,
  createMeter,
  isGroqLimit,
  isRunGone,
  loadChecklist,
  logRunProblem,
  RunAbortedError,
  RunFailure,
  RunGoneError,
  updateRun,
  updateRunReliably,
  type AppRunnerDeps,
  type RunCtx,
} from './runnerShared.js'
import type { CapturedPage, Suggestion } from './types.js'

export type { AppRunnerDeps } from './runnerShared.js'

const NOT_CONFIGURED = "Checking inside the app isn't configured on this server."
const SETUP_REMOVED = 'The app address or test accounts were removed before the run started.'

interface Progress {
  done: number
  stop: StopReason | null
  created: Suggestion[]
}

/** What a capture run checks with: the app, its accounts and an open session pool. */
interface CheckSetup {
  appRepo: AppRepository
  checkDeps: CheckDeps
  source: AppSource
  agents: AgentAccount[]
  pool: AppSessionPool
  platform: string
  meter: TokenMeter
}

const plural = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'}`

/** The sentence for the summary of a partial app run. */
export function appPartialSummary(stop: StopReason | null, unchecked: number): string {
  if (stop === 'limit') return `AI daily limit reached; ${plural(unchecked)} not checked`
  if (stop === 'tokens') return `The AI budget for one run was used up; ${plural(unchecked)} not checked`
  if (stop === 'timeout') return `The run ran out of time; ${plural(unchecked)} not checked`
  return `${plural(unchecked)} could not be checked`
}

/** The items this run did not assess whose category lost a carried suggestion. */
export function itemIdsOfLostCategories(items: AssessItem[], lostKeys: string[], ownItemIds: ReadonlySet<string>): string[] {
  const lost = new Set(lostKeys)
  return items.filter((i) => !ownItemIds.has(i.id) && lost.has(categoryKey(i))).map((i) => i.id)
}

const pickedItems = (items: AssessItem[], ids: string[]): AssessItem[] => items.filter((i) => ids.includes(i.id))

function abortedOf(signal: AbortSignal): Promise<null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }))
}

/** What a failed judge call means: a limit or the run's time stops the run; anything else costs only its item. */
async function stopForJudgeFailure(ctx: RunCtx, err: unknown): Promise<StopReason | null> {
  if (err instanceof RunGoneError) throw err
  if (err instanceof RunAbortedError || ctx.signal.aborted) return 'timeout'
  if (isGroqLimit(err)) return 'limit'
  if (await isRunGone(ctx)) throw new RunGoneError()
  logRunProblem(ctx, 'An item could not be judged', err)
  return null
}

/** Judges one item unless the run's time or token budget is spent first. */
async function judgeOrStop(ctx: RunCtx, input: JudgeInput): Promise<{ created: Suggestion | null; stop: StopReason | null }> {
  if (ctx.signal.aborted) return { created: null, stop: 'timeout' }
  if (input.meter.used() >= APP_MAX_TOKENS_PER_RUN) return { created: null, stop: 'tokens' }
  try {
    return { created: await judgeItem(ctx, input), stop: null }
  } catch (err) {
    return { created: null, stop: await stopForJudgeFailure(ctx, err) }
  }
}

const withResult = (progress: Progress, result: { created: Suggestion | null; stop: StopReason | null }): Progress => ({
  done: progress.done + 1,
  stop: result.stop,
  created: result.created === null ? progress.created : [...progress.created, result.created],
})

/** The stored pages of the given steps, for close-ups. Without them, the card shows the step screenshots. */
async function pagesOf(ctx: RunCtx, capturedInRunId: string, steps: AppStep[]): Promise<Map<string, CapturedPage>> {
  const wanted = new Set(steps.flatMap((s) => (s.pageId === null ? [] : [s.pageId])))
  if (wanted.size === 0) return new Map()
  try {
    const pages = await ctx.deps.repo.listPages(capturedInRunId)
    return new Map(pages.filter((p) => wanted.has(p.id)).map((p) => [p.id, p]))
  } catch (err) {
    logRunProblem(ctx, 'Could not read the pages of the steps', err)
    return new Map()
  }
}

/** Puts back what this item's check changed, read afresh so that a check that threw is covered too. Returns what stays changed. Never throws. */
async function putBack(ctx: RunCtx, setup: CheckSetup, itemId: string): Promise<AppChange[]> {
  let changes: AppChange[]
  try {
    changes = await setup.appRepo.listChanges(ctx.run.id, { itemId, unrestoredOnly: true })
  } catch (err) {
    logRunProblem(ctx, `Could not read the changes of item ${itemId}, so they were not put back`, err)
    return []
  }
  const safety: SafetyContext = { accounts: setup.agents, currentAccount: null, appUrl: setup.source.appUrl, loginDomains: setup.source.loginDomains }
  const results = await restoreChanges(setup.pool, changes, setup.appRepo, ctx.signal, safety)
  return results.filter((c) => !c.restored)
}

/** Checks and judges one item. A stop of 'error' leaves the item without a suggestion and lets the run go on. */
async function checkOne(ctx: RunCtx, setup: CheckSetup, item: AssessItem, leftChanged: AppChange[]) {
  const outcome = await runCheck(
    {
      run: { id: ctx.run.id, projectId: ctx.run.projectId },
      item,
      platform: setup.platform,
      accounts: setup.agents,
      app: setup.source,
      pool: setup.pool,
      leftChanged,
      meter: setup.meter,
      signal: ctx.signal,
      onStep: async (position) => {
        await updateRun(ctx, { currentStep: position })
      },
    },
    setup.checkDeps,
  )
  if (outcome.stop !== null) return { created: null, stop: outcome.stop === 'error' ? null : outcome.stop }
  const pages = await pagesOf(ctx, ctx.run.id, outcome.steps)
  return judgeOrStop(ctx, {
    item,
    platform: setup.platform,
    steps: outcome.steps,
    evidenceSteps: outcome.evidenceSteps,
    stoppedBy: outcome.stoppedBy,
    meter: setup.meter,
    highlighter: liveHighlighter(ctx, setup.pool, outcome.steps, pages),
  })
}

async function checkItems(ctx: RunCtx, setup: CheckSetup, items: AssessItem[]): Promise<Progress> {
  let progress: Progress = { done: 0, stop: null, created: [] }
  let leftChanged: AppChange[] = []
  for (const item of items) {
    if (progress.stop !== null) break
    await updateRun(ctx, { currentItemId: item.id, currentStep: 0 })
    let result: { created: Suggestion | null; stop: StopReason | null }
    try {
      result = await checkOne(ctx, setup, item, leftChanged)
    } finally {
      leftChanged = [...leftChanged, ...(await putBack(ctx, setup, item.id))]
    }
    progress = withResult(progress, result)
    await updateRun(ctx, { categoriesDone: progress.done, tokensUsed: setup.meter.used() })
  }
  return progress
}

/** Copies the other suggestions forward, lists what has none of its own, and ends the run completed or partial. */
async function endAppRun(ctx: RunCtx, items: AssessItem[], progress: Progress, notChecked: string[], meter: TokenMeter, anyCapture: boolean): Promise<void> {
  const own = new Set(progress.created.map((s) => s.itemId))
  const lostKeys = await carryForward(ctx, items, own, { anyCapture })
  const uncheckedSet = new Set([...notChecked, ...itemIdsOfLostCategories(items, lostKeys, own)])
  const unchecked = items.filter((i) => uncheckedSet.has(i.id))
  await autoMatchAnswers(ctx, progress.created)
  await updateRunReliably(ctx, {
    status: unchecked.length === 0 ? 'completed' : 'partial',
    uncheckedItemIds: unchecked.map((i) => i.id),
    unassessedCategories: [...new Set(unchecked.map(categoryKey))],
    categoriesDone: progress.done,
    tokensUsed: meter.used(),
    currentItemId: null,
    error: unchecked.length === 0 ? null : appPartialSummary(progress.stop, unchecked.length),
    finishedAt: new Date().toISOString(),
  })
}

function configuredApp(ctx: RunCtx): AppRunnerDeps {
  if (ctx.deps.app === null) throw new RunFailure(NOT_CONFIGURED)
  return ctx.deps.app
}

async function loadAppSetup(ctx: RunCtx, appRepo: AppRepository): Promise<{ source: AppSource; accounts: TestAccount[] }> {
  const source = await appRepo.getAppSource(ctx.run.projectId)
  const accounts = await appRepo.listTestAccounts(ctx.run.projectId)
  if (source === null || accounts.length === 0) throw new RunFailure(SETUP_REMOVED)
  return { source, accounts }
}

async function closePool(ctx: RunCtx, pool: AppSessionPool): Promise<void> {
  try {
    await pool.closeAll()
  } catch (err) {
    logRunProblem(ctx, 'Could not close the app sessions', err)
  }
}

async function checkAndJudge(ctx: RunCtx): Promise<void> {
  const app = configuredApp(ctx)
  const secretKey = app.secretKey
  if (secretKey === null) throw new RunFailure(NOT_CONFIGURED)
  const { source, accounts } = await loadAppSetup(ctx, app.appRepo)
  const { items, platform } = await loadChecklist(ctx)
  const checked = pickedItems(items, ctx.run.checkedItemIds)
  await updateRun(ctx, { categoriesTotal: checked.length })

  const browser = await ctx.browser()
  const pool = createSessionPool({ browser, baseGuard: ctx.deps.guard, app: source, accounts, secretKey, signal: ctx.signal, aborted: abortedOf(ctx.signal) })
  const meter = createMeter()
  const { repo, screenshots, apiKey, model } = ctx.deps
  const setup: CheckSetup = {
    appRepo: app.appRepo,
    checkDeps: { repo, screenshots, appRepo: app.appRepo, decideStep: app.decideStep ?? groqDecideStep, apiKey, model },
    source,
    agents: accounts.map((a) => ({ id: a.id, label: a.label, ageGroup: a.ageGroup, age: a.age, handles: [...a.handles] })),
    pool,
    platform,
    meter,
  }
  let progress: Progress
  try {
    progress = await checkItems(ctx, setup, checked)
  } finally {
    await closePool(ctx, pool)
  }
  const own = new Set(progress.created.map((s) => s.itemId))
  await endAppRun(ctx, items, progress, checked.filter((i) => !own.has(i.id)).map((i) => i.id), meter, true)
}

/** The step numbers the AI named as its evidence when it finished; none when it did not finish. */
function evidenceStepsOf(steps: AppStep[]): number[] {
  const finish = steps.find(isAiFinish)
  if (finish === undefined || finish.action.type !== 'finish') return []
  return [...new Set(finish.action.evidenceSteps)].filter((n) => n >= 1 && n < finish.position)
}

/** The page that stopped the check, from its blocked step. */
function stoppedByOf(steps: AppStep[], pages: ReadonlyMap<string, CapturedPage>): StoppedBy | null {
  const blocked = steps.find((s) => s.outcome === 'blocked' && s.pageId !== null)
  const page = blocked?.pageId ? pages.get(blocked.pageId) : undefined
  return page === undefined ? null : { url: page.finalUrl ?? page.url, detail: page.accessDetail ?? '' }
}

/** The checked items a re-assess judges: every one with steps, or for the unfinished, those still to judge. */
async function reassessTargets(ctx: RunCtx, appRepo: AppRepository, checked: AssessItem[], withSteps: ReadonlySet<string>): Promise<Set<string>> {
  const all = new Set(checked.filter((i) => withSteps.has(i.id)).map((i) => i.id))
  if (ctx.run.scope !== 'unfinished') return all
  const capture = { projectId: ctx.run.projectId, capturedInRunId: ctx.run.capturedInRunId }
  try {
    return new Set(await unfinishedAppItems(ctx.deps.repo, appRepo, capture, [...all]))
  } catch (err) {
    if (await isRunGone(ctx)) throw new RunGoneError()
    logRunProblem(ctx, 'Could not read the earlier suggestions, so every checked item is judged again', err)
    return all
  }
}

async function reassess(ctx: RunCtx): Promise<void> {
  const { appRepo } = configuredApp(ctx)
  const { items, platform } = await loadChecklist(ctx)
  const checked = pickedItems(items, ctx.run.checkedItemIds)
  const steps = await appRepo.listSteps(ctx.run.capturedInRunId)
  const withSteps = new Set(steps.map((s) => s.itemId))
  const targets = await reassessTargets(ctx, appRepo, checked, withSteps)
  await updateRun(ctx, { categoriesTotal: targets.size })

  const pages = await pagesOf(ctx, ctx.run.capturedInRunId, steps.filter((s) => s.outcome === 'blocked'))
  const meter = createMeter()
  let progress: Progress = { done: 0, stop: null, created: [] }
  for (const item of checked.filter((i) => targets.has(i.id))) {
    if (progress.stop !== null) break
    await updateRun(ctx, { currentItemId: item.id, currentStep: 0 })
    const itemSteps = steps.filter((s) => s.itemId === item.id)
    const result = await judgeOrStop(ctx, {
      item,
      platform,
      steps: itemSteps,
      evidenceSteps: evidenceStepsOf(itemSteps),
      stoppedBy: stoppedByOf(itemSteps, pages),
      meter,
      highlighter: null,
    })
    progress = withResult(progress, result)
    await updateRun(ctx, { categoriesDone: progress.done, tokensUsed: meter.used() })
  }
  const own = new Set(progress.created.map((s) => s.itemId))
  // An item not judged again keeps its carried suggestion, unless it was never opened in the app.
  const notChecked = checked.filter((i) => !own.has(i.id) && (targets.has(i.id) || !withSteps.has(i.id))).map((i) => i.id)
  await endAppRun(ctx, items, progress, notChecked, meter, false)
}

/**
 * Runs an app run: a capture run checks each picked item in the app, a re-assess judges the steps an
 * earlier app run recorded. Robots.txt and the recorded permission do not apply. Whatever goes wrong
 * is thrown on to runEvidenceJob, which ends the run.
 */
export async function executeAppRun(ctx: RunCtx): Promise<void> {
  const isCapture = ctx.run.capturedInRunId === ctx.run.id
  await updateRun(ctx, { status: isCapture ? 'capturing' : 'assessing', startedAt: new Date().toISOString(), model: ctx.deps.model })
  if (isCapture) await checkAndJudge(ctx)
  else await reassess(ctx)
}
