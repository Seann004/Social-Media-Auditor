import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeBrowser } from './browser.js'
import { startPageServer, TEST_TIMEOUT_MS, type PageServer } from './__fixtures__/pages.js'
import { startAppWorld, TEEN_PASSWORD, type AppWorld } from './__fixtures__/appWorld.js'
import { SOCIAL_RESHUFFLE_MS } from './__fixtures__/socialApp.js'
import { outlineLines } from './appRead.js'
import { createSessionPool, type ActionResult, type AppSession, type AppSessionPool } from './appSession.js'
import type { AppElement, AppView } from './appTypes.js'
import { APP_LOGIN_FAILURES_BEFORE_UNUSABLE } from './config.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const COVERED = 'The element was covered or had moved, so it was not clicked.'
const OUTSIDE = 'The app moved to an address outside it, so the page was left.'

let world: AppWorld
let pool: AppSessionPool
let other: PageServer | null = null

function poolWith(overrides: { secretKey?: Buffer } = {}): AppSessionPool {
  return createSessionPool({
    browser: world.browser,
    baseGuard: world.baseGuard,
    app: world.app,
    accounts: [world.teen, world.adult],
    secretKey: overrides.secretKey ?? world.secretKey,
    signal: world.abort.signal,
    aborted: world.aborted,
  })
}

beforeEach(async () => {
  world = await startAppWorld()
  pool = poolWith()
})

afterEach(async () => {
  await pool.closeAll()
  await world.close()
  await other?.close()
  other = null
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeBrowser()
})

function find(view: AppView, role: string, name: string): AppElement {
  const found = view.elements.find((el) => el.role === role && el.name === name)
  if (!found) throw new Error(`No ${role} "${name}" in:\n${outlineLines(view)}`)
  return found
}

function expectOk(result: ActionResult): void {
  expect(result).toMatchObject({ ok: true })
}

/** Reads the login page and signs in with fill_credential and a click on Sign in. */
async function signIn(session: AppSession, label = session.account.label): Promise<void> {
  const view = await session.read()
  expectOk(await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Username').ref, account: label, field: 'login' }))
  expectOk(await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: label, field: 'password' }))
  expectOk(await session.execute({ type: 'click', ref: find(view, 'button', 'Sign in').ref }))
}

async function teenSignedIn(): Promise<AppSession> {
  const session = await pool.open(world.teen.id)
  await signIn(session)
  return session
}

/** Reads the page, finds the control and carries the action out on it. */
async function onControl(session: AppSession, role: string, name: string, type: 'click' | 'toggle'): Promise<ActionResult> {
  const view = await session.read()
  return session.execute({ type, ref: find(view, role, name).ref })
}

/** Shows what the field holds as large blue text, as a page that wanted to show the password would. */
async function showFieldInBlue(session: AppSession): Promise<void> {
  await session.page.evaluate(() => {
    const field = document.getElementById('password') as HTMLInputElement
    field.type = 'text'
    Object.assign(field.style, { color: 'rgb(0, 0, 255)', fontSize: '40px', height: '60px', width: '360px', background: 'white' })
  })
}

/** How many clearly blue pixels (the highlight box is orange, so blue is the page text alone) the picture holds. */
async function bluePixels(session: AppSession, jpeg: Buffer): Promise<number> {
  const blank = await session.page.context().browser()!.newPage()
  try {
    return await blank.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/jpeg;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let blue = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] > 170) blue += 1
      return blue
    }, jpeg.toString('base64'))
  } finally {
    await blank.close()
  }
}

describe('opening and signing in', () => {
  it('signs Teen 15 in with fill_credential and lands on /home', async () => {
    const session = await teenSignedIn()

    expect(session.currentUrl()).toBe(`${world.social.url}/home`)
    expect(world.social.state().loginAttempts).toEqual([{ handle: 'teen15', ok: true }])
  })

  it('keeps one context per account: Teen and Adult cookies never mix', async () => {
    const teen = await teenSignedIn()
    const adult = await pool.open(world.adult.id)
    await signIn(adult)

    expect(teen.page.context()).not.toBe(adult.page.context())
    const sid = async (session: AppSession) => (await session.page.context().cookies()).find((c) => c.name === 'sid')?.value
    expect(await sid(teen)).toBeDefined()
    expect(await sid(adult)).toBeDefined()
    expect(await sid(teen)).not.toBe(await sid(adult))
    expect(world.social.state().loginAttempts).toEqual([
      { handle: 'teen15', ok: true },
      { handle: 'adult30', ok: true },
    ])
  })

  it('open() twice returns the same session, so each account logs in once per run', async () => {
    const [first, second] = await Promise.all([pool.open(world.teen.id), pool.open(world.teen.id)])
    expect(second).toBe(first)
    expect(await pool.open(world.teen.id)).toBe(first)
    expect(pool.get(world.teen.id)).toBe(first)
    expect(pool.get(world.adult.id)).toBeNull()
    expect(first.page.context().pages()).toHaveLength(1)
  })

  it('resetAll sends every open session back to the app address', async () => {
    const teen = await teenSignedIn()
    const adult = await pool.open(world.adult.id)
    await teen.gotoInApp(`${world.social.url}/settings`)
    await adult.gotoInApp(`${world.social.url}/covered`)

    await pool.resetAll()

    expect(teen.currentUrl()).toBe(world.app.appUrl)
    expect(adult.currentUrl()).toBe(world.app.appUrl)
  })

  it('open() refuses an account that is not part of the run', async () => {
    await expect(pool.open('nobody')).rejects.toThrow('not part of this run')
  })
})

