import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFixtureSite, unusedPort, type FixtureSite } from '../../../fixtures/site.js'
import { closeBrowser, getBrowser } from '../../../../src/features/evidence/browser.js'
import { capturePages, type CapturedPageData } from '../../../../src/features/evidence/capture.js'
import { USER_AGENT } from '../../../../src/features/evidence/config.js'
import { createRobotsChecker } from '../../../../src/features/evidence/robots.js'
import { createUrlGuard, type UrlGuard } from '../../../../src/features/evidence/urlGuard.js'

let site: FixtureSite
let guard: UrlGuard

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  site = await startFixtureSite()
  guard = createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`] })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await site.close()
})

afterAll(async () => {
  await closeBrowser()
})

describe('createRobotsChecker', () => {
  const servers: Server[] = []

  async function stub(listener: RequestListener): Promise<{ url: string; port: number }> {
    const server = createServer(listener)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo
    return { url: `http://127.0.0.1:${port}`, port }
  }

  const allowing = (...ports: number[]) => createUrlGuard({ allowedPrivateHosts: ports.map((p) => `127.0.0.1:${p}`) })

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections()
        return new Promise((resolve) => server.close(resolve))
      }),
    )
  })

  it('treats robots.txt 404 as allowed and 500 or unreachable as disallowed', async () => {
    const respondWith = (code: number) => stub((_req, res) => res.writeHead(code).end())
    const missing = await respondWith(404)
    const broken = await respondWith(500)
    const closedPort = await unusedPort()
    const check = (origin: string, port: number) => createRobotsChecker(allowing(port)).isAllowed(`${origin}/page`)

    expect(await check(missing.url, missing.port)).toEqual({ allowed: true, reason: null })

    const brokenResult = await check(broken.url, broken.port)
    expect(brokenResult.allowed).toBe(false)
    expect(brokenResult.reason).toMatch(/robots\.txt/)

    const unreachable = await check(`http://127.0.0.1:${closedPort}`, closedPort)
    expect(unreachable.allowed).toBe(false)
    expect(unreachable.reason).toMatch(/robots\.txt/)
  })

  it('treats any other refusal to serve robots.txt as disallowed', async () => {
    const forbidden = await stub((_req, res) => res.writeHead(403).end())
    const result = await createRobotsChecker(allowing(forbidden.port)).isAllowed(`${forbidden.url}/page`)
    expect(result.allowed).toBe(false)
  })

  it('checks the guard first and sends nothing to a refused host', async () => {
    const result = await createRobotsChecker(guard).isAllowed(`${site.internalUrl}/page`)

    expect(result.allowed).toBe(false)
    expect(site.forbiddenHits()).toBe(0)
  })

  it('follows one redirect when the guard allows it, and applies the rules to the original site', async () => {
    const target = await stub((_req, res) => res.end('User-agent: *\nDisallow: /private'))
    const origin = await stub((_req, res) => res.writeHead(302, { location: `${target.url}/robots.txt` }).end())
    const checker = createRobotsChecker(allowing(origin.port, target.port))

    expect((await checker.isAllowed(`${origin.url}/public`)).allowed).toBe(true)
    expect((await checker.isAllowed(`${origin.url}/private`)).allowed).toBe(false)
  })

  it('refuses a redirect the guard does not allow, without following it', async () => {
    const origin = await stub((_req, res) => res.writeHead(302, { location: `${site.internalUrl}/robots.txt` }).end())
    const result = await createRobotsChecker(allowing(origin.port)).isAllowed(`${origin.url}/page`)

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/robots\.txt/)
    expect(site.forbiddenHits()).toBe(0)
  })

  it('follows one hop only', async () => {
    const last = await stub((_req, res) => res.end('User-agent: *\nAllow: /'))
    const middle = await stub((_req, res) => res.writeHead(302, { location: `${last.url}/robots.txt` }).end())
    const first = await stub((_req, res) => res.writeHead(302, { location: `${middle.url}/robots.txt` }).end())
    const checker = createRobotsChecker(allowing(first.port, middle.port, last.port))

    expect((await checker.isAllowed(`${first.url}/page`)).allowed).toBe(false)
  })

  it('matches rules on the bot name, sends the user agent, and reads the file once', async () => {
    const agents: (string | undefined)[] = []
    const server = await stub((req, res) => {
      agents.push(req.headers['user-agent'])
      res.end('User-agent: SafetyAuditEvidenceBot\nDisallow: /no-bots\n\nUser-agent: *\nDisallow: /everyone-else\n')
    })
    const checker = createRobotsChecker(allowing(server.port))

    expect((await checker.isAllowed(`${server.url}/no-bots`)).allowed).toBe(false)
    expect((await checker.isAllowed(`${server.url}/everyone-else`)).allowed).toBe(true)
    expect(agents).toEqual([USER_AGENT])
  })

  it('uses the robots checker it is given, and does not read robots.txt itself', async () => {
    const paths: (string | undefined)[] = []
    const server = await stub((req, res) => {
      paths.push(req.url)
      res.end('User-agent: *\nAllow: /')
    })
    const asked: string[] = []
    const pages: CapturedPageData[] = []
    await capturePages({
      browser: await getBrowser(),
      guard: allowing(server.port),
      startUrls: [`${server.url}/page`],
      respectRobots: true,
      robots: {
        isAllowed: async (url) => {
          asked.push(url)
          return { allowed: false, reason: 'robots.txt does not allow this page.' }
        },
      },
      signal: new AbortController().signal,
      onPage: async (page) => {
        pages.push(page)
      },
    })

    expect(asked).toEqual([`${server.url}/page`])
    expect(pages[0]).toMatchObject({ accessStatus: 'blocked' })
    expect(paths).toEqual([])
  })

  it('stops a capture before it opens the page when robots.txt is broken', async () => {
    const paths: (string | undefined)[] = []
    const broken = await stub((req, res) => {
      paths.push(req.url)
      res.writeHead(500).end()
    })
    const pages: CapturedPageData[] = []
    await capturePages({
      browser: await getBrowser(),
      guard: allowing(broken.port),
      startUrls: [`${broken.url}/page`],
      respectRobots: true,
      signal: new AbortController().signal,
      onPage: async (page) => {
        pages.push(page)
      },
    })

    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ accessStatus: 'blocked', text: '', screenshot: null })
    expect(pages[0].accessDetail).toMatch(/robots\.txt/)
    expect(paths).toEqual(['/robots.txt'])
  })
})
