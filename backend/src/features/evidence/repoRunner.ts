/**
 * A repo evidence run: the code of a public GitHub repository is downloaded into memory, one small
 * AI call gives search words, and each checklist item the auditor picked is judged from the pieces
 * of code the search finds. A re-assess judges the stored pieces again without a download. Like
 * every run, it never changes an answer or the score.
 */
import { appPartialSummary, itemIdsOfLostCategories } from './appRunner.js'
import type { AssessItem } from './assess.js'
import { MAX_TOKENS_PER_RUN } from './config.js'
import { readArchive } from './repoArchive.js'
import { RepoFetchError } from './repoFetch.js'
import { judgeRepoItem, rejudgeRepoItem } from './repoJudge.js'
import { repoJudgedItems } from './repoRunPlan.js'
import { askSearchTerms, fallbackTerms } from './repoTerms.js'
import type { RepoFile, RepoPiece, RepoSnapshot, RepoSource, SearchTerms } from './repoTypes.js'
import type { TokenMeter } from './runnerAssess.js'
import { autoMatchAnswers, carryForward, type StopReason } from './runnerFinish.js'
import {
  abortable,
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
  type ResolvedCodeDeps,
  type RunCtx,
} from './runnerShared.js'
import type { Suggestion } from './types.js'

const NOT_CONFIGURED = "Reading code repositories isn't configured on this server."
const SOURCE_REMOVED = 'The repository address was removed before the run started.'
const SNAPSHOT_GONE = 'The code this run was made from is no longer stored. Start a new code run.'

interface Progress {
  done: number
  stop: StopReason | null
  created: Suggestion[]
}

const pickedItems = (items: AssessItem[], ids: string[]): AssessItem[] => items.filter((i) => ids.includes(i.id))

function configuredCode(ctx: RunCtx): ResolvedCodeDeps {
  if (ctx.deps.code === null) throw new RunFailure(NOT_CONFIGURED)
  return ctx.deps.code
}

/** What a failed AI call means: a limit or the run's time stops the run; anything else costs only its item. */
async function stopForFailure(ctx: RunCtx, err: unknown, what: string): Promise<StopReason | null> {
  if (err instanceof RunGoneError) throw err
  if (err instanceof RunAbortedError || ctx.signal.aborted) return 'timeout'
  if (isGroqLimit(err)) return 'limit'
  if (await isRunGone(ctx)) throw new RunGoneError()
  logRunProblem(ctx, what, err)
  return null
}

/** Judges each item in order until the run's time, its token budget or Groq's limit stops it. */
async function judgeItems(
  ctx: RunCtx,
  items: AssessItem[],
  meter: TokenMeter,
  start: StopReason | null,
  judgeOne: (item: AssessItem) => Promise<Suggestion | null>,
): Promise<Progress> {
  let progress: Progress = { done: 0, stop: start, created: [] }
  for (const item of items) {
    if (progress.stop !== null) break
    await updateRun(ctx, { currentItemId: item.id })
    let created: Suggestion | null = null
    let stop: StopReason | null = null
    if (ctx.signal.aborted) stop = 'timeout'
    else if (meter.used() >= MAX_TOKENS_PER_RUN) stop = 'tokens'
    else {
      try {
        created = await judgeOne(item)
      } catch (err) {
        stop = await stopForFailure(ctx, err, 'An item could not be judged from the code')
      }
    }
    progress = { done: progress.done + 1, stop, created: created === null ? progress.created : [...progress.created, created] }
    await updateRun(ctx, { categoriesDone: progress.done, tokensUsed: meter.used() })
  }
  return progress
}

