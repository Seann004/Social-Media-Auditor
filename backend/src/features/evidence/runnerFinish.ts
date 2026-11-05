import type { AssessItem } from './assess.js'
import { LOCKED_SUBMISSION_STATUSES } from './config.js'
import { categoryKey, endIfRunGone, logRunProblem, type RunCtx } from './runnerShared.js'
import { toAnswerStatus, type Suggestion } from './types.js'


export type StopReason = 'limit' | 'tokens' | 'timeout'

const plural = (n: number): string => `${n} ${n === 1 ? 'category' : 'categories'}`

/** The sentence for the summary of a partial run. No stack traces, no keys. */
export function partialSummary(stop: StopReason | null, unassessed: number, notKept = 0): string {
  if (stop === 'limit') return `AI daily limit reached; ${plural(unassessed)} not assessed`
  if (stop === 'tokens') return `The AI budget for one run was used up; ${plural(unassessed)} not assessed`
  if (stop === 'timeout') return `The run ran out of time; ${plural(unassessed)} not assessed`
  if (notKept > 0 && notKept === unassessed) {
    return `The suggestions of ${plural(notKept)} from the earlier run could not be kept; use Re-assess to bring them back`
  }
  return `${plural(unassessed)} could not be assessed`
}

/**
 * Copies the suggestions an earlier run of the same capture made for items this run has none for,
 * so that what the screen showed before is still shown after a re-assess. Rows are copied as they
 * are, screenshot paths and the list of passages sent included: nothing is uploaded again. Each copy
 * names the suggestion first assessed, so that a decision made on any copy still counts for it. Items
 * no longer on the checklist are left out. The copies are not counted as assessed by this run.
 *
 * Returns the keys of the categories that lost a suggestion because a copy failed, so that the run
 * can list them as not assessed and Re-assess can bring them back.
 */
export async function carryForward(ctx: RunCtx, items: AssessItem[], ownItemIds: ReadonlySet<string>): Promise<string[]> {
  const { repo } = ctx.deps
  const lost = new Set<string>()
  const keyOf = new Map(items.map((i) => [i.id, categoryKey(i)]))
  let earlier: Suggestion[]
  try {
    const prior = await repo.latestResultRun(ctx.run.projectId)
    if (!prior || prior.id === ctx.run.id || prior.capturedInRunId !== ctx.run.capturedInRunId) return []
    earlier = await repo.listSuggestions(prior.id)
  } catch (err) {
    await endIfRunGone(ctx)
    logRunProblem(ctx, 'Could not look up the earlier suggestions', err)
    // Anything this run did not assess itself may have been shown before.
    return [...new Set(items.filter((i) => !ownItemIds.has(i.id)).map(categoryKey))]
  }
  for (const old of earlier) {
    if (!keyOf.has(old.itemId) || ownItemIds.has(old.itemId)) continue
    try {
      await repo.addSuggestion({
        runId: ctx.run.id,
        projectId: ctx.run.projectId,
        itemId: old.itemId,
        suggestedResult: old.suggestedResult,
        reason: old.reason,
        confidence: old.confidence,
        flags: old.flags,
        passageIdsSent: old.passageIdsSent,
        originSuggestionId: old.originSuggestionId ?? old.id,
        quotes: old.quotes.map(({ id: _id, ...quote }) => quote),
      })
    } catch (err) {
      await endIfRunGone(ctx)
      logRunProblem(ctx, `Could not carry forward the suggestion for item ${old.itemId}`, err)
      lost.add(keyOf.get(old.itemId) as string)
    }
  }
  return [...lost]
}

/**
 * Where an auditor already answered an item the same way the AI now suggests, records the
 * suggestion as accepted (spec 9.4). Only for suggestions this run made, with a result, for items
 * with no decision yet, and where every answer row for the item agrees. Never changes an answer.
 */
export async function autoMatchAnswers(ctx: RunCtx, created: Suggestion[]): Promise<void> {
  const withResult = created.filter((s) => s.suggestedResult !== null)
  if (withResult.length === 0) return
  const { repo, audit } = ctx.deps
  let answers
  let decided
  try {
    // Decisions on a locked audit are refused (Task 11), and an "accepted" on one would mislead the review.
    const submission = await audit.getSubmissionStatus(ctx.run.projectId)
    if (submission === null || LOCKED_SUBMISSION_STATUSES.includes(submission)) return
    answers = await audit.listAnswers(ctx.run.projectId)
    decided = new Set((await repo.listDecisions(ctx.run.projectId)).map((d) => d.itemId))
  } catch (err) {
    await endIfRunGone(ctx)
    logRunProblem(ctx, 'Could not check the submission status and existing answers', err)
    return
  }
  for (const suggestion of withResult) {
    if (suggestion.suggestedResult === null || decided.has(suggestion.itemId)) continue
    const rows = answers.filter((a) => a.itemId === suggestion.itemId)
    const status = toAnswerStatus(suggestion.suggestedResult)
    if (rows.length === 0 || !rows.every((r) => r.result === status)) continue
    try {
      await repo.addDecision({
        suggestionId: suggestion.id,
        projectId: ctx.run.projectId,
        itemId: suggestion.itemId,
        userId: null,
        decision: 'accepted',
        finalResult: status,
        overrideReason: null,
        origin: 'auto_match',
      })
    } catch (err) {
      await endIfRunGone(ctx)
      logRunProblem(ctx, `Could not record the matching answer for item ${suggestion.itemId}`, err)
    }
  }
}
