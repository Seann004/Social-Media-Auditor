import net from 'node:net'
import { chromium, type Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAll, html, startPageServer, type PageServer } from './__fixtures__/pages.js'
import { closeBrowser, getBrowser, LOCKED_DOWN_BROWSER_ARGS } from './browser.js'
import { capturePages, type CapturedPageData } from './capture.js'
import { BROWSER_CLOSE_TIMEOUT_MS, MAX_RESPONSE_BYTES } from './config.js'

const MB = 1024 * 1024
const never = new AbortController().signal

let browser: Browser
let server: PageServer

const sendBytes = (bytes: number, contentType: string) => () => {
  const body = Buffer.alloc(bytes, 'x')
  return (res: import('node:http').ServerResponse) => {
    res.writeHead(200, { 'content-type': contentType })
    res.end(body)
  }
}

const pathsOf = (pages: CapturedPageData[]) => pages.map((p) => new URL(p.url).pathname)

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  server = await startPageServer({
    '/': html('Home', '<p>Home words.</p><a href="/report?id=1">annual report</a><a href="/after">after</a>'),
    '/report': sendBytes(120 * MB, 'application/pdf')(),
    '/big-page': sendBytes(MAX_RESPONSE_BYTES + 1, 'text/html')(),
    '/just-under': (res) => {
      const start = '<!doctype html><title>Under</title><p>Under the cap.</p><!--'
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`${start}${'x'.repeat(MAX_RESPONSE_BYTES - start.length - 3)}-->`)
    },
    '/big-file': sendBytes(MAX_RESPONSE_BYTES + 1, 'application/octet-stream')(),
    '/after': html('After', '<p>After words.</p>'),
    '/with-big-parts': html(
      'Parts',
      '<p>Words beside big parts.</p><img src="/big-file"><script src="/big-file"></script><img id="small" src="/after">',
    ),
    '/with-media': html('Media', '<p>Words beside media.</p><video src="/movie" autoplay></video><audio src="/song" autoplay></audio>'),
    '/movie': sendBytes(1024, 'video/mp4')(),
    '/song': sendBytes(1024, 'audio/mpeg')(),
    '/with-files': html(
      'Files',
      `<p>Links to files.</p>
      <a href="/report.pdf">pdf</a> <a href="/photo.JPG?size=large">jpg</a> <a href="/archive.zip#top">zip</a>
      <a href="/setup.exe">exe</a> <a href="/clip.mp4">mp4</a> <a href="/notes.docx">docx</a>
      <a href="/pdf-guide">a page with pdf in its name</a> <a href="/guide.html">html</a>`,
    ),
    '/pdf-guide': html('Guide', '<p>Guide.</p>'),
    '/guide.html': html('Guide', '<p>Guide.</p>'),
    '/slow': () => undefined,
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await server.close()
})

describe('response sizes', () => {
  it('survives a 120 MB file in the middle of a crawl', async () => {
    const pages = await captureAll({ browser, guard: server.guard('127.0.0.1'), startUrls: [`${server.url}/`] })

    expect(browser.isConnected()).toBe(true)
    expect(pathsOf(pages)).toEqual(['/', '/report', '/after'])
    expect(pages.map((p) => p.accessStatus)).toEqual(['ok', 'error', 'ok'])
    expect(pages[1].accessDetail).toMatch(/larger than the 25 MB/)
    expect(pages[1]).toMatchObject({ text: '', screenshot: null })
  })

  it('reports a main document just over the cap as an error, and takes one just under it', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/big-page`, `${server.url}/just-under`],
      limits: { maxDepth: 0 },
    })

    expect(pages[0].accessStatus).toBe('error')
    expect(pages[0].accessDetail).toMatch(/larger than the 25 MB/)
    expect(pages[1].accessStatus).toBe('ok')
    expect(pages[1].text).toContain('Under the cap.')
  })

  it('aborts an oversized sub-resource and keeps the page', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/with-big-parts`],
      limits: { maxDepth: 0 },
    })

    expect(browser.isConnected()).toBe(true)
    expect(pages[0].accessStatus).toBe('ok')
    expect(pages[0].text).toContain('Words beside big parts.')
  })

  it('does not request media at all', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/with-media`],
      limits: { maxDepth: 0 },
    })

    expect(pages[0].accessStatus).toBe('ok')
    expect(server.hits('/movie')).toBe(0)
    expect(server.hits('/song')).toBe(0)
  })

  it('does not follow links to obvious binary files', async () => {
    const pages = await captureAll({ browser, guard: server.guard('127.0.0.1'), startUrls: [`${server.url}/with-files`] })

    expect(pathsOf(pages)).toEqual(['/with-files', '/pdf-guide', '/guide.html'])
    for (const path of ['/report.pdf', '/photo.JPG', '/archive.zip', '/setup.exe', '/clip.mp4', '/notes.docx']) {
      expect(server.hits(path)).toBe(0)
    }
  })

  it('still tries a start url with a binary extension, which the auditor chose', async () => {
    const pages = await captureAll({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/report.pdf`],
    })

    expect(pages).toHaveLength(1)
    expect(server.hits('/report.pdf')).toBe(1)
  })
})

