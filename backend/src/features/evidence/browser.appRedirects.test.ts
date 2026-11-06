import type { Browser, Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { html, quietLogUnlessTestFails, startPageServer, TEST_PAGE_TIMEOUT_MS, TEST_TIMEOUT_MS, type PageServer } from './__fixtures__/pages.js'
import { closeBrowser, createGuardedContext, getBrowser, gotoGuarded, type GuardedContext } from './browser.js'
import { MAX_REDIRECT_HOPS } from './config.js'
import { createUrlGuard, type UrlGuard } from './urlGuard.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

let browser: Browser
let app: PageServer
let other: PageServer
let opened: GuardedContext | null = null

const found = (res: import('node:http').ServerResponse, location: string) => {
  res.writeHead(302, { location })
  res.end()
}

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  quietLogUnlessTestFails()
  other = await startPageServer({ '/landing': html('Elsewhere', '<p>Another site.</p>') })
  app = await startPageServer({
    '/start': html(
      'Start',
      `<form method="post" action="/post"><button id="go">Go</button></form>
      <a id="out" href="/out">Out</a> <a id="loop" href="/r?n=0">Loop</a>`,
    ),
    '/post': (res) => found(res, '/mid'),
    '/mid': (res) => found(res, '/final'),
    '/final': html('Final', '<p>Final page</p>'),
    '/out': (res) => found(res, `${other.url}/landing`),
    '/r': (res, req) => found(res, `/r?n=${Number(new URL(req.url ?? '', 'http://x').searchParams.get('n')) + 1}`),
  })
})

afterEach(async () => {
  await opened?.context.close()
  opened = null
  await app.close()
  await other.close()
  vi.restoreAllMocks()
})

async function openStart(contextGuard: UrlGuard, followPageRedirects: boolean, navigationGuard = contextGuard): Promise<Page> {
  opened = await createGuardedContext(browser, contextGuard, { followPageRedirects })
  const page = await opened.context.newPage()
  const navigation = await gotoGuarded(page, `${app.url}/start`, navigationGuard, TEST_PAGE_TIMEOUT_MS)
  expect(navigation.blockedReason).toBeNull()
  return page
}

describe('redirects on navigations the page starts itself', () => {
  it('in app mode, follows the chain hop by hop and lands on the final page, fetched once', async () => {
    const page = await openStart(app.guard('127.0.0.1'), true)

    await page.click('#go')
    await page.waitForURL(`${app.url}/final`)
    expect(await page.textContent('p')).toBe('Final page')
    expect(opened!.violations).toEqual([])
    expect([app.hits('/post'), app.hits('/mid'), app.hits('/final')]).toEqual([1, 1, 1])
  })

  it('in app mode, refuses a hop the navigation guard refuses, and requests nothing past it', async () => {
    const both = createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${app.port}`, `127.0.0.1:${other.port}`] })
    const page = await openStart(both, true, app.guard('127.0.0.1'))

    await page.click('#out')
    await expect.poll(() => opened!.violations).toContain(`${other.url}/landing`)
    expect(other.hits('/landing')).toBe(0)
    expect(page.url().startsWith(other.url)).toBe(false)
  })

  it('in app mode, refuses a hop the context guard refuses', async () => {
    const page = await openStart(app.guard('127.0.0.1'), true)

    await page.click('#out')
    await expect.poll(() => opened!.violations).toContain(`${other.url}/landing`)
    expect(other.hits('/landing')).toBe(0)
  })

  it(`in app mode, gives up after ${MAX_REDIRECT_HOPS} hops`, async () => {
    const page = await openStart(app.guard('127.0.0.1'), true)

    await page.click('#loop')
    await expect.poll(() => opened!.violations.length).toBeGreaterThan(0)
    expect(app.hits('/r')).toBe(MAX_REDIRECT_HOPS + 1)
    expect(page.url()).not.toContain('/r?')
  })

  it('outside app mode, as in Phase 1, refuses the redirect and requests nothing past it', async () => {
    const page = await openStart(app.guard('127.0.0.1'), false)

    await page.click('#go')
    await expect.poll(() => opened!.violations).toContain(`${app.url}/post`)
    expect(app.hits('/mid')).toBe(0)
    expect(page.url()).not.toBe(`${app.url}/final`)
  })
})
