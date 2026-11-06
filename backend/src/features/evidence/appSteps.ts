/** The words of an app check's steps, and how each step is stored as evidence. */
import { randomUUID } from 'node:crypto'
import { outlineLines } from './appRead.js'
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

/** One step as the AI, the replay and the passages read it. */
export function stepLine(position: number, accountLabel: string | null, description: string, outcome: AppStepOutcome, detail: string): string {
  const head = accountLabel === null ? `Step ${position}` : `Step ${position} · ${accountLabel}`
  switch (outcome) {
    case 'done':
      return detail === '' ? `${head} · ${description}` : `${head} · ${description} → ${detail}`
    case 'refused':
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

/** A setting's state as a change records it: on or off, or the selected value. */
export function controlState(el: AppElement): string {
  if (ON_OFF_ROLES.includes(el.role) && el.state.checked !== undefined) return el.state.checked ? 'on' : 'off'
  if (el.state.checked !== undefined && el.tag === 'input') return el.state.checked ? 'on' : 'off'
  return el.state.value ?? ''
}

/** Whether a control's state is a setting that a change records. */
export function isSettingControl(el: AppElement): boolean {
  return SETTING_ROLES.includes(el.role) || el.tag === 'select'
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

/** The setting an action works on: for a radio, the radio of its group that was on before. */
function changedControl(action: AppAction, before: AppView): { el: AppElement; chosen?: AppElement } | null {
  if (action.type !== 'toggle' && action.type !== 'click' && action.type !== 'select') return null
  const el = elementOf(before, action.ref)
  if (el === null || !isSettingControl(el)) return null
  if (el.role !== 'radio') return { el }
  const previous = before.elements.find((other) => other.role === 'radio' && other.ref !== el.ref && other.groupId === el.groupId && other.state.checked === true)
  return previous === undefined ? null : { el: previous, chosen: el }
}

/** Whether the action works on a setting, so that its effect must be looked for whatever the action reported. */
export function touchesSetting(action: AppAction, before: AppView): boolean {
  return changedControl(action, before) !== null
}

/** The change to record when the page could not be read after a setting action (ruling A16). */
export function unknownChange(action: AppAction, before: AppView): DetectedChange | null {
  const target = changedControl(action, before)
  if (target === null) return null
  const change: DetectedChange = { role: target.el.role, control: controlKey(before, target.el), before: controlState(target.el), after: UNKNOWN_STATE }
  return target.chosen === undefined ? change : { ...change, chosen: target.chosen.name }
}

/** A setting the action changed: the same control (role, name and place) on the same path, with a new state. */
export function detectChange(action: AppAction, before: AppView, after: AppView): DetectedChange | null {
  const target = changedControl(action, before)
  if (target === null || pathOf(before.url) !== pathOf(after.url)) return null
  const key = controlKey(before, target.el)
  const now = locateControl(after, target.el.role, key)
  if (now === null) return null
  const was = controlState(target.el)
  const is = controlState(now)
  if (was === is) return null
  const change: DetectedChange = { role: target.el.role, control: key, before: was, after: is }
  return target.chosen === undefined ? change : { ...change, chosen: target.chosen.name }
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
