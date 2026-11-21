import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import dns from 'node:dns'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { quietLogUnlessTestFails, TEST_PAGE_TIMEOUT_MS, TEST_TIMEOUT_MS, withAlteredPages } from '../../../fixtures/pages.js'
import { startFixtureSite, unusedPort, type FixtureSite } from '../../../fixtures/site.js'
import { closeBrowser, createGuardedContext, getBrowser, gotoGuarded } from '../../../../src/features/evidence/browser.js'
import { capturePages, DEFAULT_CAPTURE_LIMITS, type CaptureLimits, type CapturedPageData } from '../../../../src/features/evidence/capture.js'
import { LINK_DEPTH, MAX_PAGES_PER_RUN, PAGE_TIMEOUT_MS, USER_AGENT } from '../../../../src/features/evidence/config.js'
import { createUrlGuard, type UrlGuard } from '../../../../src/features/evidence/urlGuard.js'

const FAST_TIMEOUT_MS = 1_500

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const never = new AbortController().signal

let browser: Browser
let site: FixtureSite
let guard: UrlGuard

interface CaptureOverrides {
  respectRobots?: boolean
  limits?: Partial<CaptureLimits>
  signal?: AbortSignal
  guard?: UrlGuard
  browser?: Browser
}

async function capture(startUrls: string[], overrides: CaptureOverrides = {}): Promise<CapturedPageData[]> {
  const pages: CapturedPageData[] = []
  await capturePages({
    browser: overrides.browser ?? browser,
    guard: overrides.guard ?? guard,
    startUrls,
    respectRobots: overrides.respectRobots ?? false,
    signal: overrides.signal ?? never,
    limits: { pageTimeoutMs: TEST_PAGE_TIMEOUT_MS, ...overrides.limits },
    onPage: async (page) => {
      pages.push(page)
    },
  })
  return pages
}

async function captureOne(path: string, overrides: CaptureOverrides = {}): Promise<CapturedPageData> {
  const pages = await capture([`${site.url}${path}`], { ...overrides, limits: { maxDepth: 0, ...overrides.limits } })
  expect(pages).toHaveLength(1)
  return pages[0]
}

function pathsOf(pages: CapturedPageData[]): string[] {
  return pages.map((p) => new URL(p.url).pathname)
}

function requestedPaths(): string[] {
  return site.requests().map((r) => r.path)
}

