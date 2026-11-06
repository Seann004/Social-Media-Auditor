import type { Browser } from 'playwright'
import { assessBatch as defaultAssessBatch, type AssessItem } from './assess.js'
import { getBrowser } from './browser.js'
import { capturePages } from './capture.js'
import { MAX_TOKENS_PER_RUN, RUN_TIMEOUT_MS, RUN_UPDATE_RETRY_DELAYS_MS } from './config.js'
import { captureHighlights } from './highlight.js'
import { relevantFailedPages } from './failedPages.js'
import { createRobotsChecker } from './robots.js'
import { planCategories, unfinishedCategories, type Category } from './runPlan.js'
import { assessAndStore, type BatchContext, type TokenMeter } from './runnerAssess.js'
import { capturePhase } from './runnerCapture.js'
import { autoMatchAnswers, carryForward, partialSummary, type StopReason } from './runnerFinish.js'
import {
  isGroqLimit,
  isRunGone,
  logRunProblem,
  readRunReliably,
  RunAbortedError,
  RunFailure,
  RunGoneError,
  safeMessage,
  updateRun,
  updateRunReliably,
  type ResolvedDeps,
  type RunCtx,
  type RunHandle,
  type RunnerDeps,
} from './runnerShared.js'
import type { CapturedPage, EvidenceRun, Suggestion } from './types.js'

export type { RunnerDeps } from './runnerShared.js'

const GENERIC_FAILURE = 'The run stopped unexpectedly. Start it again, or contact the project owner if it keeps happening.'
const NO_PAGE_READ = 'No page could be read: every page needed a login, was blocked, or returned an error.'
const PAGES_NOT_SAVED = 'The pages were captured but could not be saved, so there was nothing to assess. Start the run again.'
const OUT_OF_TIME_NO_PAGE = 'The run ran out of time before any page could be read.'
const CHECKLIST_UNREADABLE = 'The checklist of this project could not be read because the database did not answer. Start the run again later.'
const COULD_NOT_START = 'The run could not be started because it could not be read from the database. Start it again.'

interface Progress {
  done: number
  unassessed: string[]
  stop: StopReason | null
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
    retryDelaysMs: deps.retryDelaysMs ?? RUN_UPDATE_RETRY_DELAYS_MS,
  }
}