describe('run state', () => {
  it('noteLoginFailure returns a new state, leaves the earlier one as it was, and at 2 is unusable', () => {
    const fresh = pool.stateOf('a')
    expect(fresh).toEqual({ loginFailures: 0, unusable: null })

    const first = pool.noteLoginFailure('a')
    expect(first).toEqual({ loginFailures: 1, unusable: null })
    expect(fresh).toEqual({ loginFailures: 0, unusable: null })
    expect(first).not.toBe(fresh)

    const second = pool.noteLoginFailure('a')
    expect(APP_LOGIN_FAILURES_BEFORE_UNUSABLE).toBe(2)
    expect(second).toEqual({ loginFailures: 2, unusable: 'signing in failed twice' })
    expect(first).toEqual({ loginFailures: 1, unusable: null })
    expect(pool.stateOf('a')).toBe(second)
    expect(pool.stateOf('b')).toEqual({ loginFailures: 0, unusable: null })
  })
})

describe('actions', () => {
  it('a click lands on the named element and reports success', async () => {
    const session = await teenSignedIn()

    expectOk(await onControl(session, 'button', 'Follow', 'click'))

    await vi.waitFor(() => expect(world.social.state().follows).toEqual([{ from: 'teen15', to: 'stranger' }]))
  })

  it('type, select and click post with the typed text and the chosen audience', async () => {
    const session = await teenSignedIn()
    const view = await session.read()

    expectOk(await session.execute({ type: 'type', ref: find(view, 'textbox', "What's on your mind?").ref, text: 'Hello there' }))
    expectOk(await session.execute({ type: 'select', ref: find(view, 'combobox', 'Audience').ref, option: 'Only me' }))
    expectOk(await session.execute({ type: 'click', ref: find(view, 'button', 'Post').ref }))

    expect(world.social.state().posts).toEqual([{ author: 'teen15', audience: 'Only me', text: 'Hello there' }])
  })

  it('a select with an option that does not exist fails', async () => {
    const session = await teenSignedIn()
    const view = await session.read()

    const result = await session.execute({ type: 'select', ref: find(view, 'combobox', 'Audience').ref, option: 'Nobody' })

    expect(result).toEqual({ ok: false, detail: 'That option could not be chosen.' })
  })

  it('toggle presses a switch', async () => {
    const session = await teenSignedIn()
    await session.gotoInApp(`${world.social.url}/settings`)

    expectOk(await onControl(session, 'switch', 'Private account', 'toggle'))

    await vi.waitFor(() => expect(world.social.state().privateAccount.teen15).toBe(false))
  })

  it('back goes to the earlier page', async () => {
    const session = await teenSignedIn()
    await session.gotoInApp(`${world.social.url}/settings`)

    expectOk(await session.execute({ type: 'back' }))

    expect(session.currentUrl()).toBe(`${world.social.url}/home`)
  })

  it('a click on an element covered by an overlay fails and clicks nothing', async () => {
    const session = await teenSignedIn()
    await session.gotoInApp(`${world.social.url}/covered`)

    const result = await onControl(session, 'button', 'Follow', 'click')

    expect(result).toEqual({ ok: false, detail: COVERED })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(world.social.state().follows).toEqual([])
  })

  it('after the buttons are replaced, a stale ref fails and does not press the other button', async () => {
    world.social.setMode({ reshuffleButtons: true })
    const session = await teenSignedIn()
    await session.gotoInApp(`${world.social.url}/shifting`)
    const view = await session.read()
    const saveDraft = find(view, 'button', 'Save draft').ref
    await new Promise((resolve) => setTimeout(resolve, SOCIAL_RESHUFFLE_MS + 400))

    const result = await session.execute({ type: 'click', ref: saveDraft })

    expect(result).toEqual({ ok: false, detail: COVERED })
    expect(await session.page.textContent('#status')).toBe('Nothing pressed')
  })

  it('a ref from before a navigation fails with "the page changed" and does nothing', async () => {
    const session = await teenSignedIn()
    const view = await session.read()
    const follow = find(view, 'button', 'Follow').ref
    await session.gotoInApp(`${world.social.url}/settings`)

    const result = await session.execute({ type: 'click', ref: follow })

    expect(result).toEqual({ ok: false, detail: 'The page changed before the action, so nothing was done.' })
    expect(world.social.state().follows).toEqual([])
  })

  it('open_link by ref reaches the real address; the view and currentUrl show it redacted', async () => {
    const session = await teenSignedIn()
    const view = await session.read()
    const profile = find(view, 'link', 'Profile')
    expect(profile.href).toContain('token=redacted')
    expect(profile.href).not.toContain('abc')

    expectOk(await session.execute({ type: 'open_link', ref: profile.ref }))

    expect(session.page.url()).toBe(`${world.social.url}/u/teen15?token=abc`)
    expect(session.currentUrl()).toBe(`${world.social.url}/u/teen15?token=redacted`)
  })

  it('open_link with a url opens it through the guard', async () => {
    const session = await teenSignedIn()

    expectOk(await session.execute({ type: 'open_link', url: `${world.social.url}/settings` }))
    expect(session.currentUrl()).toBe(`${world.social.url}/settings`)

    const refused = await session.execute({ type: 'open_link', url: 'http://example.org/' })
    expect(refused.ok).toBe(false)
    expect(session.currentUrl()).toBe(`${world.social.url}/settings`)
  })
})

