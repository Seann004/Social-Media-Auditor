/** The words of an app check's steps, and how each step is stored as evidence. */
import { randomUUID } from 'node:crypto'
import { outlineLines } from './appRead.js'
import { REPEATED_ACTION } from './appRepeat.js'
import type { AppRepository } from './appRepository.js'
import type { AgentAccount, AppAction, AppElement, AppStep, AppStepOutcome, AppView } from './appTypes.js'
import { splitControlLines, splitIntoPassages } from './passages.js'
import type { EvidenceRepository, NewPassage, ScreenshotStore } from './repository.js'
import { redactUrl } from './secrets.js'
import { SECRET_PLACEHOLDER } from './appSecrets.js'

export interface StepContext {
  run: { id: string; projectId: string }
  itemId: string
  repo: EvidenceRepository
  screenshots: ScreenshotStore
  appRepo: AppRepository
}

export interface StepInput {
  /** 1 for a check's first step. */
  position: number
  account: AgentAccount | null
  action: AppAction
  outcome: AppStepOutcome
  /** What happened: for a done step `page <path> opened`, a change, or `page unchanged`; for a failed or blocked step, why. */
  detail: string
  refusalReason: string | null
  /** The page as it is after the step, stored as its evidence; null records the step alone. */
  view: AppView | null
  screenshot: Buffer | null
  blocked?: boolean
  /** The page the action was chosen on, to name its element. Defaults to `view`. */
  describedOn?: AppView | null
  /** Replaces the description of the action, for a step that has none of its own. */
  description?: string
}

/** Controls whose state is a setting. */
const SETTING_ROLES = ['switch', 'checkbox', 'radio', 'combobox']
const ON_OFF_ROLES = ['switch', 'checkbox', 'radio']
/** The options of a custom dropdown or menu (ruling A27): a setting when they say whether they are chosen, recorded like radios. */
const OPTION_ROLES = ['option', 'menuitemradio', 'menuitemcheckbox']
/** Roles whose changes are on/off: the above, and a toggle button with a pressed state (ruling A27). */
export const ON_OFF_CHANGE_ROLES = [...ON_OFF_ROLES, 'button', ...OPTION_ROLES]

/** The path of an address, which is all a step line shows of it. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return redactUrl(url)
  }
}

function elementOf(view: AppView | null, ref: string): AppElement | null {
  return view?.elements.find((el) => el.ref === ref) ?? null
}

function named(view: AppView | null, ref: string): string {
  const el = elementOf(view, ref)
  return el === null ? `element ${ref}` : `${el.role} "${el.name}"`
}

function nameOnly(view: AppView | null, ref: string): string {
  const el = elementOf(view, ref)
  return el === null ? ref : `"${el.name}"`
}

function openedAddress(url: string, view: AppView | null): string {
  try {
    const base = view?.url
    const target = base === undefined ? new URL(url) : new URL(url, base)
    const sameSite = base === undefined || /^\//.test(url) || new URL(base).origin === target.origin
    return sameSite ? target.pathname : redactUrl(target.href)
  } catch {
    return redactUrl(url)
  }
}

/** What the step did, in plain words. Names elements by role and name only: never by value or context text. */
export function describeAction(action: AppAction, view: AppView | null): string {
  switch (action.type) {
    case 'click':
      return `clicked ${named(view, action.ref)}`
    case 'type':
      return `typed "${action.text}" into ${named(view, action.ref)}`
    case 'fill_credential':
      return `filled the ${action.field} of ${action.account} into ${nameOnly(view, action.ref)}`
    case 'open_link':
      if (action.ref !== undefined) return `opened ${named(view, action.ref)}`
      return `opened ${openedAddress(action.url ?? '', view)}`
    case 'select':
      return `selected "${action.option}" in ${nameOnly(view, action.ref)}`
    case 'toggle':
      return `toggled ${named(view, action.ref)}`
    case 'back':
      return 'went back'
    case 'switch_account':
      return `switched to ${action.account}`
    case 'finish':
      return 'finished the check'
  }
}