/** Which categories this run assesses: all of them, or for a re-assess of the unfinished, those still to do. */
async function categoriesToAssess(ctx: RunCtx, items: AssessItem[]): Promise<Category[]> {
  const isReassess = ctx.run.capturedInRunId !== ctx.run.id
  if (!isReassess || ctx.run.scope !== 'unfinished') return planCategories(items)
  return unfinishedCategories(ctx.deps.repo, ctx.run, items, async (err) => {
    if (await isRunGone(ctx)) throw new RunGoneError()
    logRunProblem(ctx, 'Could not read the earlier suggestions, so every category is assessed again', err)
  })
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

async function assessCategories(ctx: RunCtx, categories: Category[], batch: BatchContext, meter: TokenMeter): Promise<Progress> {
  const progress: Progress = { done: 0, unassessed: [], stop: null, created: [] }
  for (const category of categories) {
    let complete = true
    for (const items of category.batches) {
      progress.stop ??= stopBefore(ctx, meter.used())
      if (progress.stop) {
        complete = false
        break
      }
      try {
        const outcome = await assessAndStore(ctx, items, batch, meter)
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
    await updateRun(ctx, { categoriesDone: progress.done, tokensUsed: meter.used() })
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

/** Failed pages that count towards the "inaccessible" flag; see relevantFailedPages. */
async function failedPagesOf(ctx: RunCtx, pages: CapturedPage[]): Promise<BatchContext['failedPages']> {
  let startUrls: string[] | null = null
  try {
    startUrls = (await ctx.deps.repo.getSource(ctx.run.projectId))?.startUrls ?? null
  } catch (err) {
    logRunProblem(ctx, 'Could not read the start links, so every failed page counts', err)
  }
  return relevantFailedPages(pages, startUrls)
}

function createMeter(): TokenMeter {
  let used = 0
  return {
    used: () => used,
    add(tokens) {
      used += tokens
    },
  }
}

async function execute(ctx: RunCtx): Promise<void> {
  const isCapture = ctx.run.capturedInRunId === ctx.run.id
  await updateRun(ctx, {
    status: isCapture ? 'capturing' : 'assessing',
    startedAt: new Date().toISOString(),
    model: ctx.deps.model,
  })

  let pages: CapturedPage[]
  let readableReported = 0
  if (isCapture) {
    const captured = await capturePhase(ctx)
    pages = captured.pages
    readableReported = captured.readableReported
  } else {
    pages = await ctx.deps.repo.listPages(ctx.run.capturedInRunId)
  }
  if (!pages.some((p) => p.accessStatus === 'ok')) {
    if (readableReported > 0) throw new RunFailure(PAGES_NOT_SAVED)
    throw new RunFailure(ctx.signal.aborted ? OUT_OF_TIME_NO_PAGE : NO_PAGE_READ)
  }
  await updateRun(ctx, { status: 'assessing', pagesTotal: pages.length, pagesDone: pages.length })

  const { items, platform } = await loadChecklist(ctx)
  const categories = await categoriesToAssess(ctx, items)
  await updateRun(ctx, { categoriesTotal: categories.length })

  const batch: BatchContext = {
    platform,
    pages: new Map(pages.map((p) => [p.id, p])),
    failedPages: await failedPagesOf(ctx, pages),
  }
  const meter = createMeter()
  const progress = await assessCategories(ctx, categories, batch, meter)

  const notKept = isCapture ? [] : await carryForward(ctx, items, new Set(progress.created.map((s) => s.itemId)))
  const unassessed = [...progress.unassessed, ...notKept.filter((key) => !progress.unassessed.includes(key))]
  await autoMatchAnswers(ctx, progress.created)

  await updateRunReliably(ctx, {
    status: unassessed.length === 0 ? 'completed' : 'partial',
    unassessedCategories: unassessed,
    categoriesDone: progress.done,
    tokensUsed: meter.used(),
    error: unassessed.length === 0 ? null : partialSummary(progress.stop, unassessed.length, notKept.length),
    finishedAt: new Date().toISOString(),
  })
}

async function fail(ctx: RunHandle, message: string): Promise<void> {
  await updateRunReliably(ctx, { status: 'failed', error: message, finishedAt: new Date().toISOString() })
}

async function endAfterCrash(ctx: RunCtx, err: unknown): Promise<void> {
  if (err instanceof RunGoneError) return
  if (err instanceof RunFailure) return fail(ctx, err.message)
  console.error(`[evidence] Run ${ctx.run.id} failed unexpectedly:`, safeMessage(err, ctx.deps.apiKey))
  return fail(ctx, GENERIC_FAILURE)
}

async function startContext(run: EvidenceRun, deps: ResolvedDeps, signal: AbortSignal): Promise<RunCtx> {
  // Without a permission on record, robots.txt applies.
  let granted = false
  try {
    granted = (await deps.repo.getPermission(run.projectId))?.granted === true
  } catch (err) {
    logRunProblem({ run, deps }, 'Could not read the permission, so robots.txt is respected', err)
  }
  let started: Promise<Browser> | null = null
  return {
    run,
    deps,
    signal,
    robots: granted ? null : createRobotsChecker(deps.guard),
    browser: () => (started ??= deps.browserProvider()),
  }
}

/** Reads the run, or ends it as failed when it cannot be read. Returns null when there is nothing to run. */
async function readRun(runId: string, deps: ResolvedDeps): Promise<EvidenceRun | null> {
  try {
    return await readRunReliably(deps, runId)
  } catch (err) {
    const handle: RunHandle = { run: { id: runId }, deps }
    logRunProblem(handle, 'Could not read the run', err)
    await fail(handle, COULD_NOT_START)
    return null
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
    const run = await readRun(runId, resolved)
    if (!run) return
    // A run failed as lost, or already taken by a job, stays as it is.
    if (run.status !== 'queued') return
    ctx = await startContext(run, resolved, controller.signal)
    await execute(ctx)
  } catch (err) {
    try {
      if (ctx) await endAfterCrash(ctx, err)
      else if (!(err instanceof RunGoneError)) console.error(`[evidence] Run ${runId} could not start:`, safeMessage(err, deps.apiKey))
    } catch (secondary) {
      if (!(secondary instanceof RunGoneError)) {
        console.error(`[evidence] Run ${runId} could not be ended:`, safeMessage(secondary, deps.apiKey))
      }
    }
  } finally {
    clearTimeout(timer)
  }
}
