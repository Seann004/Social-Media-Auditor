/** Starting a repo run: the AI checks the picked checklist items against the code of a public GitHub repository. */
import { REPO_MAX_ITEMS_PER_RUN, REPO_PROMPT_VERSION } from './config.js'
import type { RepoRepository } from './repoRepository.js'
import { createAndQueue, type Prepared, type RunStartDeps, type StartOutcome } from './runStart.js'

const refusal = (error: string): Prepared => ({ refusal: { ok: false, status: 400, error } })

/**
 * Checks what a repo run needs, then creates and queues it under the project's lock, with the same
 * locked-audit, active-run and daily-cap refusals as a pages run. The picked items are stored in
 * checklist order. No permission is needed and robots.txt does not apply.
 */
export function startRepoRun(
  deps: RunStartDeps & { repoRepo: RepoRepository },
  projectId: string,
  userId: string,
  itemIds: string[],
): Promise<StartOutcome> {
  return createAndQueue(deps, { projectId, userId, scope: 'all' }, async () => {
    if ((await deps.repoRepo.getRepoSource(projectId)) === null) return refusal('Save the repository address before starting a code run.')
    const picked = new Set(itemIds)
    if (picked.size === 0) return refusal('Pick at least one checklist item to check in the code.')
    if (picked.size > REPO_MAX_ITEMS_PER_RUN) return refusal(`Pick at most ${REPO_MAX_ITEMS_PER_RUN} items for one code run.`)
    const checklist = await deps.audit.listChecklistItems(projectId)
    const known = new Set(checklist.map((i) => i.id))
    if ([...picked].some((id) => !known.has(id))) return refusal('One of the picked items is not on this checklist.')
    return {
      source: 'repo',
      checkedItemIds: checklist.filter((i) => picked.has(i.id)).map((i) => i.id),
      promptVersion: REPO_PROMPT_VERSION,
    }
  })
}
