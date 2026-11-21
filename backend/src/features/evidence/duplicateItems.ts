import type { AssessItem } from './assess.js'
import type { Category } from './runPlan.js'
import { endIfRunGone, logRunProblem, type RunCtx } from './runnerShared.js'
import type { Suggestion } from './types.js'

export interface DuplicatePlan {
  /** For the first item of each group: the other items of the group on this checklist, in checklist order. */
  twinsOf: ReadonlyMap<string, AssessItem[]>
  twinIds: ReadonlySet<string>
}

/**
 * Items an admin linked as "the same requirement" need only one AI answer. `groups` are lists of
 * item ids of this project. The first item on the checklist of each group is the one assessed;
 * the others are its twins and get a copy of its suggestion.
 */
export function planDuplicates(items: readonly AssessItem[], groups: readonly (readonly string[])[]): DuplicatePlan {
  const byId = new Map(items.map((i) => [i.id, i]))
  const order = new Map(items.map((i, at) => [i.id, at]))
  const twinsOf = new Map<string, AssessItem[]>()
  const twinIds = new Set<string>()
  for (const group of groups) {
    const present = [...new Set(group)]
      .filter((id) => byId.has(id) && !twinIds.has(id) && !twinsOf.has(id))
      .sort((a, b) => (order.get(a) as number) - (order.get(b) as number))
    if (present.length < 2) continue
    const [first, ...rest] = present
    twinsOf.set(first, rest.map((id) => byId.get(id) as AssessItem))
    rest.forEach((id) => twinIds.add(id))
  }
  return { twinsOf, twinIds }
}

/** The categories without the twins; a batch or category left empty is dropped. */
export function dropTwins(categories: readonly Category[], twinIds: ReadonlySet<string>): Category[] {
  return categories
    .map((c) => ({ key: c.key, batches: c.batches.map((b) => b.filter((i) => !twinIds.has(i.id))).filter((b) => b.length > 0) }))
    .filter((c) => c.batches.length > 0)
}

/** Groups of this project's items that are the same requirement. A failure is logged and means no sharing. */
export async function readDuplicateGroups(ctx: RunCtx): Promise<string[][]> {
  const read = ctx.deps.audit.listDuplicateGroups
  if (!read) return []
  try {
    return await read.call(ctx.deps.audit, ctx.run.projectId)
  } catch (err) {
    await endIfRunGone(ctx)
    logRunProblem(ctx, 'Could not read which items are the same requirement, so every item is assessed', err)
    return []
  }
}

export interface TwinCopies {
  created: Suggestion[]
  /** The twins that got no copy, because the first item has no suggestion or the copy failed. */
  missing: AssessItem[]
}

/** Gives each twin a copy of its first item's suggestion, in words that say where the answer came from. */
export async function copyToTwins(ctx: RunCtx, plan: DuplicatePlan, made: readonly Suggestion[]): Promise<TwinCopies> {
  const bySource = new Map(made.map((s) => [s.itemId, s]))
  const created: Suggestion[] = []
  const missing: AssessItem[] = []
  for (const [firstId, twins] of plan.twinsOf) {
    const source = bySource.get(firstId)
    for (const twin of twins) {
      if (!source) {
        missing.push(twin)
        continue
      }
      try {
        created.push(await ctx.deps.repo.addSuggestion({
          runId: ctx.run.id,
          projectId: ctx.run.projectId,
          itemId: twin.id,
          suggestedResult: source.suggestedResult,
          reason: `Same requirement as another item on this checklist, so assessed once. ${source.reason}`,
          confidence: source.confidence,
          flags: source.flags,
          passageIdsSent: source.passageIdsSent,
          source: source.source,
          quotes: source.quotes.map(({ id: _id, ...quote }) => quote),
        }))
      } catch (err) {
        await endIfRunGone(ctx)
        logRunProblem(ctx, `Could not copy the suggestion to item ${twin.id}`, err)
        missing.push(twin)
      }
    }
  }
  return { created, missing }
}
