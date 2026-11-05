import { planBatches, type AssessItem } from './assess.js'
import type { EvidenceRepository } from './repository.js'
import { categoryKey } from './runnerShared.js'

export interface Category {
  key: string
  batches: AssessItem[][]
}

/** Categories in checklist order, each with its batches. planBatches keeps a category's batches together. */
export function planCategories(items: AssessItem[]): Category[] {
  const categories: Category[] = []
  for (const batch of planBatches(items)) {
    const key = categoryKey(batch[0])
    const last = categories[categories.length - 1]
    if (last && last.key === key) last.batches.push(batch)
    else categories.push({ key, batches: [batch] })
  }
  return categories
}

/**
 * What a re-assess of the unfinished has to do: the categories the latest result run of this capture
 * listed as not assessed, plus any category with an item that run has no suggestion for (a category
 * that was switched off meanwhile, or an item added since). With no such run, every category.
 * When the earlier suggestions cannot be read, `onUnreadable` decides: returning means every category.
 */
export async function unfinishedCategories(
  repo: EvidenceRepository,
  capture: { projectId: string; capturedInRunId: string },
  items: AssessItem[],
  onUnreadable: (err: unknown) => Promise<void>,
): Promise<Category[]> {
  const all = planCategories(items)
  const prior = await repo.latestResultRun(capture.projectId)
  if (!prior || prior.capturedInRunId !== capture.capturedInRunId) return all
  let shown: Set<string>
  try {
    shown = new Set((await repo.listSuggestions(prior.id)).map((s) => s.itemId))
  } catch (err) {
    await onUnreadable(err)
    return all
  }
  const wanted = new Set(prior.unassessedCategories)
  for (const item of items) if (!shown.has(item.id)) wanted.add(categoryKey(item))
  return all.filter((c) => wanted.has(c.key))
}