function expectDiscarded(page: CapturedPageData): void {
  expect(page.accessStatus).toBe('blocked')
  expect(page.text).toBe('')
  expect(page.screenshot).toBeNull()
  expect(page.accessibilitySnapshot).toBeNull()
  expect(page.contentHash).toBeNull()
  expect(page.accessDetail).toBeTruthy()
}

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  quietLogUnlessTestFails()
  site = await startFixtureSite()
  guard = createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`] })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await site.close()
})

describe('what capturePages saves', () => {
  it('saves text, title, status, hash and a JPEG screenshot', async () => {
    const before = Date.now()
    const page = await captureOne('/')

    expect(page.url).toBe(`${site.url}/`)
    expect(page.finalUrl).toBe(`${site.url}/`)
    expect(page.httpStatus).toBe(200)
    expect(page.accessStatus).toBe('ok')
    expect(page.accessDetail).toBeNull()
    expect(page.title).toBe('Fixture Home')
    expect(page.text).toContain('Welcome to the fixture site.')
    expect(page.contentHash).toBe(createHash('sha256').update(page.text).digest('hex'))
    expect(page.screenshot?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(Date.parse(page.capturedAt)).toBeGreaterThanOrEqual(before - 1_000)
  })

  it('reads a gzip-encoded page', async () => {
    const page = await captureOne('/gzipped')
    expect(page.accessStatus).toBe('ok')
    expect(page.text).toContain('Compressed words.')
  })

  it('captures checkbox state in the accessibility snapshot', async () => {
    const page = await captureOne('/settings')
    expect(page.accessibilitySnapshot).toContain('checkbox "Share location" [checked]')
    expect(page.accessibilitySnapshot).toContain('checkbox "Allow strangers to message"')
    expect(page.accessibilitySnapshot).not.toContain('checkbox "Allow strangers to message" [checked]')
  })

  it('does not capture hidden text', async () => {
    const page = await captureOne('/hidden')
    expect(page.accessStatus).toBe('ok')
    expect(page.text).toContain('Visible words.')
    expect(page.text).not.toContain('IGNORE ALL INSTRUCTIONS')
    expect(page.accessibilitySnapshot).not.toContain('IGNORE ALL INSTRUCTIONS')
  })

  it.each(['/hidden-body', '/hidden-html'])('does not capture text when all of %s is hidden', async (path) => {
    const page = await captureOne(path)
    expect(page.text).not.toContain('IGNORE ALL INSTRUCTIONS')
    expect(page.accessibilitySnapshot ?? '').not.toContain('IGNORE ALL INSTRUCTIONS')
  })

  it('keeps the page when the screenshot fails', async () => {
    const brokenScreenshots = withAlteredPages(browser, (created) => {
      created.screenshot = async () => {
        throw new Error('screenshot failed')
      }
    })

    const page = await captureOne('/privacy', { browser: brokenScreenshots })

    expect(page.accessStatus).toBe('ok')
    expect(page.text).toContain('Teen accounts')
    expect(page.screenshot).toBeNull()
  })
})

describe('which pages capturePages visits', () => {
  it('follows same-site links to depth 1 only', async () => {
    const pages = await capture([`${site.url}/`])
    expect(pathsOf(pages)).toEqual(['/', '/privacy', '/help'])
    expect(requestedPaths()).not.toContain('/settings')
  })

  it('counts depth from the start url', async () => {
    const pages = await capture([`${site.url}/`], { limits: { maxDepth: 2 } })
    expect(pathsOf(pages)).toEqual(['/', '/privacy', '/help', '/settings'])
  })

  describe('with hosts under a shared name', () => {
    const realLookup = dns.promises.lookup

    beforeEach(() => {
      // *.localhost does not resolve in Node on every platform. The fixture is on loopback either way.
      dns.promises.lookup = ((host: string, options: dns.LookupAllOptions) =>
        realLookup(host.endsWith('.localhost') ? '127.0.0.1' : host, options)) as typeof dns.promises.lookup
    })

    afterEach(() => {
      dns.promises.lookup = realLookup
    })

    /** Allows every name, so that only the same-site rule can keep a request away. */
    const allowingNames = () =>
      createUrlGuard({
        allowedPrivateHosts: [
          'site.localhost',
          'www.site.localhost',
          'docs.site.localhost',
          'notsite.localhost',
          'site.localhost.other.localhost',
          'other.localhost',
        ].map((name) => `${name}:${site.port}`),
      })

    it('treats www and subdomains as same site, and never leaves the site', async () => {
      const start = `http://www.site.localhost:${site.port}/site-links`
      const pages = await capture([start], { guard: allowingNames() })

      expect(pages.map((p) => p.url)).toEqual([
        start,
        `http://site.localhost:${site.port}/privacy`,
        `http://www.site.localhost:${site.port}/help`,
        `http://docs.site.localhost:${site.port}/settings`,
      ])
      expect(pages.every((p) => p.accessStatus === 'ok')).toBe(true)
      const hosts = new Set(site.requests().map((r) => r.host.split(':')[0]))
      expect([...hosts].sort()).toEqual(['docs.site.localhost', 'site.localhost', 'www.site.localhost'])
    })

    it('gives each start url its own site scope', async () => {
      const pages = await capture(
        [`http://site.localhost:${site.port}/site-links`, `http://other.localhost:${site.port}/privacy`],
        { guard: allowingNames() },
      )
      const urls = pages.map((p) => p.url)

      expect(urls).toContain(`http://other.localhost:${site.port}/settings`)
      expect(urls).not.toContain(`http://other.localhost:${site.port}/secret`)
    })
  })

  describe('when a redirect leaves the site', () => {
    const allowingLocalhost = () =>
      createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`, `localhost:${site.port}`] })

    it('accepts it for a start url, which the auditor chose', async () => {
      const pages = await capture([`${site.url}/redirect-offsite`], {
        guard: allowingLocalhost(),
        limits: { maxDepth: 0 },
      })
      expect(pages[0].accessStatus).toBe('ok')
      expect(pages[0].finalUrl).toBe(`http://localhost:${site.port}/help`)
    })

    it('refuses it for a followed link, and sends nothing to the other site', async () => {
      const pages = await capture([`${site.url}/link-to/redirect-offsite`], { guard: allowingLocalhost() })

      expect(pages).toHaveLength(2)
      expectDiscarded(pages[1])
      expect(pages[1].accessDetail).toMatch(/away from the site/i)
      expect(site.requests().filter((r) => r.host.startsWith('localhost'))).toEqual([])
    })
  })

  it('stops at maxPages on /many and does not visit a url twice', async () => {
    const pages = await capture([`${site.url}/many`], { limits: { maxPages: 5 } })
    const urls = pages.map((p) => p.url)

    expect(new Set(urls).size).toBe(5)
    expect(urls).toHaveLength(5)
    expect(pathsOf(pages)).toEqual(['/many', '/many/0', '/many/1', '/many/2', '/many/3'])
    expect(urls.some((u) => u.includes('#'))).toBe(false)
  })

  it('captures every start url before any link, and each only once', async () => {
    const pages = await capture([`${site.url}/`, `${site.url}/#again`, `${site.url}/settings`], { limits: { maxPages: 2 } })
    expect(pathsOf(pages)).toEqual(['/', '/settings'])
  })

  it('defaults the limits to the config values', () => {
    expect(DEFAULT_CAPTURE_LIMITS).toEqual({
      maxPages: MAX_PAGES_PER_RUN,
      maxDepth: LINK_DEPTH,
      pageTimeoutMs: PAGE_TIMEOUT_MS,
    })
  })

  it.each(['/login-wall', '/captcha', '/error500'])('follows no links from %s', async (path) => {
    const pages = await capture([`${site.url}${path}`])
    expect(pages).toHaveLength(1)
    expect(requestedPaths()).not.toContain('/help')
  })
})