describe('leaving the app', () => {
  it('a click on an off-platform link is stopped and fails, and nothing reaches the refused host', async () => {
    other = await startPageServer({ '/': '<p>Elsewhere</p>' })
    await world.close()
    world = await startAppWorld({ extraPrivateHosts: [`127.0.0.1:${other.port}`] })
    pool = poolWith()
    const session = await teenSignedIn()
    await session.page.evaluate((href) => {
      const link = document.createElement('a')
      link.href = href
      link.textContent = 'Partner site'
      document.body.append(link)
    }, other.url)

    const result = await onControl(session, 'link', 'Partner site', 'click')

    expect(result).toEqual({ ok: false, detail: OUTSIDE })
    expect(other.requests()).toEqual([])
    expect(session.currentUrl()).toBe(`${world.social.url}/home`)
  })

  it('an action that ends outside the app is undone and fails', async () => {
    const session = await teenSignedIn()
    const view = await session.read()
    const goBack = vi.spyOn(session.page, 'goBack')
    // Nothing real can get the page out of scope past the gate, so the address is forged after the click.
    const realUrl = session.page.url.bind(session.page)
    let clicked = false
    vi.spyOn(session.page.mouse, 'click').mockImplementation(async () => {
      clicked = true
    })
    vi.spyOn(session.page, 'url').mockImplementation(() => (clicked ? 'http://example.org/elsewhere' : realUrl()))

    const result = await session.execute({ type: 'click', ref: find(view, 'button', 'Follow').ref })

    expect(result).toEqual({ ok: false, detail: OUTSIDE })
    expect(goBack).toHaveBeenCalled()
  })

  it('a page-started redirect to example.org leaves the session on the app', async () => {
    const session = await teenSignedIn()

    await session.gotoInApp(`${world.social.url}/leave`)
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(session.currentUrl().startsWith(world.social.url)).toBe(true)
    expect(session.page.url().startsWith('chrome-error:')).toBe(false)
  })

  it('open_link to a page that redirects out of the app fails and leaves the session on the app', async () => {
    const session = await teenSignedIn()

    const result = await session.execute({ type: 'open_link', url: `${world.social.url}/leave` })

    expect(result.ok).toBe(false)
    expect(session.currentUrl().startsWith(world.social.url)).toBe(true)
  })
})

