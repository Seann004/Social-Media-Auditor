/** What a re-assess of an app run has to judge, shared by starting it and running it. */
import type { AppRepository } from './appRepository.js'
import type { EvidenceRepository } from './repository.js'

/**
 * What a re-assess of the unfinished judges: the checked items that have recorded steps and no
 * suggestion from the app in the latest result run of the capture (a pages suggestion carried in for
 * an item the check could not finish does not count). With no such run, every checked item with steps.
 */
export async function unfinishedAppItems(
  repo: EvidenceRepository,
  appRepo: AppRepository,
  capture: { projectId: string; capturedInRunId: string },
  checkedItemIds: string[],
): Promise<string[]> {
  const withSteps = new Set((await appRepo.listSteps(capture.capturedInRunId)).map((s) => s.itemId))
  const prior = await repo.latestResultRun(capture.projectId)
  const judged =
    prior && prior.capturedInRunId === capture.capturedInRunId
      ? new Set((await repo.listSuggestions(prior.id)).filter((s) => s.source === 'app').map((s) => s.itemId))
      : new Set<string>()
  return checkedItemIds.filter((id) => withSteps.has(id) && !judged.has(id))
}
