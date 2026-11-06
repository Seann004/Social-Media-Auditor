import type { Page } from 'playwright'
import { z } from 'zod'
import { APP_READ_SOURCE } from './appReadSource.js'
import { scrubView, secretPatterns } from './appSecrets.js'
import type { AppElement, AppElementState, AppView } from './appTypes.js'
import { withinTimeout } from './browser.js'
import { logCaptureFailure } from './captureLog.js'
import { APP_ACTION_TIMEOUT_MS, APP_ELEMENT_LINE_CHARS, JPEG_QUALITY } from './config.js'
import { HIGHLIGHT_SOURCE } from './highlightSource.js'
import { DECIDE_HIDDEN_SOURCE, openIsolatedWorld, type IsolatedWorld } from './pageRead.js'
import { redactUrl } from './secrets.js'

export interface AppRead {
  view: AppView
  world: IsolatedWorld
}

export interface Point {
  x: number
  y: number
}

const APP_WORLD_NAME = 'evidence-app'
export { SECRET_PLACEHOLDER } from './appSecrets.js'
/** The only errors that mean a world's document is gone, rather than that something else went wrong. */
const DEAD_WORLD_ERROR = /Cannot find context with specified id|Execution context was destroyed|Target (page, context or browser )?(has been )?closed|Session closed|has been closed/i

/** What is hidden and the page text are decided again at every read, in the same evaluate as the read. */
const READ_EXPRESSION = `${DECIDE_HIDDEN_SOURCE};\n${HIGHLIGHT_SOURCE};\nglobalThis.__evidenceApp.read()`

const stateSchema = z.object({
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  disabled: z.boolean().optional(),
  expanded: z.boolean().optional(),
  value: z.string().optional(),
  options: z.array(z.string()).optional(),
})
const rawViewSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  elements: z.array(
    z.object({
      ref: z.string(),
      role: z.string(),
      name: z.string(),
      tag: z.string(),
      inputType: z.string().nullable(),
      href: z.string().nullable(),
      groupId: z.string().nullable(),
      state: stateSchema,
      contextText: z.string(),
    }),
  ),
  frameUrls: z.array(z.string()),
  hasPasswordField: z.boolean(),
})
const pointSchema = z.object({ x: z.number(), y: z.number() }).nullable()
const screenshotSchema = z.object({ data: z.string() })

/** Every address goes through redactUrl here: the real ones stay in the world. */
function toView(raw: z.infer<typeof rawViewSchema>): AppView {
  return {
    ...raw,
    url: redactUrl(raw.url),
    elements: raw.elements.map((el) => ({ ...el, href: el.href === null ? null : redactUrl(el.href) })),
    frameUrls: raw.frameUrls.map(redactUrl),
  }
}

/**
 * True while the world's document is the page's document: a navigation destroys the world. Any
 * other failure is passed on, because opening a new world would lose the fields marked secret.
 */
async function isAlive(world: IsolatedWorld): Promise<boolean> {
  try {
    return (await world.evaluate(`typeof globalThis.__evidenceApp === 'object'`)) === true
  } catch (err) {
    if (err instanceof Error && DEAD_WORLD_ERROR.test(err.message)) return false
    throw err
  }
}

async function openAppWorld(page: Page, previous: IsolatedWorld | null): Promise<IsolatedWorld> {
  await previous?.cdp.detach().catch(() => undefined)
  const world = await openIsolatedWorld(page, APP_WORLD_NAME, { scriptsOff: false })
  await world.evaluate(APP_READ_SOURCE)
  return world
}

/**
 * Reads what a person sees of the page: its visible text and an outline of what can be used on it.
 * Reuses `previous` while its document is still the page's, so that fields marked secret stay
 * secret for as long as the page; otherwise opens a fresh world, with the page's scripts left on.
 * Refs are renumbered on every read, and only refs from the latest read mean anything.
 *
 * `secrets` are the credentials typed in this session. As a backstop to the secret fields, every
 * occurrence of one in the view's free text is replaced with SECRET_PLACEHOLDER (see scrubView).
 */
export async function readAppView(page: Page, previous: IsolatedWorld | null, secrets: readonly string[] = []): Promise<AppRead> {
  const world = previous !== null && (await isAlive(previous)) ? previous : await openAppWorld(page, previous)
  const raw = rawViewSchema.parse(await world.evaluate(READ_EXPRESSION))
  return { view: scrubView(toView(raw), secrets), world }
}