describe('secrets', () => {
  it('a close-up from the session paints the password field black', async () => {
    const session = await pool.open(world.teen.id)
    const view = await session.read()
    expectOk(await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: 'Teen 15', field: 'password' }))
    await showFieldInBlue(session)
    await session.read()
    expect(await bluePixels(session, await session.page.screenshot({ type: 'jpeg' }))).toBeGreaterThan(100)

    const shot = await session.photographQuote('Password')

    expect(shot).not.toBeNull()
    expect(await bluePixels(session, shot!)).toBe(0)
  })

  it('the session screenshot after a fill shows the password field masked', async () => {
    const session = await pool.open(world.teen.id)
    const view = await session.read()
    expectOk(await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: 'Teen 15', field: 'password' }))
    await showFieldInBlue(session)

    const shot = await session.screenshot()

    expect(shot).not.toBeNull()
    expect(await bluePixels(session, shot!)).toBe(0)
  })

  it('a copy of the password in the page text is masked in the screenshot and scrubbed from the view', async () => {
    const session = await pool.open(world.teen.id)
    const view = await session.read()
    expectOk(await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: 'Teen 15', field: 'password' }))
    await session.page.evaluate((secret) => {
      const copy = document.createElement('p')
      copy.textContent = secret
      Object.assign(copy.style, { color: 'rgb(0, 0, 255)', fontSize: '40px' })
      document.body.prepend(copy)
    }, TEEN_PASSWORD)

    const shot = await session.screenshot()
    const after = await session.read()

    expect(await bluePixels(session, shot!)).toBe(0)
    expect(JSON.stringify(after)).not.toContain(TEEN_PASSWORD)
  })

  it('a screenshot between a read and an action leaves the refs of the read as they were', async () => {
    const session = await teenSignedIn()
    const view = await session.read()

    expect(await session.screenshot()).not.toBeNull()
    expectOk(await session.execute({ type: 'click', ref: find(view, 'button', 'Follow').ref }))

    await vi.waitFor(() => expect(world.social.state().follows).toHaveLength(1))
  })

  it('never puts the password in a thrown error, a returned detail or console.error', async () => {
    const session = await pool.open(world.teen.id)
    const view = await session.read()
    const insertText = session.page.keyboard.insertText.bind(session.page.keyboard)
    vi.spyOn(session.page.keyboard, 'insertText').mockImplementation(async (text) => {
      if (text === TEEN_PASSWORD) throw new Error(`insertText failed for ${text}`)
      return insertText(text)
    })
    const errorSpy = vi.spyOn(console, 'error')

    const result = await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: 'Teen 15', field: 'password' })

    expect(result).toEqual({ ok: false, detail: 'Filling the password of Teen 15 failed.' })
    expect(JSON.stringify(result)).not.toContain(TEEN_PASSWORD)
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(TEEN_PASSWORD)
  })

  it('a failed action of another kind does not log what was typed either', async () => {
    const session = await pool.open(world.teen.id)
    const view = await session.read()
    vi.spyOn(session.page.keyboard, 'insertText').mockRejectedValue(new Error(`boom ${TEEN_PASSWORD}`))
    const errorSpy = vi.spyOn(console, 'error')

    const result = await session.execute({ type: 'type', ref: find(view, 'textbox', 'Username').ref, text: TEEN_PASSWORD })

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(TEEN_PASSWORD)
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(TEEN_PASSWORD)
  })

  it('a password saved under another key gives "can\'t be read. Enter it again." and no crash', async () => {
    await pool.closeAll()
    pool = poolWith({ secretKey: randomBytes(32) })
    const session = await pool.open(world.teen.id)
    const view = await session.read()

    const result = await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: 'Teen 15', field: 'password' })

    expect(result).toEqual({ ok: false, detail: "The saved password of Teen 15 can't be read. Enter it again." })
    expect(await session.page.inputValue('#password')).toBe('')
  })

  it('fill_credential refuses another account\'s label and types nothing', async () => {
    const session = await pool.open(world.teen.id)
    const view = await session.read()

    const result = await session.execute({ type: 'fill_credential', ref: find(view, 'textbox', 'Password').ref, account: 'Adult 30', field: 'password' })

    expect(result.ok).toBe(false)
    expect(await session.page.inputValue('#password')).toBe('')
  })

  it('currentUrl never shows a token in the address', async () => {
    const session = await pool.open(world.teen.id)
    await session.gotoInApp(`${world.social.url}/login?token=abc&password=${TEEN_PASSWORD}`)

    expect(session.currentUrl()).not.toContain('abc')
    expect(session.currentUrl()).not.toContain(TEEN_PASSWORD)
  })
})

describe('ending', () => {
  it('aborting the signal closes every session', async () => {
    const teen = await pool.open(world.teen.id)
    const adult = await pool.open(world.adult.id)

    world.abort.abort()

    await vi.waitFor(() => {
      expect(teen.page.isClosed()).toBe(true)
      expect(adult.page.isClosed()).toBe(true)
    })
  })

  it('closeAll closes the sessions and forgets them', async () => {
    const teen = await pool.open(world.teen.id)

    await pool.closeAll()

    expect(teen.page.isClosed()).toBe(true)
    expect(pool.get(world.teen.id)).toBeNull()
  })
})
