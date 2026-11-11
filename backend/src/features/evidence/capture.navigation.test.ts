import dns from 'node:dns'
import type { ServerResponse } from 'node:http'
import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAll, html, startPageServer, type PageServer } from './__fixtures__/pages.js'
import { startFixtureSite, type FixtureSite } from './__fixtures__/site.js'
import { closeBrowser, createGuardedContext, getBrowser, gotoGuarded } from './browser.js'
import { createUrlGuard } from './urlGuard.js'

const redirect = (res: ServerResponse, location: string, status = 302) => {
  res.writeHead(status, { location })
  res.end()
}

/** Runs a script a moment after the page has loaded, so the first page has really arrived. */
const moveTo = (location: string) => `<script>setTimeout(() => { location.href = ${JSON.stringify(location)} }, 50)</script>`

let browser: Browser
let server: PageServer

const hostsSeen = () => new Set(server.requests().map((r) => r.host.split(':')[0]))

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  server = await startPageServer({
    '/robots.txt': (res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('User-agent: *\nDisallow: /deep/\n')
    },
    // An ordinary cookie gate: the first visit sets a cookie, the next is redirected.
    '/cookie-gate': (res, req) => {
      if (req.headers.cookie?.includes('seen=1')) return redirect(res, '/deep/dir/page')
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'seen=1; Path=/' })
      res.end(html('Gate', '<p>Gate words.</p>'))
    },
    '/deep/dir/page': html('Deep', '<p>Deep page words.</p><a href="sibling">sibling</a>'),
    '/deep/dir/sibling': html('Sibling', '<p>Sibling words.</p>'),
    '/start': html('Start', '<a href="/uir">uir</a>'),
    // Only a browser's headers trigger this redirect.
    '/uir': (res, req) => {
      if (req.headers['upgrade-insecure-requests']) return redirect(res, `http://localhost:${server.port}/other-site-page`, 307)
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(html('UIR', '<p>What a non-browser sees.</p>'))
    },
    '/other-site-page': html('Other site', '<p>Words from the other site.</p>'),
    '/old': (res) => redirect(res, '/new/dir/page'),
    '/new/dir/page': html('New', '<p>New page words.</p><a href="sibling">sibling</a>'),
    '/new/dir/sibling': html('Sibling', '<p>Sibling words.</p>'),
    '/sibling': (res) => {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end(html('Wrong place', '<p>The relative link resolved against the wrong url.</p>'))
    },
    '/plain': html('Plain', '<p>Plain words.</p>'),
    '/moves-to-refused': html('Moving', '<p>Words before moving.</p>', moveTo('/refused')),
    '/refused': (res) => {
      res.writeHead(403, { 'content-type': 'text/html' })
      res.end(html('Refused', '<p>This server refused the request with a 403.</p>'))
    },
    '/moves-to-broken': html('Moving', '<p>Words before moving.</p>', moveTo('/broken')),
    '/broken': (res) => {
      res.writeHead(500, { 'content-type': 'text/html' })
      res.end(html('Broken', '<p>Server error words.</p>'))
    },
    '/missing-moves-on': (res) => {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end(html('Missing', '<p>Not here.</p>', moveTo('/plain')))
    },
    '/pushes-state': html('Pushing', `<p>Same document.</p><script>history.pushState({}, '', '/elsewhere')</script>`),
    '/js-to-plain': html('Moving', '<p>Words before moving.</p>', moveTo('/plain')),
    '/js-to-redirect': html('Moving', '<p>Words before moving.</p>', moveTo('/old')),
    '/js-to-disallowed': html('Moving', '<p>Words before moving.</p>', moveTo('/deep/dir/page')),
    '/link-to-js-offsite': html('Start', '<a href="/js-offsite">go</a>'),
    '/js-offsite': (res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(html('Moving', '<p>Words before moving.</p>', moveTo(`http://localhost:${server.port}/other-site-page`)))
    },
    '/slow-document': (res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(html('Slow', '<p>Slow words.</p>'))
      }, 1_500)
    },
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await server.close()
})

describe('a document is fetched once', () => {
  it('sends the walk with the headers a browser navigation has, and does not fetch the document again', async () => {
    const pages = await captureAll({ browser, guard: server.guard('127.0.0.1'), startUrls: [`${server.url}/plain`] })
    const requests = server.requests().filter((r) => r.path === '/plain')

    expect(pages[0].accessStatus).toBe('ok')
    expect(requests).toHaveLength(1)
    expect(requests[0].headers['upgrade-insecure-requests']).toBe('1')
    expect(requests[0].headers['sec-fetch-mode']).toBe('navigate')
    expect(requests[0].headers['sec-fetch-dest']).toBe('document')
    expect(requests[0].headers.accept).toContain('text/html')
  })

  it('gives one page timeout to the document, not half of it to each of two fetches', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/slow-document`],
      limits: { pageTimeoutMs: 2_500 },
    })

    expect(pages[0].accessStatus).toBe('ok')
    expect(pages[0].text).toContain('Slow words.')
    expect(server.hits('/slow-document')).toBe(1)
  })

  it('stays with the cookie gate it was shown, and never requests the disallowed page behind it', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/cookie-gate`],
      respectRobots: true,
    })

    expect(pages[0]).toMatchObject({ accessStatus: 'ok', finalUrl: `${server.url}/cookie-gate` })
    expect(pages[0].text).toContain('Gate words.')
    expect(server.hits('/cookie-gate')).toBe(1)
    expect(server.hits('/deep/dir/page')).toBe(0)
  })

  it('records the real final url, and resolves relative links from it', async () => {
    const pages = await captureAll({ browser, guard: server.guard('127.0.0.1'), startUrls: [`${server.url}/old`] })

    expect(pages.map((p) => [p.url, p.finalUrl, p.accessStatus])).toEqual([
      [`${server.url}/old`, `${server.url}/new/dir/page`, 'ok'],
      [`${server.url}/new/dir/sibling`, `${server.url}/new/dir/sibling`, 'ok'],
    ])
    expect(server.hits('/sibling')).toBe(0)
  })

  it('applies the site scope to a redirect that only a browser navigation triggers', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1', 'localhost'),
      startUrls: [`${server.url}/start`],
    })

    expect(pages).toHaveLength(2)
    expect(pages[1]).toMatchObject({ accessStatus: 'blocked', text: '', screenshot: null })
    expect(pages[1].accessDetail).toMatch(/away from the site/i)
    expect(hostsSeen()).toEqual(new Set(['127.0.0.1']))
  })
})