function call(name: string, ...args: unknown[]): string {
  return `globalThis.__evidenceApp.${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`
}

/** Where to click the element, in viewport coordinates. Null when it is stale or something else is on top of it. */
export async function elementPoint(world: IsolatedWorld, ref: string): Promise<Point | null> {
  return pointSchema.parse(await world.evaluate(call('point', ref)))
}

/** False when the ref is stale or the element would not take the focus. */
export async function focusElement(world: IsolatedWorld, ref: string): Promise<boolean> {
  return z.boolean().parse(await world.evaluate(call('focus', ref)))
}

/** Picks an option of a select by its text, or failing that by its value. False when it cannot. */
export async function chooseOption(world: IsolatedWorld, ref: string, option: string): Promise<boolean> {
  return z.boolean().parse(await world.evaluate(call('choose', ref, option)))
}

/** Keeps the field's value out of every later read, and paints it black in every picture, for the life of the page. */
export async function markSecretField(world: IsolatedWorld, ref: string): Promise<void> {
  await world.evaluate(call('markSecret', ref))
}

/**
 * Navigates to the link's real address from inside the world, so that address never leaves it.
 * The guarded context's navigation gate still checks it. False when the ref is stale or not an
 * http(s) link.
 */
export async function followLink(world: IsolatedWorld, ref: string): Promise<boolean> {
  return z.boolean().parse(await world.evaluate(call('follow', ref)))
}

async function setScriptsOff(world: IsolatedWorld, off: boolean): Promise<void> {
  await world.cdp.send('Emulation.setScriptExecutionDisabled', { value: off })
}

/**
 * Runs `work` with every password field and every secret field painted black, and the page's own
 * scripts off, so that no script can take the paint away. The paint is on the field itself, so it
 * moves with the field when a close-up scrolls the page. Paint and scripts are put back in the end.
 *
 * `secrets` are the credentials typed in this session. Any field whose value holds one, and the
 * smallest elements whose text holds one, are painted black too, matched as secretPatterns does.
 * The patterns go to the isolated world only, and are never written to the page or a log.
 */
export async function withMasks<T>(page: Page, world: IsolatedWorld, work: () => Promise<T>, secrets: readonly string[] = []): Promise<T> {
  await setScriptsOff(world, true)
  try {
    try {
      await world.evaluate(call('mask', secretPatterns(secrets)))
      return await work()
    } finally {
      await world.evaluate(call('unmask')).catch((err: unknown) => logCaptureFailure('Could not remove the masks', redactUrl(page.url()), err))
    }
  } finally {
    await setScriptsOff(world, false).catch((err: unknown) =>
      logCaptureFailure('Could not switch the page scripts back on', redactUrl(page.url()), err),
    )
  }
}

/** A JPEG of the viewport with every password and secret field black, or null when it could not be taken. */
export async function screenshotMasked(page: Page, world: IsolatedWorld, secrets: readonly string[] = []): Promise<Buffer | null> {
  try {
    const shot = await withMasks(
      page,
      world,
      () =>
        withinTimeout(world.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: JPEG_QUALITY }), APP_ACTION_TIMEOUT_MS, 'Taking the screenshot'),
      secrets,
    )
    return Buffer.from(screenshotSchema.parse(shot).data, 'base64')
  } catch (err) {
    logCaptureFailure('Could not take the screenshot', redactUrl(page.url()), err)
    return null
  }
}

function stateText(state: AppElementState): string {
  const parts = [
    state.checked === undefined ? null : state.checked ? '[on]' : '[off]',
    state.selected ? '[selected]' : null,
    state.disabled ? '[disabled]' : null,
    state.expanded ? '[expanded]' : null,
    state.value === undefined ? null : `[value: ${state.value}]`,
  ]
  return parts
    .filter((part) => part !== null)
    .map((part) => ` ${part}`)
    .join('')
}

function outlineLine(el: AppElement): string {
  const line = `${el.ref} ${el.role} "${el.name}"${stateText(el.state)}`
  return line.length > APP_ELEMENT_LINE_CHARS ? `${line.slice(0, APP_ELEMENT_LINE_CHARS - 1)}…` : line
}

/** One line per element, as the AI sees the page's controls. */
export function outlineLines(view: AppView): string {
  return view.elements.map(outlineLine).join('\n')
}