describe('pages that cannot be used', () => {
  it('marks login_required, blocked, error and timeout pages without aborting the run', async () => {
    const pages = await capture(
      ['/login-wall', '/captcha', '/error500', '/slow', '/privacy'].map((p) => `${site.url}${p}`),
      { limits: { maxDepth: 0, pageTimeoutMs: FAST_TIMEOUT_MS } },
    )

    expect(pages.map((p) => [new URL(p.url).pathname, p.accessStatus])).toEqual([
      ['/login-wall', 'login_required'],
      ['/captcha', 'blocked'],
      ['/error500', 'error'],
      ['/slow', 'timeout'],
      ['/privacy', 'ok'],
    ])
    expect(pages[2].httpStatus).toBe(500)
    expect(pages[3].text).toBe('')
    expect(pages[3].screenshot).toBeNull()
  })

  it('marks a page that hangs the browser after loading as timeout, and carries on', async () => {
    const pages = await capture([`${site.url}/busy`, `${site.url}/privacy`], {
      limits: { maxDepth: 0, pageTimeoutMs: FAST_TIMEOUT_MS },
    })
    expect(pages.map((p) => p.accessStatus)).toEqual(['timeout', 'ok'])
    expect(pages[0].text).toBe('')
  })

  it('marks a download as error, and saves nothing', async () => {
    const pages = await capture([`${site.url}/download`, `${site.url}/privacy`], { limits: { maxDepth: 0 } })
    expect(pages.map((p) => p.accessStatus)).toEqual(['error', 'ok'])
    expect(pages[0].text).toBe('')
  })

  it('marks a site that cannot be reached as error', async () => {
    const closedPort = await unusedPort()
    const pages = await capture([`http://127.0.0.1:${closedPort}/`], {
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${closedPort}`] }),
    })
    expect(pages[0].accessStatus).toBe('error')
    expect(pages[0].text).toBe('')
  })

  it.each(['http://169.254.169.254/latest/meta-data/', 'file:///C:/Windows/win.ini', 'not a url'])(
    'marks the start url %s blocked',
    async (url) => {
      const pages = await capture([url])
      expect(pages).toHaveLength(1)
      expect(pages[0].url).toBe(url)
      expectDiscarded(pages[0])
    },
  )
})

describe('the redirect defence', () => {
  describe('controls: the fixtures really do reach the internal address when unguarded', () => {
    let plain: Browser

    beforeAll(async () => {
      plain = await chromium.launch()
    })

    afterAll(async () => {
      await plain.close()
    })

    it.each(['/redirect-internal', '/redirect-chain', '/image-redirect', '/image-chain'])(
      'a plain route check does not stop %s',
      async (path) => {
        const context = await plain.newContext()
        try {
          await context.route('**/*', async (route) => {
            if (route.request().url().startsWith(site.internalUrl)) await route.abort()
            else await route.continue()
          })
          const page = await context.newPage()
          await page.goto(`${site.url}${path}`, { waitUntil: 'networkidle' })

          expect(site.forbiddenHits()).toBeGreaterThan(0)
        } finally {
          await context.close()
        }
      },
    )

    it('handing a checked redirect back to the browser does not stop /redirect-chain', async () => {
      const context = await plain.newContext()
      try {
        await context.route('**/*', async (route) => {
          await route.fulfill({ response: await route.fetch({ maxRedirects: 0 }) })
        })
        const page = await context.newPage()
        await page.goto(`${site.url}/redirect-chain`)

        expect(site.forbiddenHits()).toBeGreaterThan(0)
      } finally {
        await context.close()
      }
    })

    it('route interception alone does not stop the tricks page', async () => {
      const context = await plain.newContext()
      try {
        await context.route('**/*', async (route) => {
          if (route.request().url().startsWith(site.internalUrl)) await route.abort()
          else await route.continue()
        })
        const page = await context.newPage()
        await page.goto(`${site.url}/tricks`, { waitUntil: 'commit' })

        await expect.poll(() => site.forbiddenHits(), { timeout: 5_000 }).toBeGreaterThan(0)
      } finally {
        await context.close()
      }
    })

    it('the guard is what stops it: allow the address and the same redirect gets through', async () => {
      const internalPort = new URL(site.internalUrl).port
      const allowed = createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`, `127.0.0.1:${internalPort}`] })
      const page = await captureOne('/redirect-chain', { guard: allowed })

      expect(site.forbiddenHits()).toBeGreaterThan(0)
      expect(page.accessStatus).toBe('ok')
    })
  })

  it.each(['/redirect-internal', '/redirect-chain'])(
    'never reaches an internal address through a redirect: %s',
    async (path) => {
      const page = await captureOne(path)

      expect(site.forbiddenHits()).toBe(0)
      expect(page.accessStatus).toBe('blocked')
      expect(page.text).toBe('')
      expect(page.screenshot).toBeNull()
      expectDiscarded(page)
      expect(JSON.stringify({ ...page, screenshot: null })).not.toContain(site.internalUrl)
    },
  )

  it('never reaches an internal address when a followed link redirects there', async () => {
    const pages = await capture([`${site.url}/link-to/redirect-chain`])

    expect(site.forbiddenHits()).toBe(0)
    expect(pages[0].accessStatus).toBe('ok')
    expectDiscarded(pages[1])
  })

  it.each(['/image-redirect', '/image-chain'])(
    'never reaches an internal address through a sub-resource redirect: %s',
    async (path) => {
      const page = await captureOne(path)

      expect(site.forbiddenHits()).toBe(0)
      expect(page.accessStatus).toBe('ok')
      expect(page.text).toContain('Page with a bad image')
      expect(page.screenshot).not.toBeNull()
    },
  )

  it('holds at the route layer alone, without the walk in gotoGuarded', async () => {
    const { context, violations } = await createGuardedContext(browser, guard)
    try {
      const refusedTab = await context.newPage()
      await expect(refusedTab.goto(`${site.url}/redirect-chain`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
      const imageTab = await context.newPage()
      await imageTab.goto(`${site.url}/image-chain`, { waitUntil: 'networkidle' })

      expect(site.forbiddenHits()).toBe(0)
      expect(violations).toContain(`${site.internalUrl}/metadata`)
    } finally {
      await context.close()
    }
  })

  it('records a directly refused url in violations', async () => {
    const { context, violations } = await createGuardedContext(browser, guard)
    try {
      const page = await context.newPage()
      await expect(page.goto(`${site.internalUrl}/direct`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)

      await expect.poll(() => violations).toContain(`${site.internalUrl}/direct`)
      expect(site.forbiddenHits()).toBe(0)
    } finally {
      await context.close()
    }
  })

  it('aborts other schemes at the route layer, and lets data: and blob: through', async () => {
    const { context, violations } = await createGuardedContext(browser, guard)
    try {
      const fileTab = await context.newPage()
      await expect(fileTab.goto('file:///C:/Windows/win.ini')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
      await expect.poll(() => violations).toContain('file:///C:/Windows/win.ini')

      const tab = await context.newPage()
      await tab.goto(`${site.url}/local-schemes`, { waitUntil: 'networkidle' })
      expect(await tab.evaluate('document.getElementById("from-data").naturalWidth')).toBe(1)
      expect(await tab.evaluate('document.getElementById("from-blob").naturalWidth')).toBe(1)
      expect(violations.filter((url) => url.startsWith('data:') || url.startsWith('blob:'))).toEqual([])
    } finally {
      await context.close()
    }
  })

  it('blocks service workers, whose requests a route handler would not see', async () => {
    const { context } = await createGuardedContext(browser, guard)
    try {
      const tab = await context.newPage()
      await tab.goto(`${site.url}/privacy`)
      await tab.evaluate(`navigator.serviceWorker.register('/ws-worker.js').catch(() => undefined)`)

      expect(await tab.evaluate('navigator.serviceWorker.getRegistrations().then((all) => all.length)')).toBe(0)
      expect(context.serviceWorkers()).toEqual([])
    } finally {
      await context.close()
    }
  })

  it('still follows a harmless redirect, for pages and for sub-resources', async () => {
    const page = await captureOne('/redirect-ok')
    expect(page.url).toBe(`${site.url}/redirect-ok`)
    expect(page.finalUrl).toBe(`${site.url}/privacy`)
    expect(page.accessStatus).toBe('ok')
    expect(page.text).toContain('Teen accounts')

    const { context } = await createGuardedContext(browser, guard)
    try {
      const tab = await context.newPage()
      await tab.goto(`${site.url}/image-redirect-ok`, { waitUntil: 'networkidle' })
      expect(await tab.evaluate('document.getElementById("good").naturalWidth')).toBe(1)
    } finally {
      await context.close()
    }
  })

  it('follows five redirects and refuses a sixth', async () => {
    expect((await captureOne('/hops/5')).accessStatus).toBe('ok')

    const refused = await captureOne('/hops/6')
    expectDiscarded(refused)
    expect(refused.accessDetail).toMatch(/redirect/i)
  })

  it('refuses a redirect to a non-http scheme', async () => {
    const page = await captureOne('/redirect-file')
    expectDiscarded(page)
    expect(page.accessDetail).toMatch(/file:/)
  })

  it.each(['/meta-refresh-internal', '/meta-refresh-chain', '/js-redirect-internal'])(
    'discards a page that moves itself to an internal address: %s',
    async (path) => {
      const page = await captureOne(path)

      expect(site.forbiddenHits()).toBe(0)
      expectDiscarded(page)
    },
  )

  it('never reaches an internal address through any channel a page can open', async () => {
    const page = await captureOne('/tricks')
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    expect(site.forbiddenHits()).toBe(0)
    expect(page.accessStatus).toBe('ok')
    expect(page.text).toContain('Tricks page text.')
  })
})

describe('gotoGuarded', () => {
  async function inTab<T>(run: (tab: Page) => Promise<T>): Promise<T> {
    const { context } = await createGuardedContext(browser, guard)
    try {
      return await run(await context.newPage())
    } finally {
      await context.close()
    }
  }

  it('returns the response and final url after a harmless redirect', async () => {
    const result = await inTab((tab) => gotoGuarded(tab, `${site.url}/redirect-ok`, guard, FAST_TIMEOUT_MS))

    expect(result.blockedReason).toBeNull()
    expect(result.finalUrl).toBe(`${site.url}/privacy`)
    expect(result.response?.status()).toBe(200)
  })

  it.each(['/redirect-internal', '/redirect-chain'])(
    'refuses %s and does not report the internal url as the final url',
    async (path) => {
      const result = await inTab((tab) => gotoGuarded(tab, `${site.url}${path}`, guard, FAST_TIMEOUT_MS))

      expect(result.blockedReason).toBeTruthy()
      expect(result.response).toBeNull()
      expect(result.finalUrl).not.toContain(site.internalUrl)
      expect(site.forbiddenHits()).toBe(0)
    },
  )

  it('refuses a blocked url without sending anything', async () => {
    const result = await inTab((tab) => gotoGuarded(tab, `${site.internalUrl}/direct`, guard, FAST_TIMEOUT_MS))

    expect(result.blockedReason).toBeTruthy()
    expect(site.forbiddenHits()).toBe(0)
  })

  it('throws for a page that never answers', async () => {
    await expect(inTab((tab) => gotoGuarded(tab, `${site.url}/slow`, guard, 500))).rejects.toThrow(/time/i)
  })
})

describe('robots.txt', () => {
  it('marks robots-disallowed pages blocked with the reason, and skips the rule when respectRobots is false', async () => {
    const blocked = await captureOne('/secret', { respectRobots: true })
    expectDiscarded(blocked)
    expect(blocked.accessDetail).toMatch(/robots\.txt/)
    expect(requestedPaths()).not.toContain('/secret')

    const allowed = await captureOne('/secret', { respectRobots: false })
    expect(allowed.accessStatus).toBe('ok')
    expect(allowed.text).toContain('Secret words.')
  })

  it('applies to followed links, and to where a redirect lands, before anything is requested', async () => {
    const pages = await capture([`${site.url}/link-to/secret`], { respectRobots: true })
    expect(pages[0].accessStatus).toBe('ok')
    expectDiscarded(pages[1])
    expect(pages[1].accessDetail).toMatch(/robots\.txt/)

    const landed = await captureOne('/redirect-secret', { respectRobots: true })
    expectDiscarded(landed)
    expect(landed.accessDetail).toMatch(/robots\.txt/)
    expect(requestedPaths()).not.toContain('/secret')
  })

  it('allows pages robots.txt does not mention, and reads it once per site', async () => {
    const pages = await capture([`${site.url}/`], { respectRobots: true })

    expect(pages.map((p) => p.accessStatus)).toEqual(['ok', 'ok', 'ok'])
    expect(requestedPaths().filter((path) => path === '/robots.txt')).toHaveLength(1)
  })
})

describe('how a run behaves', () => {
  it('sends the SafetyAuditEvidenceBot user agent', async () => {
    await captureOne('/', { respectRobots: true })
    const requests = site.requests()

    expect(requests.map((r) => r.path)).toEqual(expect.arrayContaining(['/robots.txt', '/', '/pixel.gif']))
    expect(new Set(requests.map((r) => r.userAgent))).toEqual(new Set(['SafetyAuditEvidenceBot/1.0']))
  })

  it('uses a separate context per call, so cookies do not carry over', async () => {
    const firstRun = await capture([`${site.url}/set-cookie`, `${site.url}/echo-cookie`], { limits: { maxDepth: 0 } })
    expect(firstRun[1].text).toContain('Cookie: visited=yes.')

    const secondRun = await captureOne('/echo-cookie')
    expect(secondRun.text).toContain('Cookie: none.')
  })

  it('stops promptly when the signal aborts', async () => {
    const controller = new AbortController()
    const started = Date.now()
    setTimeout(() => controller.abort(), 300)

    const pages = await capture([`${site.url}/slow`, `${site.url}/privacy`], { signal: controller.signal })

    expect(Date.now() - started).toBeLessThan(3_000)
    expect(pages).toEqual([])
    expect(requestedPaths()).not.toContain('/privacy')
    expect(browser.contexts()).toEqual([])
  })

  it('stops promptly when the signal aborts while robots.txt is being read', async () => {
    const controller = new AbortController()
    const silent = createServer(() => undefined)
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()))
    const { port } = silent.address() as AddressInfo
    const started = Date.now()
    setTimeout(() => controller.abort(), 300)

    try {
      const pages = await capture([`http://127.0.0.1:${port}/page`], {
        respectRobots: true,
        signal: controller.signal,
        guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${port}`] }),
      })

      expect(pages).toEqual([])
      expect(Date.now() - started).toBeLessThan(3_000)
    } finally {
      silent.closeAllConnections()
      silent.close()
    }
  })

  it('does nothing when the signal has already aborted', async () => {
    const pages = await capture([`${site.url}/`], { signal: AbortSignal.abort() })

    expect(pages).toEqual([])
    expect(site.requests()).toEqual([])
  })

  it('closes its context when it finishes, and when onPage throws', async () => {
    await captureOne('/privacy')
    expect(browser.contexts()).toEqual([])

    await expect(
      capturePages({
        browser,
        guard,
        startUrls: [`${site.url}/privacy`],
        respectRobots: false,
        signal: never,
        onPage: async () => {
          throw new Error('could not save')
        },
      }),
    ).rejects.toThrow('could not save')
    expect(browser.contexts()).toEqual([])
  })
})

describe('getBrowser', () => {
  const realEndpoint = process.env.BROWSER_WS_ENDPOINT

  afterEach(async () => {
    if (realEndpoint === undefined) delete process.env.BROWSER_WS_ENDPOINT
    else process.env.BROWSER_WS_ENDPOINT = realEndpoint
    await closeBrowser()
    browser = await getBrowser()
  })

  it('shares one instance', async () => {
    expect(await getBrowser()).toBe(await getBrowser())
  })

  it('relaunches after a disconnect', async () => {
    const first = await getBrowser()
    await first.close()

    const second = await getBrowser()

    expect(second).not.toBe(first)
    expect(second.isConnected()).toBe(true)
  })

  it('reads BROWSER_WS_ENDPOINT when called, and does not cache a failure', async () => {
    await closeBrowser()
    process.env.BROWSER_WS_ENDPOINT = `http://127.0.0.1:${await unusedPort()}`
    await expect(getBrowser()).rejects.toThrow()

    delete process.env.BROWSER_WS_ENDPOINT
    expect((await getBrowser()).isConnected()).toBe(true)
  })

  it('connects over CDP when BROWSER_WS_ENDPOINT is set, and a capture works through it', async () => {
    await closeBrowser()
    const debugPort = await unusedPort()
    const remote = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] })
    try {
      process.env.BROWSER_WS_ENDPOINT = `http://127.0.0.1:${debugPort}`
      const connected = await getBrowser()
      expect(connected).not.toBe(remote)

      expectDiscarded(await captureOne('/redirect-chain', { browser: connected }))
      expect((await captureOne('/privacy', { browser: connected })).accessStatus).toBe('ok')
      expect(site.forbiddenHits()).toBe(0)

      await closeBrowser()
      expect(remote.isConnected()).toBe(true)
    } finally {
      await remote.close()
    }
  })
})

describe('code sent to the page', () => {
  it('runs under tsx, where esbuild keepNames can break it', async () => {
    const script = fileURLToPath(new URL('../../../fixtures/captureUnderTsx.ts', import.meta.url))
    const backendDir = fileURLToPath(new URL('../../../../', import.meta.url))

    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', script], { cwd: backendDir })
    const pages = JSON.parse(stdout) as {
      url: string
      accessStatus: string
      title: string
      text: string
      accessibilitySnapshot: string
      hasScreenshot: boolean
    }[]

    expect(pages).toHaveLength(3)
    expect(pages[0]).toMatchObject({ accessStatus: 'ok', title: 'Fixture Home', hasScreenshot: true })
    expect(pages[0].text).toContain('Welcome to the fixture site.')
    expect(pages[1].accessibilitySnapshot).toContain('checkbox "Share location" [checked]')
    // The third page can only come from a link read out of the first page.
    expect(new URL(pages[2].url).pathname).toBe('/privacy')
  }, 60_000)
})
