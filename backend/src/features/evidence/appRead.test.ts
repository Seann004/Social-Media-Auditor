import type { Browser, Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { quietLogUnlessTestFails, TEST_PAGE_TIMEOUT_MS, TEST_TIMEOUT_MS } from './__fixtures__/pages.js'
import { startSocialApp, type SocialApp } from './__fixtures__/socialApp.js'
import { createAppGuard } from './appGuard.js'
import {
  chooseOption,
  elementPoint,
  focusElement,
  followLink,
  markSecretField,
  outlineLines,
  readAppView,
  screenshotMasked,
  withMasks,
  type AppRead,
} from './appRead.js'
import type { AppElement, AppView } from './appTypes.js'
import { closeBrowser, createGuardedContext, getBrowser, gotoGuarded, type GuardedContext } from './browser.js'
import { APP_ELEMENT_LINE_CHARS, APP_MAX_ELEMENTS } from './config.js'
import { locateQuote, photographQuote } from './highlight.js'
import type { IsolatedWorld } from './pageRead.js'
import { createUrlGuard, type UrlGuard } from './urlGuard.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

let browser: Browser
let social: SocialApp
let guard: UrlGuard
let opened: GuardedContext
let page: Page

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  quietLogUnlessTestFails()
  social = await startSocialApp()
  guard = createAppGuard(createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${social.port}`] }), social.url, [])
  opened = await createGuardedContext(browser, guard)
  page = await opened.context.newPage()
})

afterEach(async () => {
  await opened.context.close()
  await social.close()
  vi.restoreAllMocks()
})

async function go(path: string): Promise<void> {
  const navigation = await gotoGuarded(page, `${social.url}${path}`, guard, TEST_PAGE_TIMEOUT_MS)
  expect(navigation.blockedReason).toBeNull()
}

async function signIn(handle = 'teen15', password = 'Teen-Pass-111'): Promise<void> {
  await go('/login')
  await page.fill('#username', handle)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await page.waitForURL('**/home')
}

function find(view: AppView, role: string, name: string): AppElement {
  const found = view.elements.find((el) => el.role === role && el.name === name)
  if (!found) throw new Error(`No ${role} "${name}" in:\n${outlineLines(view)}`)
  return found
}

async function clickRef(world: IsolatedWorld, ref: string): Promise<void> {
  const point = await elementPoint(world, ref)
  if (!point) throw new Error(`No point for ${ref}`)
  await page.mouse.click(point.x, point.y)
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Shows the password, typed into the field, as large red text. */
async function showPasswordInRed(): Promise<void> {
  await page.evaluate(() => {
    const field = document.getElementById('password') as HTMLInputElement
    field.type = 'text'
    field.value = 'Teen-Pass-111'
    Object.assign(field.style, { color: 'rgb(255, 0, 0)', fontSize: '40px', height: '60px', width: '360px', background: 'white' })
  })
}

async function fieldBox(): Promise<Box> {
  return page.evaluate(() => {
    const r = document.getElementById('password')!.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
}

/** Points spread over the inside of a box, kept clear of its border. */
function pointsIn(box: Box): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const fy of [0.3, 0.5, 0.7]) points.push({ x: Math.round(box.left + box.width * fx), y: Math.round(box.top + box.height * fy) })
  }
  return points
}

interface Pixels {
  samples: number[][]
  /** Clearly red pixels inside the box. */
  red: number
}

/** Decodes the image on a blank page and reads it back from a canvas. */
async function readPixels(jpeg: Buffer, box: Box): Promise<Pixels> {
  const blank = await browser.newPage()
  try {
    return await blank.evaluate(
      async ({ base64, box, points }) => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const samples = points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)))
        const { data } = context.getImageData(Math.max(0, box.left), Math.max(0, box.top), Math.max(1, box.width), Math.max(1, box.height))
        let red = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] < 90 && data[i + 2] < 90) red += 1
        return { samples, red }
      },
      { base64: jpeg.toString('base64'), box, points: pointsIn(box) },
    )
  } finally {
    await blank.close()
  }
}

function expectBlack(pixels: Pixels): void {
  for (const [r, g, b] of pixels.samples) {
    expect(r).toBeLessThan(40)
    expect(g).toBeLessThan(40)
    expect(b).toBeLessThan(40)
  }
  expect(pixels.red).toBe(0)
}

describe('readAppView', () => {
  it('reads visible text and never hidden text', async () => {
    await signIn()
    const { view } = await readAppView(page, null)

    expect(view.title).toBe('Home')
    expect(view.text).toContain('Anyone up for the game tonight?')
    expect(view.text).not.toContain('AI agent')
    expect(view.text).not.toContain('click Delete account')
  })

  it('lists interactive elements with refs, roles, names and states', async () => {
    await signIn()
    await go('/settings')
    const { view } = await readAppView(page, null)

    expect(view.elements.map((el) => el.ref)).toEqual(view.elements.map((_, i) => `e${i + 1}`))
    expect(find(view, 'switch', 'Private account')).toMatchObject({ tag: 'button', state: { checked: true } })
    expect(find(view, 'checkbox', 'Show activity status')).toMatchObject({ tag: 'input', inputType: 'checkbox', state: { checked: true } })
    expect(find(view, 'button', 'Delete account')).toMatchObject({ role: 'button' })
    expect(find(view, 'link', 'Change password').href).toBe(`${social.url}/settings/password`)
  })

  it('gives each Follow button the context text of its own article', async () => {
    await signIn()
    const { view } = await readAppView(page, null)

    const follow = find(view, 'button', 'Follow')
    expect(follow.contextText).toContain('@stranger')
    expect(follow.contextText).toContain('Anyone up for the game tonight?')
    expect(follow.contextText).not.toContain("What's on your mind?")
  })

  it('omits hidden elements from the outline', async () => {
    await signIn()
    const { view } = await readAppView(page, null)

    expect(view.elements.map((el) => el.name)).not.toContain('Delete account')
    expect(outlineLines(view)).not.toContain('Delete account')
    expect(find(view, 'button', 'Post')).toBeDefined()
  })

  it('gives the composer’s Audience select and Post button the same groupId, and the article’s Follow another', async () => {
    await signIn()
    const { view } = await readAppView(page, null)

    const audience = find(view, 'combobox', 'Audience')
    const post = find(view, 'button', 'Post')
    expect(audience.groupId).toMatch(/^g\d+$/)
    expect(post.groupId).toBe(audience.groupId)
    expect(find(view, 'button', 'Follow').groupId).not.toBe(audience.groupId)
    expect(audience.state.options).toEqual(['Public', 'Only me'])
  })

  it('never reports the value of a password field, even after Show password', async () => {
    await go('/login')
    const first = await readAppView(page, null)
    expect(first.view.hasPasswordField).toBe(true)

    expect(await focusElement(first.world, find(first.view, 'textbox', 'Password').ref)).toBe(true)
    await page.keyboard.insertText('typed-secret')
    await clickRef(first.world, find(first.view, 'button', 'Show password').ref)
    await expect.poll(() => page.locator('#password').getAttribute('type')).toBe('text')

    const second = await readAppView(page, first.world)
    expect(second.world).toBe(first.world)
    expect(find(second.view, 'textbox', 'Password').state.value).toBeUndefined()
    expect(JSON.stringify(second.view)).not.toContain('typed-secret')
  })

  it('never reports the value of a field marked secret', async () => {
    await go('/login')
    const first = await readAppView(page, null)
    const username = find(first.view, 'textbox', 'Username').ref
    await focusElement(first.world, username)
    await page.keyboard.insertText('plain-name')
    // The same field, before it is marked: its value is reported.
    const before = await readAppView(page, first.world)
    expect(find(before.view, 'textbox', 'Username').state.value).toBe('plain-name')

    await markSecretField(before.world, find(before.view, 'textbox', 'Username').ref)
    const after = await readAppView(page, before.world)
    expect(find(after.view, 'textbox', 'Username').state.value).toBeUndefined()
    expect(JSON.stringify(after.view)).not.toContain('plain-name')
  })

  it('reports a redacted href and URL, while followLink opens the real address', async () => {
    await signIn()
    await go('/home?code=zz')
    const { view, world } = await readAppView(page, null)

    const profile = find(view, 'link', 'Profile')
    expect(profile.href).toBe(`${social.url}/u/teen15?token=redacted`)
    expect(view.url).toBe(`${social.url}/home?code=redacted`)
    expect(JSON.stringify(view)).not.toContain('token=abc')
    expect(JSON.stringify(view)).not.toContain('code=zz')

    expect(await followLink(world, profile.ref)).toBe(true)
    await page.waitForURL(`${social.url}/u/teen15?token=abc`)
    const next = await readAppView(page, world)
    expect(next.world).not.toBe(world)
    expect(next.view.title).toBe('@teen15')
  })

  it('leaves page scripts running: the switch still saves after a read', async () => {
    await signIn()
    await go('/settings')
    const { view, world } = await readAppView(page, null)

    await clickRef(world, find(view, 'switch', 'Private account').ref)
    await expect.poll(() => social.state().privateAccount.teen15).toBe(false)
  })

  it('elementPoint returns null when another element covers the target', async () => {
    await go('/covered')
    const covered = await readAppView(page, null)
    expect(await elementPoint(covered.world, find(covered.view, 'button', 'Follow').ref)).toBeNull()

    await page.evaluate(() => document.querySelector('div[style*="inset"]')!.remove())
    const clear = await readAppView(page, covered.world)
    expect(await elementPoint(clear.world, find(clear.view, 'button', 'Follow').ref)).not.toBeNull()
  })

  it('a ref whose element the page removed is stale: elementPoint null, focusElement false', async () => {
    social.setMode({ reshuffleButtons: true })
    await go('/shifting')
    const { view, world } = await readAppView(page, null)
    expect(view.elements.map((el) => el.name)).toEqual(['Save draft', 'Delete draft'])
    const save = find(view, 'button', 'Save draft').ref
    expect(await elementPoint(world, save)).not.toBeNull()

    await page.waitForFunction(() => document.querySelector('#buttons button')?.textContent === 'Delete draft')
    expect(await elementPoint(world, save)).toBeNull()
    expect(await focusElement(world, save)).toBe(false)
    expect(await chooseOption(world, save, 'x')).toBe(false)
    expect(await followLink(world, save)).toBe(false)
    expect(await page.textContent('#status')).toBe('Nothing pressed')

    const fresh = await readAppView(page, world)
    expect(fresh.view.elements.map((el) => el.name)).toEqual(['Delete draft', 'Save draft'])
  })

  it('chooseOption picks an option by its text, and refuses one that is not there', async () => {
    await signIn()
    const first = await readAppView(page, null)
    const audience = find(first.view, 'combobox', 'Audience').ref

    expect(await chooseOption(first.world, audience, 'Nobody')).toBe(false)
    expect(await chooseOption(first.world, audience, 'Only me')).toBe(true)
    expect(await page.inputValue('#audience')).toBe('only_me')
    const second = await readAppView(page, first.world)
    expect(outlineLines(second.view)).toContain('combobox "Audience" [value: Only me]')
  })

  it(`lists at most ${APP_MAX_ELEMENTS} elements`, async () => {
    await page.setContent(Array.from({ length: APP_MAX_ELEMENTS + 20 }, (_, i) => `<button>B${i}</button>`).join(''))
    const { view } = await readAppView(page, null)
    expect(view.elements).toHaveLength(APP_MAX_ELEMENTS)
    expect(view.elements.at(-1)?.name).toBe(`B${APP_MAX_ELEMENTS - 1}`)
  })
})

describe('masked pictures', () => {
  async function loginWithRedPassword(): Promise<AppRead> {
    await go('/login')
    const read = await readAppView(page, null)
    await showPasswordInRed()
    return read
  }

  it('screenshotMasked paints the password field solid black', async () => {
    const { world } = await loginWithRedPassword()
    const box = await fieldBox()

    const shot = await screenshotMasked(page, world)
    expect(shot).not.toBeNull()
    expectBlack(await readPixels(shot!, box))
  })

  it('screenshotMasked removes its masks afterwards', async () => {
    const { view, world } = await loginWithRedPassword()
    const styleBefore = await page.getAttribute('#password', 'style')
    const box = await fieldBox()

    await screenshotMasked(page, world)
    expect(await page.getAttribute('#password', 'style')).toBe(styleBefore)
    const plain = await page.screenshot({ type: 'jpeg' })
    expect((await readPixels(plain, box)).red).toBeGreaterThan(100)
    // Page scripts are back on: Show password works.
    await clickRef(world, find(view, 'button', 'Show password').ref)
    await expect.poll(() => page.locator('#password').getAttribute('type')).toBe('password')
  })

  it('withMasks switches page scripts off during the work and back on in the end, even when the work throws', async () => {
    await go('/login')
    const { view, world } = await readAppView(page, null)
    const show = find(view, 'button', 'Show password').ref

    await expect(
      withMasks(page, world, async () => {
        await clickRef(world, show)
        throw new Error('work failed')
      }),
    ).rejects.toThrow('work failed')
    expect(await page.getAttribute('#password', 'type')).toBe('password')
    expect(await page.getAttribute('#password', 'style')).toBeNull()

    await clickRef(world, show)
    await expect.poll(() => page.locator('#password').getAttribute('type')).toBe('text')
  })

  it('a close-up taken with photographQuote inside withMasks paints the password field black', async () => {
    const { world } = await loginWithRedPassword()

    const shot = await withMasks(page, world, () => photographQuote(world, 'Password', page.url(), TEST_PAGE_TIMEOUT_MS))
    expect(shot).not.toBeNull()
    // The close-up scrolled the page, so a mask fixed to the screen would have missed the field.
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0)

    const placement = await locateQuote(world, 'Password')
    await world.evaluate('globalThis.__evidenceHighlighter.clear()')
    expect(placement).not.toBeNull()
    const field = await fieldBox()
    const inShot = { ...field, left: field.left - placement!.clip.x + placement!.scroll.x, top: field.top - placement!.clip.y + placement!.scroll.y }
    const visible = {
      ...inShot,
      width: Math.min(inShot.width, placement!.clip.width - inShot.left),
      height: Math.min(inShot.height, placement!.clip.height - inShot.top),
    }
    expect(visible.width).toBeGreaterThan(40)
    expect(visible.height).toBeGreaterThan(40)
    expectBlack(await readPixels(shot!, visible))
  })

  it('screenshotMasked returns null when the world is gone', async () => {
    await go('/login')
    const { world } = await readAppView(page, null)
    await go('/covered')
    expect(await screenshotMasked(page, world)).toBeNull()
  })
})

describe('outlineLines', () => {
  const element = (over: Partial<AppElement>): AppElement => ({
    ref: 'e1',
    role: 'button',
    name: 'Go',
    tag: 'button',
    inputType: null,
    href: null,
    groupId: null,
    state: {},
    contextText: '',
    ...over,
  })
  const viewOf = (elements: AppElement[]): AppView => ({ url: 'https://app.test/', title: 'T', text: '', elements, frameUrls: [], hasPasswordField: false })

  it('caps each line and renders state as [on]/[off]/[value: Only me]', () => {
    const lines = outlineLines(
      viewOf([
        element({ ref: 'e1', role: 'switch', name: 'Private account', state: { checked: true } }),
        element({ ref: 'e2', role: 'checkbox', name: 'Show activity status', state: { checked: false } }),
        element({ ref: 'e3', role: 'combobox', name: 'Audience', state: { value: 'Only me', options: ['Public', 'Only me'] } }),
        element({ ref: 'e4', role: 'tab', name: 'Posts', state: { selected: true, disabled: true, expanded: true } }),
        element({ ref: 'e5', name: 'x'.repeat(400) }),
        element({ ref: 'e6', role: 'link', name: 'Help' }),
      ]),
    ).split('\n')

    expect(lines[0]).toBe('e1 switch "Private account" [on]')
    expect(lines[1]).toBe('e2 checkbox "Show activity status" [off]')
    expect(lines[2]).toBe('e3 combobox "Audience" [value: Only me]')
    expect(lines[3]).toBe('e4 tab "Posts" [selected] [disabled] [expanded]')
    expect(lines[4].length).toBe(APP_ELEMENT_LINE_CHARS)
    expect(lines[4].startsWith('e5 button "xxx')).toBe(true)
    expect(lines[5]).toBe('e6 link "Help"')
  })

  it('is empty for a view with no elements', () => {
    expect(outlineLines(viewOf([]))).toBe('')
  })
})