/** The refusal of a first finish that comes before the check has explored (once per check). */
export const FINISHED_TOO_EARLY = 'Finished too early: look at the page where this is set, or try the action, before finishing.'
/** How the early-finish nudge is labelled: a hint to keep looking, not a safety refusal. */
export const LOOK_FURTHER = 'Asked to look further'

/** The refusal reasons that only steer the AI (the early-finish nudge, a refused repeat), not safety rules. */
const HINT_REASONS: readonly string[] = [FINISHED_TOO_EARLY, REPEATED_ACTION]

/**
 * Whether a refused step is a hint to look further, told by its refusal reason. It is stored as a
 * refusal, so it is still not evidence, but it is shown as a hint.
 */
export function isLookFurtherHint(refusalReason: string | null): boolean {
  return refusalReason !== null && HINT_REASONS.includes(refusalReason)
}

/** One step as the AI, the replay and the passages read it. */
export function stepLine(position: number, accountLabel: string | null, description: string, outcome: AppStepOutcome, detail: string): string {
  const head = accountLabel === null ? `Step ${position}` : `Step ${position} · ${accountLabel}`
  switch (outcome) {
    case 'done':
      return detail === '' ? `${head} · ${description}` : `${head} · ${description} → ${detail}`
    case 'refused':
      if (isLookFurtherHint(detail)) return `${head} · ${LOOK_FURTHER}: ${description}. ${detail}`
      return `${head} · Refused: ${description}. ${detail}`
    case 'failed':
      return `${head} · Failed: ${description}. ${detail}`
    case 'blocked':
      return `${head} · Stopped: ${detail}`
  }
}

/** The step line, then the page text, then its controls. */
export function appPassagesOf(line: string, view: AppView): NewPassage[] {
  const texts = splitIntoPassages(view.text)
  const outline = outlineLines(view)
  const controls = outline === '' ? [] : splitControlLines(outline)
  return [
    { position: 0, kind: 'text', text: line },
    ...texts.map((text, i) => ({ position: i + 1, kind: 'text' as const, text })),
    ...controls.map((text, i) => ({ position: texts.length + i + 1, kind: 'controls' as const, text })),
  ]
}

/** Whether an option says it is chosen: by aria-checked, else aria-selected. Undefined when it says neither. */
function optionOn(el: AppElement): boolean | undefined {
  return el.state.checked ?? el.state.selected
}

/** A button with a pressed state (aria-pressed): an on/off setting, like a switch (ruling A27). */
const isPressedButton = (el: AppElement): boolean => el.role === 'button' && el.state.checked !== undefined
const isOption = (el: AppElement): boolean => OPTION_ROLES.includes(el.role)
/** An option of which only one is chosen at a time. A menuitemcheckbox is not: each one is on or off by itself. */
const isExclusiveOption = (el: AppElement): boolean => isOption(el) && el.role !== 'menuitemcheckbox'
/** Whether a control is on: undefined when it has no on/off state. */
const onOf = (el: AppElement): boolean | undefined => (isOption(el) ? optionOn(el) : el.state.checked)

/** A setting's state as a change records it: on or off, or the selected value. */
export function controlState(el: AppElement): string {
  const on = onOf(el)
  if ((ON_OFF_ROLES.includes(el.role) || isPressedButton(el) || isOption(el)) && on !== undefined) return on ? 'on' : 'off'
  if (el.state.checked !== undefined && el.tag === 'input') return el.state.checked ? 'on' : 'off'
  return el.state.value ?? ''
}

/** Whether a control's state is a setting that a change records. */
export function isSettingControl(el: AppElement): boolean {
  return SETTING_ROLES.includes(el.role) || el.tag === 'select' || isPressedButton(el) || (isOption(el) && optionOn(el) !== undefined)
}

export interface DetectedChange {
  role: string
  /** The control's name, or `<name> (<n>)` when the page has more than one with that role and name (ruling A17). */
  control: string
  before: string
  after: string
  /** For a radio: the option that was chosen, while the change records the one that was on before. */
  chosen?: string
}

