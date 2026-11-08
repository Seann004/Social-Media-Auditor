/**
 * What app runs and repo runs share: they judge picked checklist items one at a time, stop on the
 * run's time, its token budget or Groq's limit, and end with the items left not checked.
 */
import type { AssessItem } from './assess.js'
import type { TokenMeter } from './runnerAssess.js'
import { autoMatchAnswers, carryForward, type StopReason } from './runnerFinish.js'
import {
  categoryKey,
  isGroqLimit,
  isRunGone,
  logRunProblem,
  RunAbortedError,
  RunGoneError,
  updateRunReliably,
  type RunCtx,
} from './runnerShared.js'
import type { Suggestion } from './types.js'

export interface Progress {
  done: number
  stop: StopReason | null
  created: Suggestion[]
}

export interface ItemResult {
  created: Suggestion | null
  stop: StopReason | null
}

const plural = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'}`

/** The sentence for the summary of a partial app or repo run. */
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

/** The checklist items the run picked, in checklist order. */
export const pickedItems = (items: AssessItem[], ids: string[]): AssessItem[] => items.filter((i) => ids.includes(i.id))

/** What a failed AI call means: a limit or the run's time stops the run; anything else costs only its item. */
export async function stopForJudgeFailure(ctx: RunCtx, err: unknown, what = 'An item could not be judged'): Promise<StopReason | null> {
  if (err instanceof RunGoneError) throw err
  if (err instanceof RunAbortedError || ctx.signal.aborted) return 'timeout'
  if (isGroqLimit(err)) return 'limit'
  if (await isRunGone(ctx)) throw new RunGoneError()
  logRunProblem(ctx, what, err)
  return null
}

/** Judges one item unless the run's time or token budget (`maxTokens`) is spent first. */
export async function judgeOrStop(
  ctx: RunCtx,
  budget: { meter: TokenMeter; maxTokens: number },
  judge: () => Promise<Suggestion | null>,
): Promise<ItemResult> {
  if (ctx.signal.aborted) return { created: null, stop: 'timeout' }
  if (budget.meter.used() >= budget.maxTokens) return { created: null, stop: 'tokens' }
  try {
    return { created: await judge(), stop: null }
  } catch (err) {
    return { created: null, stop: await stopForJudgeFailure(ctx, err) }
  }
}

export const withResult = (progress: Progress, result: ItemResult): Progress => ({
  done: progress.done + 1,
  stop: result.stop,
  created: result.created === null ? progress.created : [...progress.created, result.created],
})

/** Copies the other suggestions forward, lists what has none of its own, and ends the run completed or partial. */
export async function endItemRun(
  ctx: RunCtx,
  items: AssessItem[],
  progress: Progress,
  notChecked: string[],
  meter: TokenMeter,
  anyCapture: boolean,
): Promise<void> {
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
