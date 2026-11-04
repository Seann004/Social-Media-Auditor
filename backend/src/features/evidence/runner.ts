import type { Browser } from 'playwright'
import { assessBatch as defaultAssessBatch, planBatches, type AssessItem } from './assess.js'
import { getBrowser } from './browser.js'
import { capturePages } from './capture.js'
import { MAX_TOKENS_PER_RUN, RUN_TIMEOUT_MS } from './config.js'
import { captureHighlights } from './highlight.js'
import { createRobotsChecker } from './robots.js'
import { assessAndStore, type BatchContext } from './runnerAssess.js'
import { capturePhase } from './runnerCapture.js'
import { autoMatchAnswers, carryForward, partialSummary, type StopReason } from './runnerFinish.js'
import {
  categoryKey,
  isGroqLimit,
  isRunGone,
  logRunProblem,
  RunAbortedError,
  RunFailure,
  RunGoneError,
  safeMessage,
  updateRun,
  type ResolvedDeps,
  type RunCtx,
  type RunnerDeps,
} from './runnerShared.js'
import type { CapturedPage, EvidenceRun, Suggestion } from './types.js'

export type { RunnerDeps } from './runnerShared.js'

const GENERIC_FAILURE = 'The run stopped unexpectedly. Start it again, or contact the project owner if it keeps happening.'
const NO_PAGE_READ = 'No page could be read: every page needed a login, was blocked, or returned an error.'
const OUT_OF_TIME_NO_PAGE = 'The run ran out of time before any page could be read.'
const CHECKLIST_UNREADABLE = 'The checklist of this project could not be read.'

interface Category {
  key: string
  batches: AssessItem[][]
}

interface Progress {
  done: number
  unassessed: string[]
  stop: StopReason | null
  tokensUsed: number
  created: Suggestion[]
}

function resolve(deps: RunnerDeps): ResolvedDeps {
  return {
    repo: deps.repo,
    screenshots: deps.screenshots,
    audit: deps.audit,
    guard: deps.guard,
    apiKey: deps.apiKey,
    model: deps.model,
    browserProvider: deps.browserProvider ?? getBrowser,
    capture: deps.capture ?? capturePages,
    highlights: deps.highlights ?? captureHighlights,
    assessBatch: deps.assessBatch ?? defaultAssessBatch,
  }
}

/** Categories in checklist order, each with its batches. planBatches keeps a category's batches together. */
function planCategories(items: AssessItem[]): Category[] {
  const categories: Category[] = []
  for (const batch of planBatches(items)) {
    const key = categoryKey(batch[0])
    const last = categories[categories.length - 1]
    if (last && last.key === key) last.batches.push(batch)
    else categories.push({ key, batches: [batch] })
  }
  return categories
}

/** Which categories this run assesses: all, or for a re-assess of the unfinished, those the last result run left. */
async function categoriesToAssess(ctx: RunCtx, items: AssessItem[]): Promise<Category[]> {
  const all = planCategories(items)
  const isReassess = ctx.run.capturedInRunId !== ctx.run.id
  if (!isReassess || ctx.run.scope !== 'unfinished') return all
  const prior = await ctx.deps.repo.latestResultRun(ctx.run.projectId)
  if (!prior || prior.capturedInRunId !== ctx.run.capturedInRunId) return all
  const wanted = new Set(prior.unassessedCategories)
  return all.filter((c) => wanted.has(c.key))
}

function stopBefore(ctx: RunCtx, tokensUsed: number): StopReason | null {
  if (ctx.signal.aborted) return 'timeout'
  return tokensUsed >= MAX_TOKENS_PER_RUN ? 'tokens' : null
}

/** What a failed batch means: a limit stops the run, a timeout too, anything else costs only its category. */
async function stopForFailure(ctx: RunCtx, err: unknown): Promise<StopReason | null> {
  if (err instanceof RunGoneError) throw err
  if (err instanceof RunAbortedError || ctx.signal.aborted) return 'timeout'
  if (isGroqLimit(err)) return 'limit'
  if (await isRunGone(ctx)) throw new RunGoneError()
  logRunProblem(ctx, 'A category could not be assessed', err)
  return null
}

async function assessCategories(ctx: RunCtx, categories: Category[], batch: BatchContext): Promise<Progress> {
  const progress: Progress = { done: 0, unassessed: [], stop: null, tokensUsed: 0, created: [] }
  for (const category of categories) {
    let complete = true
    for (const items of category.batches) {
      progress.stop ??= stopBefore(ctx, progress.tokensUsed)
      if (progress.stop) {
        complete = false
        break
      }
      try {
        const outcome = await assessAndStore(ctx, items, batch)
        progress.tokensUsed += outcome.tokensUsed
        progress.created.push(...outcome.created)
        if (outcome.unassessed > 0) complete = false
      } catch (err) {
        complete = false
        progress.stop = await stopForFailure(ctx, err)
        break
      }
    }
    if (complete) progress.done += 1
    else progress.unassessed.push(category.key)
    await updateRun(ctx, { categoriesDone: progress.done, tokensUsed: progress.tokensUsed })
  }
  return progress
}

