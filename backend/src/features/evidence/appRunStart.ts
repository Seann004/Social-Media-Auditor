/** Starting an app run: the AI checks the picked checklist items inside the platform's web app. */
import type { AppRepository } from './appRepository.js'
import { APP_MAX_ITEMS_PER_RUN, APP_PROMPT_VERSION } from './config.js'
import { createAndQueue, type Prepared, type RunStartDeps, type StartOutcome } from './runStart.js'

const refusal = (error: string): Prepared => ({ refusal: { ok: false, status: 400, error } })

/**
 * Checks what an app run needs, then creates and queues it under the project's lock, with the same
 * locked-audit, active-run and daily-cap refusals as a pages run. The picked items are stored in
 * checklist order.
 */
export function startAppRun(
  deps: RunStartDeps & { appRepo: AppRepository },
  projectId: string,
  userId: string,
  itemIds: string[],
): Promise<StartOutcome> {
  return createAndQueue(deps, { projectId, userId, scope: 'all' }, async () => {
    if ((await deps.appRepo.getAppSource(projectId)) === null) return refusal('Save the app address before starting an app run.')
    if ((await deps.appRepo.listTestAccounts(projectId)).length === 0) {
      return refusal('Add at least one test account before starting an app run.')
    }
    const picked = new Set(itemIds)
    if (picked.size === 0) return refusal('Pick at least one checklist item to check in the app.')
    if (picked.size > APP_MAX_ITEMS_PER_RUN) return refusal(`Pick at most ${APP_MAX_ITEMS_PER_RUN} items for one app run.`)
    const checklist = await deps.audit.listChecklistItems(projectId)
    const known = new Set(checklist.map((i) => i.id))
    if ([...picked].some((id) => !known.has(id))) return refusal('One of the picked items is not on this checklist.')
    return {
      source: 'app',
      checkedItemIds: checklist.filter((i) => picked.has(i.id)).map((i) => i.id),
      promptVersion: APP_PROMPT_VERSION,
    }
  })
}
