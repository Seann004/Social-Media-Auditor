import type { Browser, Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { quietLogUnlessTestFails, TEST_PAGE_TIMEOUT_MS, TEST_TIMEOUT_MS } from '../../../fixtures/pages.js'
import { startSocialApp, type SocialApp } from '../../../fixtures/socialApp.js'
import { createAppGuard } from '../../../../src/features/evidence/appGuard.js'
import { outlineLines, readAppView } from '../../../../src/features/evidence/appRead.js'
import type { AppView } from '../../../../src/features/evidence/appTypes.js'
import { closeBrowser, createGuardedContext, getBrowser, gotoGuarded, type GuardedContext } from '../../../../src/features/evidence/browser.js'
import { createUrlGuard, type UrlGuard } from '../../../../src/features/evidence/urlGuard.js'

/** Icon menus name each icon in text only a screen reader reads (Mastodon's web app does). */
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
  opened = await createGuardedContext(browser, guard, { followPageRedirects: true })
  page = await opened.context.newPage()
})

afterEach(async () => {
  await opened.context.close()
  await social.close()
})

async function readIcons(): Promise<AppView> {
  const navigation = await gotoGuarded(page, `${social.url}/icons`, guard, TEST_PAGE_TIMEOUT_MS)
  expect(navigation.blockedReason).toBeNull()
  const read = await readAppView(page, null)
  await read.world.cdp.detach().catch(() => undefined)
  return read.view
}

describe('names in screen-reader text', () => {
  it('an icon link takes its name from the text a screen reader reads', async () => {
    const outline = outlineLines(await readIcons())

    expect(outline).toContain('link "Home"')
    expect(outline).toContain('link "Preferences"')
  })

  it('text hidden from everyone (display none, visibility hidden) still never names a control', async () => {
    const view = await readIcons()

    const buttons = view.elements.filter((el) => el.role === 'button').map((el) => el.name)
    expect(buttons).toEqual(['', ''])
  })

  it('screen-reader text outside a control stays out of the page text', async () => {
    const view = await readIcons()

    expect(view.text).toContain('Pick a section.')
    expect(view.text).not.toContain('AI agent')
  })
})
