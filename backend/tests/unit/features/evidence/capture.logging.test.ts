import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { captureAll, html, startPageServer, withAlteredPages, type PageServer } from '../../../fixtures/pages.js'
import { unusedPort } from '../../../fixtures/site.js'
import { closeBrowser, getBrowser } from '../../../../src/features/evidence/browser.js'
import { logCaptureFailure } from '../../../../src/features/evidence/captureLog.js'
import { createRobotsChecker } from '../../../../src/features/evidence/robots.js'
import { createUrlGuard } from '../../../../src/features/evidence/urlGuard.js'

let browser: Browser
let server: PageServer
let logged: MockInstance<typeof console.error>

const logLines = () => logged.mock.calls.map((call) => call.map(String).join(' '))

const alteredBrowser = (alter: (page: Page) => void) => withAlteredPages(browser, alter)

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  server = await startPageServer({
    '/plain': html('Plain', '<p>Plain words.</p>'),
    '/broken-part': (res) => {
      const missing = 'http://127.0.0.1:1/part.js?token=part-secret'
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(html('Part', `<p>Words.</p><script src="${missing}"></script>`))
    },
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await server.close()
})

describe('failure causes are logged', () => {
  it('when a page cannot be captured, with its url and the cause', async () => {
    const port = await unusedPort()
    const url = `http://127.0.0.1:${port}/gone`

    await captureAll({ browser, guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${port}`] }), startUrls: [url] })

    expect(logLines().some((line) => line.includes(url) && /ECONNREFUSED/.test(line))).toBe(true)
  })

  it('when the screenshot fails', async () => {
    const pages = await captureAll({
      browser: alteredBrowser((page) => {
        page.screenshot = async () => {
          throw new Error('screenshot went wrong')
        }
      }),
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/plain`],
    })

    expect(pages[0].accessStatus).toBe('ok')
    expect(logLines().some((line) => line.includes('/plain') && line.includes('screenshot went wrong'))).toBe(true)
  })

  it('when the snapshot fails, and the page is kept', async () => {
    const pages = await captureAll({
      browser: alteredBrowser((page) => {
        page.ariaSnapshot = async () => {
          throw new Error('snapshot went wrong')
        }
      }),
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/plain`],
    })

    expect(pages[0]).toMatchObject({ accessStatus: 'ok', accessibilitySnapshot: null })
    expect(logLines().some((line) => line.includes('/plain') && line.includes('snapshot went wrong'))).toBe(true)
  })

  it('when reading the page fails on every page, which would otherwise look like a normal failure', async () => {
    const pages = await captureAll({
      browser: alteredBrowser((page) => {
        page.context().newCDPSession = async () => {
          throw new Error('read went wrong')
        }
      }),
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/plain`],
    })

    expect(pages[0].accessStatus).toBe('error')
    expect(logLines().some((line) => line.includes('/plain') && line.includes('read went wrong'))).toBe(true)
  })

  it('when a sub-resource fails', async () => {
    await captureAll({
      browser,
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${server.port}`, '127.0.0.1:1'] }),
      startUrls: [`${server.url}/broken-part`],
    })

    expect(logLines().some((line) => line.includes('/part.js'))).toBe(true)
  })

  it('when robots.txt cannot be fetched, without blaming the site for what it did not do', async () => {
    const port = await unusedPort()
    const result = await createRobotsChecker(createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${port}`] })).isAllowed(
      `http://127.0.0.1:${port}/page`,
    )

    expect(result.allowed).toBe(false)
    expect(result.reason).not.toMatch(/reached/)
    expect(logLines().some((line) => line.includes(`127.0.0.1:${port}/robots.txt`) && line.includes('ECONNREFUSED'))).toBe(true)
  })

  it('when the browser disconnects, which would otherwise look like a normal failure', async () => {
    const doomed = await chromium.launch()
    setTimeout(() => void doomed.close(), 300)
    server = await startPageServer({ '/silent': () => undefined })

    await captureAll({ browser: doomed, guard: server.guard('127.0.0.1'), startUrls: [`${server.url}/silent`] })

    expect(logLines().some((line) => /browser disconnected/.test(line) && line.includes('/silent'))).toBe(true)
  })

  it('never logs a query string, which can hold a token', async () => {
    const port = await unusedPort()
    await captureAll({
      browser,
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${port}`] }),
      startUrls: [`http://127.0.0.1:${port}/gone?token=page-secret`],
    })
    await captureAll({
      browser,
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${server.port}`, '127.0.0.1:1'] }),
      startUrls: [`${server.url}/broken-part`],
    })

    expect(logLines().length).toBeGreaterThan(0)
    expect(logLines().filter((line) => /page-secret|part-secret/.test(line))).toEqual([])
  })

  it.each([
    ['a query with a bracket in it', 'http://h.example/p?a=(b)&token=SECRET-VALUE', /SECRET/],
    ['a query with a quote in it', "http://h.example/p?a=b'&token=SECRET-VALUE", /SECRET/],
    ['a fragment', 'http://h.example/cb#access_token=SECRET-VALUE', /SECRET/],
    ['a password', 'http://user:SECRET-VALUE@h.example/p', /SECRET|user/],
    ['a password with an @ in it', 'http://user:SEC@RET-VALUE@h.example/p', /SEC|RET|user/],
  ])('strips %s, from the url and from the message', (_what, url, secret) => {
    logCaptureFailure('Sample', url, new Error(`page.goto: net::ERR_FAILED at ${url}\nCall log: ${url}`))

    expect(logLines()).toHaveLength(1)
    expect(logLines()[0]).toContain('h.example')
    expect(logLines()[0]).not.toMatch(secret)
  })

  it('stays quiet about a capture that was simply aborted', async () => {
    const controller = new AbortController()
    server = await startPageServer({ '/silent': () => undefined })
    setTimeout(() => controller.abort(), 300)

    await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/silent`],
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(logLines()).toEqual([])
  })
})
