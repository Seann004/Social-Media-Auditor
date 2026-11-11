/** What a re-assess of a repo run has to judge, shared by starting it and running it. */
import type { RepoRepository } from './repoRepository.js'
import type { EvidenceRepository } from './repository.js'

export interface RepoCapture {
  projectId: string
  capturedInRunId: string
}

/**
 * The items with a suggestion from the code in the latest result run of the capture (a pages
 * suggestion carried in does not count). Empty when that run is of another capture.
 */
export async function repoJudgedItems(repo: EvidenceRepository, capture: RepoCapture): Promise<Set<string>> {
  const prior = await repo.latestResultRun(capture.projectId)
  if (!prior || prior.capturedInRunId !== capture.capturedInRunId) return new Set()
  return new Set((await repo.listSuggestions(prior.id)).filter((s) => s.source === 'repo').map((s) => s.itemId))
}

/**
 * What a re-assess of the unfinished judges: the checked items that have stored pieces and no
 * suggestion from the code. An item without pieces was never searched, or its search found
 * nothing and it has its no-code suggestion, so there is nothing to judge again.
 */
export async function unfinishedRepoItems(
  repo: EvidenceRepository,
  repoRepo: RepoRepository,
  capture: RepoCapture,
  checkedItemIds: string[],
): Promise<string[]> {
  const withPieces = new Set((await repoRepo.listPieces(capture.capturedInRunId)).map((p) => p.itemId))
  const judged = await repoJudgedItems(repo, capture)
  return checkedItemIds.filter((id) => withPieces.has(id) && !judged.has(id))
}