describe('when the browser dies', () => {
  let doomed: Browser

  beforeEach(async () => {
    doomed = await chromium.launch({ args: LOCKED_DOWN_BROWSER_ARGS })
  })

  afterEach(async () => {
    if (doomed.isConnected()) await doomed.close()
  })

  it('reports the rest of the queue as errors, and resolves', async () => {
    const pages: CapturedPageData[] = []
    await capturePages({
      browser: doomed,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/after`, `${server.url}/guide.html`, `${server.url}/pdf-guide`],
      respectRobots: false,
      signal: never,
      onPage: async (page) => {
        pages.push(page)
        if (pages.length === 1) await doomed.close()
      },
    })

    expect(pages.map((p) => p.accessStatus)).toEqual(['ok', 'error', 'error'])
    expect(pages[1].accessDetail).toMatch(/browser/i)
    expect(pages[2].accessDetail).toMatch(/browser/i)
  })

  it('reports the page in progress as an error, and resolves', async () => {
    setTimeout(() => void doomed.close(), 300)

    const pages = await captureAll({
      browser: doomed,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/slow`, `${server.url}/after`],
    })

    expect(pages.map((p) => p.accessStatus)).toEqual(['error', 'error'])
    expect(pages[0].accessDetail).toMatch(/browser/i)
  })

  it('reports every start url as an error when the browser is already gone, and resolves', async () => {
    await doomed.close()

    const pages = await captureAll({
      browser: doomed,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/after`, `${server.url}/guide.html`],
    })

    expect(pages.map((p) => p.accessStatus)).toEqual(['error', 'error'])
    expect(pages[0].accessDetail).toMatch(/browser/i)
  })
})

describe('a browser connection that goes silent', () => {
  let remote: Browser
  let proxy: net.Server
  let wedged: Browser
  let frozen: boolean
  const sockets: net.Socket[] = []

  beforeEach(async () => {
    frozen = false
    const debugPort = await new Promise<number>((resolve) => {
      const probe = net.createServer()
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as net.AddressInfo
        probe.close(() => resolve(port))
      })
    })
    remote = await chromium.launch({ args: [`--remote-debugging-port=${debugPort}`] })
    const version = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()) as { webSocketDebuggerUrl: string }
    const wsPath = new URL(version.webSocketDebuggerUrl).pathname

    // Forwards until frozen, then drops everything with no FIN or RST, as a half-open socket does.
    proxy = net.createServer((client) => {
      const upstream = net.connect(debugPort, '127.0.0.1')
      sockets.push(client, upstream)
      client.on('data', (data) => {
        if (!frozen) upstream.write(data)
      })
      upstream.on('data', (data) => {
        if (!frozen) client.write(data)
      })
      client.on('error', () => undefined)
      upstream.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve()))
    const { port } = proxy.address() as net.AddressInfo
    wedged = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${wsPath}`)
  })

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.destroy())
    proxy.close()
    await remote.close()
  })

  it('settles soon after the abort when the connection goes silent mid-run', async () => {
    const controller = new AbortController()
    let abortedAt = 0
    const run = capturePages({
      browser: wedged,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/`],
      respectRobots: false,
      signal: controller.signal,
      limits: { pageTimeoutMs: 2_000 },
      onPage: async () => {
        frozen = true
        setTimeout(() => {
          abortedAt = Date.now()
          controller.abort()
        }, 500)
      },
    })

    await run
    expect(abortedAt).toBeGreaterThan(0)
    expect(Date.now() - abortedAt).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
  })

  it('settles soon after the abort when the connection is already silent at the start', async () => {
    frozen = true
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const started = Date.now()

    const pages = await captureAll({
      browser: wedged,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/`],
      signal: controller.signal,
    })

    expect(pages).toEqual([])
    expect(Date.now() - started).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
  })

  it('gives up on setup by itself, and reports the start urls as errors', async () => {
    frozen = true

    const pages = await captureAll({
      browser: wedged,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/`],
      limits: { pageTimeoutMs: 500 },
    })

    expect(pages.map((p) => p.accessStatus)).toEqual(['error'])
    expect(pages[0].accessDetail).toMatch(/browser/i)
  })

  it('moves past a visit that passes its hard deadline, and finishes without any abort', async () => {
    const pages: CapturedPageData[] = []
    await capturePages({
      browser: wedged,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/after`, `${server.url}/guide.html`],
      respectRobots: false,
      signal: never,
      limits: { pageTimeoutMs: 500, maxDepth: 0 },
      onPage: async (page) => {
        pages.push(page)
        frozen = true
      },
    })

    expect(pages.map((p) => p.accessStatus)).toEqual(['ok', 'timeout'])
  })
})

describe('onPage', () => {
  it('is not waited for after the abort', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const started = Date.now()

    await capturePages({
      browser,
      guard: server.guard('127.0.0.1'),
      startUrls: [`${server.url}/after`],
      respectRobots: false,
      signal: controller.signal,
      onPage: () => new Promise<void>(() => undefined),
    })

    expect(Date.now() - started).toBeLessThan(5_000)
    expect(browser.contexts()).toEqual([])
  })
})