async function loadChecklist(ctx: RunCtx): Promise<{ items: AssessItem[]; platform: string }> {
  try {
    const { audit } = ctx.deps
    const items = await audit.listChecklistItems(ctx.run.projectId)
    return { items, platform: await audit.getPlatform(ctx.run.projectId) }
  } catch (err) {
    if (await isRunGone(ctx)) throw new RunGoneError()
    logRunProblem(ctx, 'Could not read the checklist', err)
    throw new RunFailure(CHECKLIST_UNREADABLE)
  }
}

async function fail(ctx: RunCtx, message: string): Promise<void> {
  await updateRun(ctx, { status: 'failed', error: message, finishedAt: new Date().toISOString() })
}

function failedPagesOf(pages: CapturedPage[]): BatchContext['failedPages'] {
  return pages.filter((p) => p.accessStatus !== 'ok').map((p) => ({ url: p.url, status: p.accessStatus }))
}

async function execute(ctx: RunCtx): Promise<void> {
  const isCapture = ctx.run.capturedInRunId === ctx.run.id
  await updateRun(ctx, {
    status: isCapture ? 'capturing' : 'assessing',
    startedAt: new Date().toISOString(),
    model: ctx.deps.model,
  })

  const pages = isCapture ? await capturePhase(ctx) : await ctx.deps.repo.listPages(ctx.run.capturedInRunId)
  if (!pages.some((p) => p.accessStatus === 'ok')) {
    throw new RunFailure(ctx.signal.aborted ? OUT_OF_TIME_NO_PAGE : NO_PAGE_READ)
  }
  await updateRun(ctx, { status: 'assessing', pagesTotal: pages.length, pagesDone: pages.length })

  const { items, platform } = await loadChecklist(ctx)
  const categories = await categoriesToAssess(ctx, items)
  await updateRun(ctx, { categoriesTotal: categories.length })

  const batch: BatchContext = {
    platform,
    pages: new Map(pages.map((p) => [p.id, p])),
    failedPages: failedPagesOf(pages),
  }
  const progress = await assessCategories(ctx, categories, batch)

  if (!isCapture) await carryForward(ctx, items)
  await autoMatchAnswers(ctx, progress.created)

  const unassessed = progress.unassessed.length
  const patch = {
    status: unassessed === 0 ? ('completed' as const) : ('partial' as const),
    unassessedCategories: progress.unassessed,
    categoriesDone: progress.done,
    tokensUsed: progress.tokensUsed,
    error: unassessed === 0 ? null : partialSummary(progress.stop, unassessed),
    finishedAt: new Date().toISOString(),
  }
  // A run left in a working status would block its project until the server restarts.
  if (!(await updateRun(ctx, patch))) await updateRun(ctx, patch)
}

async function endAfterCrash(ctx: RunCtx, err: unknown): Promise<void> {
  if (err instanceof RunGoneError) return
  if (err instanceof RunFailure) return fail(ctx, err.message)
  console.error(`[evidence] Run ${ctx.run.id} failed unexpectedly:`, safeMessage(err, ctx.deps.apiKey))
  return fail(ctx, GENERIC_FAILURE)
}

async function startContext(run: EvidenceRun, deps: ResolvedDeps, signal: AbortSignal): Promise<RunCtx> {
  // Without a permission on record, robots.txt applies.
  const permission = await deps.repo.getPermission(run.projectId).catch(() => null)
  let started: Promise<Browser> | null = null
  return {
    run,
    deps,
    signal,
    robots: permission?.granted === true ? null : createRobotsChecker(deps.guard),
    browser: () => (started ??= deps.browserProvider()),
  }
}

/**
 * Runs one evidence job: capture (or reuse the pages of an earlier run), then assess category by
 * category, store suggestions, and end the run as completed, partial or failed. It never changes
 * an answer or the score, and it never rejects: whatever goes wrong ends up on the run.
 */
export async function runEvidenceJob(runId: string, deps: RunnerDeps): Promise<void> {
  const resolved = resolve(deps)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.runTimeoutMs ?? RUN_TIMEOUT_MS)
  let ctx: RunCtx | null = null
  try {
    const run = await resolved.repo.getRun(runId)
    if (!run) return
    ctx = await startContext(run, resolved, controller.signal)
    await execute(ctx)
  } catch (err) {
    try {
      if (ctx) await endAfterCrash(ctx, err)
      else console.error(`[evidence] Run ${runId} could not start:`, safeMessage(err, deps.apiKey))
    } catch (secondary) {
      console.error(`[evidence] Run ${runId} could not be ended:`, safeMessage(secondary, deps.apiKey))
    }
  } finally {
    clearTimeout(timer)
  }
}