describe('a navigation the page starts itself', () => {
  it('is followed when it does not redirect, and the final url is real', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/js-to-plain`],
      limits: { maxDepth: 0 },
    })

    expect(pages[0]).toMatchObject({ accessStatus: 'ok', finalUrl: `${server.url}/plain` })
    expect(pages[0].text).toContain('Plain words.')
  })

  it.each([
    ['/moves-to-refused', '/refused', 403, 'blocked', 'refused the request'],
    ['/moves-to-broken', '/broken', 500, 'error', 'Server error words.'],
    ['/missing-moves-on', '/plain', 200, 'ok', 'Plain words.'],
  ])('classifies %s from the document it ended on', async (path, finalPath, status, access, words) => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}${path}`],
      limits: { maxDepth: 0 },
    })

    expect(pages[0]).toMatchObject({ finalUrl: `${server.url}${finalPath}`, httpStatus: status, accessStatus: access })
    expect(pages[0].text).toContain(words)
  })

  it('keeps the status of the document when the url changes without a new one', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/pushes-state`],
      limits: { maxDepth: 0 },
    })

    expect(pages[0]).toMatchObject({ finalUrl: `${server.url}/elsewhere`, httpStatus: 200, accessStatus: 'ok' })
    expect(pages[0].text).toContain('Same document.')
  })

  it('is refused when it redirects, and the redirect is not followed', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/js-to-redirect`],
      limits: { maxDepth: 0 },
    })

    expect(pages[0]).toMatchObject({ accessStatus: 'blocked', text: '', screenshot: null })
    expect(server.hits('/old')).toBe(1)
    expect(server.hits('/new/dir/page')).toBe(0)
  })

  it('never requests a page robots.txt disallows', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/js-to-disallowed`],
      respectRobots: true,
      limits: { maxDepth: 0 },
    })

    expect(pages[0]).toMatchObject({ accessStatus: 'blocked', text: '', screenshot: null })
    expect(pages[0].accessDetail).toMatch(/robots\.txt/)
    expect(server.hits('/deep/dir/page')).toBe(0)
  })

  it('never requests another site from a followed link', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1', 'localhost'),
      startUrls: [`${server.url}/link-to-js-offsite`],
    })

    expect(pages[1]).toMatchObject({ accessStatus: 'blocked', text: '', screenshot: null })
    expect(hostsSeen()).toEqual(new Set(['127.0.0.1']))
  })
})

describe('a server that changes its answer', () => {
  let site: FixtureSite

  beforeEach(async () => {
    site = await startFixtureSite()
  })

  afterEach(async () => {
    await site.close()
  })

  const guardForSite = () => createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`] })

  it.each(['/flip-to-internal', '/flip-chain'])('gets no second request to change it in, under capturePages: %s', async (path) => {
    const pages = await captureAll({
      browser,
      guard: guardForSite(),
      startUrls: [`${site.url}${path}`],
      limits: { maxDepth: 0 },
    })

    expect(site.forbiddenHits()).toBe(0)
    expect(site.requests().filter((r) => r.path === path)).toHaveLength(1)
    expect(pages[0].accessStatus).toBe('ok')
    expect(pages[0].text).toContain('Harmless the first time.')
  })

  it.each(['/flip-to-internal', '/flip-chain'])('is refused at the route layer the second time: %s', async (path) => {
    const { context, violations } = await createGuardedContext(browser, guardForSite())
    try {
      const firstTab = await context.newPage()
      await firstTab.goto(`${site.url}${path}`)
      const secondTab = await context.newPage()

      await expect(secondTab.goto(`${site.url}${path}`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
      expect(site.forbiddenHits()).toBe(0)
      expect(violations).toContain(`${site.url}${path}`)
    } finally {
      await context.close()
    }
  })

  it('gotoGuarded on the same page twice uses the guard it was given last', async () => {
    const guard = guardForSite()
    const { context } = await createGuardedContext(browser, guard)
    try {
      const tab = await context.newPage()
      const first = await gotoGuarded(tab, `${site.url}/privacy`, guard, 5_000)
      const refusing = { check: async () => ({ allowed: false as const, reason: 'Refused by the test.' }) }
      const second = await gotoGuarded(tab, `${site.url}/help`, refusing, 5_000)

      expect(first.blockedReason).toBeNull()
      expect(second.blockedReason).toBe('Refused by the test.')
    } finally {
      await context.close()
    }
  })
})

describe('address order', () => {
  it('prefers IPv4, so a network with broken IPv6 does not use up the page timeout', () => {
    expect(dns.getDefaultResultOrder()).toBe('ipv4first')
  })
})