/** Copies the other suggestions forward, lists what has none of its own, and ends the run completed or partial. */
async function endRepoRun(ctx: RunCtx, items: AssessItem[], progress: Progress, notChecked: string[], meter: TokenMeter, anyCapture: boolean): Promise<void> {
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

/** Resolves the commit, downloads it into memory and reads it. A GitHub or archive problem ends the run with its sentence. */
async function readRepository(ctx: RunCtx, code: ResolvedCodeDeps, source: RepoSource): Promise<{ files: RepoFile[]; snapshot: RepoSnapshot }> {
  const fetcher = code.fetcher(ctx.deps.guard, ctx.signal)
  let commitSha: string
  let archive: ReturnType<typeof readArchive>
  try {
    commitSha = await fetcher.resolveCommit(source.owner, source.name, source.branch)
    archive = readArchive(await fetcher.downloadArchive(source.owner, source.name, commitSha))
  } catch (err) {
    if (err instanceof RepoFetchError) throw new RunFailure(err.message)
    throw err
  }
  const snapshot = await code.repoRepo.saveSnapshot({
    runId: ctx.run.id,
    repoUrl: source.repoUrl,
    owner: source.owner,
    name: source.name,
    branch: source.branch,
    commitSha,
    filesRead: archive.files.length,
    filesSkipped: archive.skipped,
    truncated: archive.truncated,
  })
  return { files: archive.files, snapshot }
}

/**
 * One search-words call for every item. A limit or the run's time stops the run before any item;
 * any other failure leaves each item to be searched with its own words, which is a search, not an answer.
 */
async function searchTermsOf(
  ctx: RunCtx,
  items: AssessItem[],
  platform: string,
  files: RepoFile[],
  meter: TokenMeter,
): Promise<{ terms: Map<string, SearchTerms>; stop: StopReason | null }> {
  const { apiKey, model } = ctx.deps
  try {
    const out = await abortable(askSearchTerms({ items, platform, paths: files.map((f) => f.path), apiKey, model, signal: ctx.signal }), ctx.signal)
    meter.add(out.tokensUsed)
    return { terms: out.terms, stop: null }
  } catch (err) {
    const stop = await stopForFailure(ctx, err, 'Could not get search words, so each item is searched with its own words')
    return { terms: new Map(), stop }
  }
}

async function captureAndJudge(ctx: RunCtx): Promise<void> {
  const code = configuredCode(ctx)
  const source = await code.repoRepo.getRepoSource(ctx.run.projectId)
  if (source === null) throw new RunFailure(SOURCE_REMOVED)
  const { items, platform } = await loadChecklist(ctx)
  const checked = pickedItems(items, ctx.run.checkedItemIds)
  const { files, snapshot } = await readRepository(ctx, code, source)
  await updateRun(ctx, { status: 'assessing', categoriesTotal: checked.length })

  const meter = createMeter()
  const search = await searchTermsOf(ctx, checked, platform, files, meter)
  const progress = await judgeItems(ctx, checked, meter, search.stop, (item) =>
    judgeRepoItem(ctx, { item, platform, files, snapshot, terms: search.terms.get(item.id) ?? fallbackTerms(item), repoRepo: code.repoRepo, meter }),
  )
  const own = new Set(progress.created.map((s) => s.itemId))
  await endRepoRun(ctx, items, progress, checked.filter((i) => !own.has(i.id)).map((i) => i.id), meter, true)
}

/** The items whose suggestion from the code stands in the latest results; when unreadable, none, so nothing is taken as checked. */
async function judgedOf(ctx: RunCtx): Promise<Set<string>> {
  try {
    return await repoJudgedItems(ctx.deps.repo, { projectId: ctx.run.projectId, capturedInRunId: ctx.run.capturedInRunId })
  } catch (err) {
    if (await isRunGone(ctx)) throw new RunGoneError()
    logRunProblem(ctx, 'Could not read the earlier suggestions, so every checked item with code is judged again', err)
    return new Set()
  }
}

async function reassess(ctx: RunCtx): Promise<void> {
  const code = configuredCode(ctx)
  const { items, platform } = await loadChecklist(ctx)
  const checked = pickedItems(items, ctx.run.checkedItemIds)
  if ((await code.repoRepo.getSnapshot(ctx.run.capturedInRunId)) === null) throw new RunFailure(SNAPSHOT_GONE)
  const pieces = await code.repoRepo.listPieces(ctx.run.capturedInRunId)
  const withPieces = new Set(pieces.map((p) => p.itemId))
  const judged = await judgedOf(ctx)
  const unfinishedOnly = ctx.run.scope === 'unfinished'
  const targets = checked.filter((i) => withPieces.has(i.id) && !(unfinishedOnly && judged.has(i.id)))
  await updateRun(ctx, { categoriesTotal: targets.length })

  const meter = createMeter()
  const piecesOf = (itemId: string): RepoPiece[] => pieces.filter((p) => p.itemId === itemId)
  const progress = await judgeItems(ctx, targets, meter, null, (item) => rejudgeRepoItem(ctx, { item, platform, pieces: piecesOf(item.id), meter }))
  const own = new Set(progress.created.map((s) => s.itemId))
  const targetIds = new Set(targets.map((i) => i.id))
  // An item not judged again keeps its carried suggestion, unless the capture never searched it.
  const notChecked = checked
    .filter((i) => !own.has(i.id) && (targetIds.has(i.id) || (!withPieces.has(i.id) && !judged.has(i.id))))
    .map((i) => i.id)
  await endRepoRun(ctx, items, progress, notChecked, meter, false)
}

/**
 * Runs a repo run: a capture run downloads the repository and judges each picked item from its
 * code, a re-assess judges the pieces an earlier repo run stored. Robots.txt and the recorded
 * permission do not apply. Whatever goes wrong is thrown on to runEvidenceJob, which ends the run.
 */
export async function executeRepoRun(ctx: RunCtx): Promise<void> {
  const isCapture = ctx.run.capturedInRunId === ctx.run.id
  await updateRun(ctx, { status: isCapture ? 'capturing' : 'assessing', startedAt: new Date().toISOString(), model: ctx.deps.model })
  if (isCapture) await captureAndJudge(ctx)
  else await reassess(ctx)
}
