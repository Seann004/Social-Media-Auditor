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
/** The method of every request that reached /final. */
let finalMethods: string[] = []

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
  finalMethods = []
  other = await startPageServer({ '/landing': html('Elsewhere', '<p>Another site.</p>') })
  app = await startPageServer({
    '/start': html(
      'Start',
      `<form method="post" action="/post"><button id="go">Go</button></form>
      <a id="out" href="/out">Out</a> <a id="loop" href="/r?n=0">Loop</a>`,
    ),
    '/post': (res) => found(res, '/mid'),
    '/mid': (res) => found(res, '/final'),
    '/final': (res, req) => {
      finalMethods = [...finalMethods, req.method ?? '']
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html('Final', `<p>Final page ${finalMethods.length}</p>`))
    },
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

async function openStart(
  contextGuard: UrlGuard,
  followPageRedirects: boolean,
  navigationGuard = contextGuard,
  arrivalTtlMs?: number,
): Promise<Page> {
  opened = await createGuardedContext(browser, contextGuard, { followPageRedirects, arrivalTtlMs })
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
    expect(await page.textContent('p')).toBe('Final page 1')
    expect(opened!.violations).toEqual([])
    expect([app.hits('/post'), app.hits('/mid'), app.hits('/final')]).toEqual([1, 1, 1])
  })

  /**
   * Follows the chain, but the test answers the browser's own navigation to /final itself, so the
   * response the walk fetched is left waiting, as if the page had gone somewhere else meanwhile.
   */
  async function leaveAnArrivalWaiting(page: Page): Promise<void> {
    let claimed = false
    await page.route(`${app.url}/final`, async (route) => {
      if (claimed) return route.fallback()
      claimed = true
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Answered by the test</p>' })
    })
    await page.click('#go')
    await expect.poll(() => claimed).toBe(true)
    await page.waitForLoadState('domcontentloaded')
    expect(finalMethods).toEqual(['GET'])
  }

  it('in app mode, serves a held response once only', async () => {
    const page = await openStart(app.guard('127.0.0.1'), true)

    await page.click('#go')
    await page.waitForURL(`${app.url}/final`)
    await page.evaluate(() => location.reload())
    await expect.poll(() => finalMethods).toEqual(['GET', 'GET'])
    await expect.poll(() => page.textContent('p')).toBe('Final page 2')
  })

  it('in app mode, never serves a held response to a POST', async () => {
    const page = await openStart(app.guard('127.0.0.1'), true)
    await leaveAnArrivalWaiting(page)

    await page.evaluate((target) => {
      const form = document.createElement('form')
      form.method = 'post'
      form.action = target
      document.body.append(form)
      form.submit()
    }, `${app.url}/final`)
    await expect.poll(() => finalMethods).toEqual(['GET', 'POST'])
    await expect.poll(() => page.textContent('p')).toBe('Final page 2')
  })

  it('in app mode, drops a held response that waited past its expiry', async () => {
    const page = await openStart(app.guard('127.0.0.1'), true, undefined, 200)
    await leaveAnArrivalWaiting(page)

    await new Promise((resolve) => setTimeout(resolve, 400))
    await page.evaluate((target) => {
      location.href = target
    }, `${app.url}/final`)
    await expect.poll(() => finalMethods).toEqual(['GET', 'GET'])
    await expect.poll(() => page.textContent('p')).toBe('Final page 2')
  })

  it('in app mode, still serves a held response to the GET it waits for, within its expiry', async () => {
    const page = await openStart(app.guard('127.0.0.1'), true)
    await leaveAnArrivalWaiting(page)

    await page.evaluate((target) => {
      location.href = target
    }, `${app.url}/final`)
    await expect.poll(() => page.textContent('p')).toBe('Final page 1')
    expect(finalMethods).toEqual(['GET'])
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
