/**
 * Puts back the settings a check changed, newest first, without asking the AI. Every result is
 * written to the change's row, and nothing here throws.
 */
import type { AppRepository } from './appRepository.js'
import { checkAction, type SafetyContext } from './appSafety.js'
import type { AppSession, AppSessionPool } from './appSession.js'
import { controlState, locateControl, pathOf, restoreAddress } from './appSteps.js'
import type { AppAction, AppChange, AppElement, AppView } from './appTypes.js'

export const RESTORE_DETAILS = {
  putBack: 'Put back.',
  alreadyAsBefore: 'Already as before.',
  didNotStay: 'It was switched back but did not stay that way after reload.',
  outOfTime: 'The run ran out of time before this could be put back.',
  unsafe: 'Putting this back would break a safety rule.',
} as const

const notFound = (change: AppChange): string => `The control "${change.control}" was not found on ${pathOf(change.pageUrl)}.`
const unavailable = (change: AppChange): string => `The session of ${change.accountLabel} was not available.`

interface Result {
  restored: boolean
  detail: string
}

async function readShown(session: AppSession): Promise<AppView> {
  const read = await session.read()
  return { ...read, url: session.currentUrl() }
}

/** Opens the change's page afresh and finds its control there. */
async function openControl(session: AppSession, change: AppChange): Promise<{ view: AppView; el: AppElement | null }> {
  // The navigation's own address is raw: only the session's shown address leaves here.
  const navigation = await session.gotoInApp(restoreAddress(change.pageUrl))
  const view = await readShown(session)
  if (navigation.blockedReason !== null || pathOf(view.url) !== pathOf(change.pageUrl)) return { view, el: null }
  return { view, el: locateControl(view, change.role, change.control) }
}

/** An option of a custom dropdown or menu is clicked again (ruling A27); its dropdown is not opened first. */
const CLICKED_BACK_ROLES = ['option', 'menuitemradio', 'menuitemcheckbox']

function undoAction(change: AppChange, el: AppElement): Extract<AppAction, { type: 'select' | 'toggle' | 'click' }> {
  if (CLICKED_BACK_ROLES.includes(change.role)) return { type: 'click', ref: el.ref }
  return change.role === 'combobox' || el.tag === 'select'
    ? { type: 'select', ref: el.ref, option: change.before }
    : { type: 'toggle', ref: el.ref }
}

/** Clicks the change's Save control, when it has one and it may be clicked. */
async function save(session: AppSession, change: AppChange, safety: SafetyContext): Promise<boolean> {
  if (change.saveControl === null) return true
  const view = await readShown(session)
  const group = locateControl(view, change.role, change.control)?.groupId ?? null
  const buttons = view.elements.filter((el) => el.name === change.saveControl && (el.role === 'button' || el.tag === 'button'))
  // A Save in the control's own form or dialog first.
  const button = buttons.find((el) => group !== null && el.groupId === group) ?? buttons[0] ?? null
  if (button === null) return true
  const click: Extract<AppAction, { type: 'click' }> = { type: 'click', ref: button.ref }
  if (!checkAction(click, view, safety).allowed) return false
  await session.execute(click)
  return true
}

async function restoreOne(session: AppSession, change: AppChange, safety: SafetyContext): Promise<Result> {
  if (!checkAction({ type: 'open_link', url: restoreAddress(change.pageUrl) }, null, safety).allowed) {
    return { restored: false, detail: RESTORE_DETAILS.unsafe }
  }
  const first = await openControl(session, change)
  if (first.el === null) return { restored: false, detail: notFound(change) }
  if (controlState(first.el) === change.before) return { restored: true, detail: RESTORE_DETAILS.alreadyAsBefore }
  const undo = undoAction(change, first.el)
  if (!checkAction(undo, first.view, safety).allowed) return { restored: false, detail: RESTORE_DETAILS.unsafe }
  await session.execute(undo)
  if (!(await save(session, change, safety))) return { restored: false, detail: RESTORE_DETAILS.unsafe }
  const reloaded = await openControl(session, change)
  if (reloaded.el === null) return { restored: false, detail: notFound(change) }
  return controlState(reloaded.el) === change.before
    ? { restored: true, detail: RESTORE_DETAILS.putBack }
    : { restored: false, detail: RESTORE_DETAILS.didNotStay }
}

async function attempt(pool: AppSessionPool, change: AppChange, signal: AbortSignal, safety: SafetyContext): Promise<Result> {
  if (signal.aborted) return { restored: false, detail: RESTORE_DETAILS.outOfTime }
  const session = change.accountId === null ? null : pool.get(change.accountId)
  if (session === null) return { restored: false, detail: unavailable(change) }
  const currentAccount = safety.accounts.find((a) => a.id === change.accountId) ?? null
  try {
    return await restoreOne(session, change, { ...safety, currentAccount })
  } catch (err) {
    console.error(`[appRestore] run ${change.runId}: could not put back "${change.control}" for ${change.accountLabel}`, err instanceof Error ? err.name : 'error')
    return signal.aborted ? { restored: false, detail: RESTORE_DETAILS.outOfTime } : { restored: false, detail: unavailable(change) }
  }
}

/** Works through the changes newest first. Returns them in the order given, as written. */
export async function restoreChanges(
  pool: AppSessionPool,
  changes: AppChange[],
  appRepo: AppRepository,
  signal: AbortSignal,
  safety: SafetyContext,
): Promise<AppChange[]> {
  let results: ReadonlyMap<string, AppChange> = new Map()
  for (const change of [...changes].reverse()) {
    const { restored, detail } = await attempt(pool, change, signal, safety)
    let written: AppChange = { ...change, restored, restoreDetail: detail }
    try {
      written = await appRepo.updateChange(change.id, { restored, restoreDetail: detail })
    } catch (err) {
      console.error(`[appRestore] run ${change.runId}: could not record the result for "${change.control}"`, err instanceof Error ? err.message : err)
    }
    results = new Map(results).set(change.id, written)
  }
  return changes.map((change) => results.get(change.id) ?? change)
}