/** The state of a setting whose page could not be read after the action. */
export const UNKNOWN_STATE = 'unknown'
const NTH = /^(.*) \((\d+)\)$/

const sameKind = (view: AppView, role: string, name: string): AppElement[] =>
  view.elements.filter((el) => el.role === role && el.name === name)

/** How a change names a control: by name, and by its place among controls with the same role and name. */
export function controlKey(view: AppView, el: AppElement): string {
  const same = sameKind(view, el.role, el.name)
  return same.length <= 1 ? el.name : `${el.name} (${same.findIndex((other) => other.ref === el.ref) + 1})`
}

/** The control a key names on the page, or null when it is not there or cannot be told apart from another. */
export function locateControl(view: AppView, role: string, control: string): AppElement | null {
  const nth = NTH.exec(control)
  if (nth !== null) {
    const same = sameKind(view, role, nth[1])
    if (same.length >= 2) return same[Number(nth[2]) - 1] ?? null
  }
  const exact = sameKind(view, role, control)
  return exact.length === 1 ? exact[0] : null
}

/** The setting control the action works on, or null when it works on none. */
function settingTarget(action: AppAction, before: AppView): AppElement | null {
  if (action.type !== 'toggle' && action.type !== 'click' && action.type !== 'select') return null
  const el = elementOf(before, action.ref)
  return el !== null && isSettingControl(el) ? el : null
}

/** Whether the action works on a setting, so that its effect must be looked for whatever the action reported. */
export function touchesSetting(action: AppAction, before: AppView): boolean {
  return settingTarget(action, before) !== null
}

/** Options of one list or menu; outside any, of one form or dialog, as radios are. */
function together(a: AppElement, b: AppElement): boolean {
  const list = a.listId ?? null
  return list !== null ? list === (b.listId ?? null) : (b.listId ?? null) === null && a.groupId === b.groupId
}

/** The others of the clicked choice's kind, in its group, that were on before it was clicked. */
function onBefore(clicked: AppElement, before: AppView): AppElement[] {
  return before.elements.filter((r) => r.role === clicked.role && r.ref !== clicked.ref && together(r, clicked) && onOf(r) === true)
}

function unknownOf(el: AppElement, before: AppView): DetectedChange {
  // For an option, the one chosen before is the one to put back.
  const was = isExclusiveOption(el) ? onBefore(el, before)[0] : undefined
  return was === undefined
    ? { role: el.role, control: controlKey(before, el), before: controlState(el), after: UNKNOWN_STATE }
    : { role: was.role, control: controlKey(before, was), before: 'on', after: UNKNOWN_STATE }
}

/** The change to record when the page could not be read after a setting action (ruling A16): the clicked control, state unknown. */
export function unknownChange(action: AppAction, before: AppView): DetectedChange | null {
  const el = settingTarget(action, before)
  return el === null ? null : unknownOf(el, before)
}

function changeOf(el: AppElement, before: AppView, after: AppView): DetectedChange | null {
  const key = controlKey(before, el)
  const now = locateControl(after, el.role, key)
  if (now === null) return null
  const was = controlState(el)
  const is = controlState(now)
  return was === is ? null : { role: el.role, control: key, before: was, after: is }
}

/**
 * A radio or option click, read from what changed. The outline knows a radio's form or dialog but not
 * its own group, and one form may hold several groups, so the radio that matters is the one in that
 * form that was on before and is off after: it is recorded on → off, with the clicked radio as the one
 * chosen. An option is matched the same way within its list or menu (ruling A27). When none turned off
 * (nothing was chosen before), the clicked control itself is recorded off → on. A dropdown that closed
 * after the click shows neither, so its option is recorded as unknown.
 */
function choiceChange(clicked: AppElement, before: AppView, after: AppView): DetectedChange | null {
  const wereOn = onBefore(clicked, before)
  const turnedOff = wereOn.find((r) => {
    const now = locateControl(after, r.role, controlKey(before, r))
    return now !== null && onOf(now) === false
  })
  if (turnedOff !== undefined) {
    return { role: clicked.role, control: controlKey(before, turnedOff), before: 'on', after: 'off', chosen: clicked.name }
  }
  const direct = changeOf(clicked, before, after)
  if (direct !== null || !isOption(clicked)) return direct
  const gone = [clicked, ...wereOn].every((r) => locateControl(after, r.role, controlKey(before, r)) === null)
  return gone ? unknownOf(clicked, before) : null
}

/** A setting the action changed: the same control (role, name and place) on the same path, with a new state. */
export function detectChange(action: AppAction, before: AppView, after: AppView): DetectedChange | null {
  const el = settingTarget(action, before)
  if (el === null || pathOf(before.url) !== pathOf(after.url)) return null
  if (el.role === 'radio' || isExclusiveOption(el)) return choiceChange(el, before, after)
  const direct = changeOf(el, before, after)
  // A menu checkbox whose menu closed after the click: its new state can't be seen, so it is unknown.
  const gone = isOption(el) && locateControl(after, el.role, controlKey(before, el)) === null
  return direct === null && gone ? unknownOf(el, before) : direct
}

/** A finish the AI chose. Blocked and unreadable-reply steps also store a finish action, as a placeholder. */
export function isAiFinish(step: AppStep): boolean {
  return step.action.type === 'finish' && step.outcome === 'done'
}

/** What redactUrl and the session put in place of a hidden value. */
const HIDDEN_VALUES = ['redacted', SECRET_PLACEHOLDER]

/** The address a change's page is reopened at: its origin and path, and only the parameters that were not hidden (ruling A15). */
export function restoreAddress(pageUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return pageUrl
  }
  const address = new URL(`${parsed.origin}${parsed.pathname}`)
  for (const [key, value] of parsed.searchParams) {
    if (!HIDDEN_VALUES.some((hidden) => value === hidden || value.includes(SECRET_PLACEHOLDER))) address.searchParams.append(key, value)
  }
  return address.href
}

async function saveScreenshot(ctx: StepContext, jpeg: Buffer | null): Promise<string | null> {
  if (jpeg === null) return null
  const path = `${ctx.run.projectId}/${ctx.run.id}/step-${randomUUID()}.jpg`
  try {
    await ctx.screenshots.upload(path, jpeg)
    return path
  } catch (err) {
    // The step and its text are still evidence without the picture.
    console.error(`[appSteps] run ${ctx.run.id}: could not save the screenshot of a step`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Stores one step. With a page: the screenshot, an Evidence_Page with the outline as its snapshot,
 * its passages (the step line first), then the step row. Without one: the step row alone.
 */
export async function recordStep(ctx: StepContext, input: StepInput): Promise<AppStep> {
  const description = input.description ?? describeAction(input.action, input.describedOn ?? input.view)
  const detail = input.outcome === 'refused' ? (input.refusalReason ?? input.detail) : input.detail
  const line = stepLine(input.position, input.account?.label ?? null, description, input.outcome, detail)
  let pageId: string | null = null
  if (input.view !== null) {
    const { view } = input
    const screenshotPath = await saveScreenshot(ctx, input.screenshot)
    const page = await ctx.repo.addPage(ctx.run.id, {
      url: view.url,
      finalUrl: view.url,
      httpStatus: null,
      accessStatus: input.blocked ? 'blocked' : 'ok',
      accessDetail: input.blocked ? input.detail : null,
      title: view.title,
      text: view.text,
      accessibilitySnapshot: outlineLines(view),
      screenshotPath,
      contentHash: null,
    })
    await ctx.repo.addPassages(page.id, appPassagesOf(line, view))
    pageId = page.id
  }
  return ctx.appRepo.addStep({
    runId: ctx.run.id,
    itemId: ctx.itemId,
    position: input.position,
    accountId: input.account?.id ?? null,
    accountLabel: input.account?.label ?? null,
    action: input.action,
    line,
    outcome: input.outcome,
    refusalReason: input.refusalReason,
    pageId,
  })
}
