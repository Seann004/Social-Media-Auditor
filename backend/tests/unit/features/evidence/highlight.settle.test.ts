import { getEventListeners } from 'node:events'
import net from 'node:net'
import { chromium, type Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { highlightOn, isJpeg, never } from '../../../fixtures/highlightHelpers.js'
import { captureAll, html, quietLogUnlessTestFails, startPageServer, TEST_TIMEOUT_MS, withAlteredPages, type PageServer } from '../../../fixtures/pages.js'
import { closeBrowser, getBrowser, LOCKED_DOWN_BROWSER_ARGS } from '../../../../src/features/evidence/browser.js'
import { BROWSER_CLOSE_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../../../../src/features/evidence/config.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const FIRST = 'First quoted sentence sits here.'
const SECOND = 'Second quoted sentence sits there.'

/** A browser whose contexts really close, and then report the given error. */
function withContextCloseFailing(browser: Browser, failure: Error): Browser {
  return new Proxy(browser, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown
      if (key !== 'newContext') return typeof value === 'function' ? value.bind(target) : value
      return async (...args: Parameters<Browser['newContext']>) => {
        const context = await target.newContext(...args)
        const close = context.close.bind(context)
        context.close = async () => {
          await close()
          throw failure
        }
        return context
      }
    },
  })
}

const timers = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length

let browser: Browser
let server: PageServer
let onFirstRequest: () => void

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  quietLogUnlessTestFails()
  onFirstRequest = () => undefined
  server = await startPageServer({
    '/two': html('Page', `<p>${FIRST}</p><p>${SECOND}</p>`),
    '/slow': () => undefined,
    '/refresh': html(
      'Page',
      `${Array.from({ length: 40 }, (_, i) => `<p>Numbered sentence ${i} for the refresh race here.</p>`).join('')}`,
      '<meta http-equiv="refresh" content="1;url=/other">',
    ),
    '/other': html('Other', '<p>A different page altogether.</p>'),
    '/restless': html(
      'Page',
      `<p>${FIRST}</p>`,
      // Scripts are off during a highlight, so only an animation can keep the words moving.
      '<style>@keyframes drift { from { margin-top: 0 } to { margin-top: 200px } } p { animation: drift 0.3s linear infinite }</style>',
    ),
    '/huge': (res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'x'))
    },
    '/watched': (res) => {
      onFirstRequest()
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(html('Page', `<p>${FIRST}</p><p>${SECOND}</p>`))
    },
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await server.close()
})

describe('giving up on a close-up', () => {
  const logged = () => vi.mocked(console.error).mock.calls.map((args) => args.join(' '))

  it('logs that it gave up when the page will not hold still, naming the page and not the quote', async () => {
    const images = await highlightOn(browser, server, '/restless', [FIRST])

    expect(images.has(FIRST)).toBe(false)
    const lines = logged().filter((line) => line.includes('/restless'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/kept moving/)
    expect(lines[0]).not.toContain(FIRST)
  })

  it('logs nothing for a quote that is simply not on the page', async () => {
    const images = await highlightOn(browser, server, '/two', ['A sentence that is nowhere on this page.'])

    expect(images.size).toBe(0)
    expect(logged()).toEqual([])
  })
})

describe('settling', () => {
  afterEach(() => {
    expect(browser.contexts()).toEqual([])
  })

  it('returns an empty map without any navigation when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const images = await highlightOn(browser, server, '/two', [FIRST], { signal: controller.signal })

    expect(images.size).toBe(0)
    expect(server.requests()).toEqual([])
  })

  it('settles soon after an abort while the page is loading', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const started = Date.now()

    const images = await highlightOn(browser, server, '/slow', [FIRST], { signal: controller.signal })

    expect(images.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
  })

  it('returns the images already taken when the abort comes between quotes', async () => {
    const controller = new AbortController()
    let shots = 0
    const watched = withAlteredPages(browser, (page) => {
      const context = page.context()
      const open = context.newCDPSession.bind(context)
      context.newCDPSession = async (target) => {
        const cdp = await open(target)
        const send = cdp.send.bind(cdp) as typeof cdp.send
        cdp.send = (async (method: string, params?: object) => {
          if (method === 'Page.captureScreenshot') {
            shots += 1
            if (shots === 2) controller.abort()
          }
          return send(method as never, params as never)
        }) as typeof cdp.send
        return cdp
      }
    })
    const started = Date.now()

    const images = await highlightOn(watched, server, '/two', [FIRST, SECOND], { signal: controller.signal })

    expect(shots).toBe(2)
    expect([...images.keys()]).toEqual([FIRST])
    expect(Date.now() - started).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
  })

  it('does not log an abort as a failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)

    await highlightOn(browser, server, '/slow', [FIRST], { signal: controller.signal })

    expect(log).not.toHaveBeenCalled()
  })

  it('leaves no listener on the signal after a call', async () => {
    const controller = new AbortController()

    for (let call = 0; call < 3; call += 1) await highlightOn(browser, server, '/two', [FIRST], { signal: controller.signal })
    await captureAll({ browser, guard: server.guard('127.0.0.1'), startUrls: [`${server.url}/two`], signal: controller.signal, limits: { maxDepth: 0 } })

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('stops at the page moving itself, keeping the pictures already taken, long before the visit deadline', async () => {
    const quotes = Array.from({ length: 40 }, (_, i) => `Numbered sentence ${i} for the refresh race here.`)
    const started = Date.now()

    const images = await highlightOn(browser, server, '/refresh', quotes)

    expect(Date.now() - started).toBeLessThan(4_500)
    for (const image of images.values()) expect(isJpeg(image)).toBe(true)
    expect(browser.contexts()).toEqual([])
  })

  it('returns an empty map, and says why, for a page over the size limit', async () => {
    const images = await highlightOn(browser, server, '/huge', [FIRST])

    expect(images.size).toBe(0)
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toMatch(/larger than the 25 MB/)
  })

  it('does not log a close that fails only because the browser is already closing', async () => {
    const closing = withContextCloseFailing(browser, new Error('browserContext.close: Target page, context or browser has been closed'))

    await highlightOn(closing, server, '/two', [FIRST])

    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toMatch(/Could not close/)
  })

  it('logs a close that fails for another reason', async () => {
    const closing = withContextCloseFailing(browser, new Error('The connection broke'))

    await highlightOn(closing, server, '/two', [FIRST])

    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toMatch(/Could not close the browser context/)
  })

  it('closes a context that arrives after the open gave up', async () => {
    const slow = new Proxy(browser, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown
        if (key !== 'newContext') return typeof value === 'function' ? value.bind(target) : value
        return async (...args: Parameters<Browser['newContext']>) => {
          await new Promise((resolve) => setTimeout(resolve, 1_200))
          return target.newContext(...args)
        }
      },
    })

    const images = await highlightOn(slow, server, '/two', [FIRST], { pageTimeoutMs: 300 })
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    expect(images.size).toBe(0)
    expect(browser.contexts()).toEqual([])
  })

  it('gives up by itself on a page that never answers', async () => {
    const started = Date.now()

    const images = await highlightOn(browser, server, '/slow', [FIRST], { pageTimeoutMs: 800 })

    expect(images.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(800 * 4 + BROWSER_CLOSE_TIMEOUT_MS + 2_000)
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

  it('returns an empty map when it is already gone', async () => {
    await doomed.close()

    expect((await highlightOn(doomed, server, '/two', [FIRST])).size).toBe(0)
  })

  it('returns an empty map when it dies during the load, and logs that it did', async () => {
    setTimeout(() => void doomed.close(), 300)

    expect((await highlightOn(doomed, server, '/slow', [FIRST])).size).toBe(0)
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ')
    expect(logged).toContain(`${server.url}/slow`)
    // Closing a context the dead browser already lost is not worth a line of its own.
    expect(logged).not.toMatch(/Could not close|Gave up closing/)
    expect(doomed.contexts()).toEqual([])
  })

  it('returns the images already taken when it dies between quotes', async () => {
    onFirstRequest = () => undefined
    const killer = withAlteredPages(doomed, (page) => {
      const context = page.context()
      const open = context.newCDPSession.bind(context)
      let shots = 0
      context.newCDPSession = async (target) => {
        const cdp = await open(target)
        const send = cdp.send.bind(cdp) as typeof cdp.send
        cdp.send = (async (method: string, params?: object) => {
          if (method === 'Page.captureScreenshot') {
            shots += 1
            if (shots === 2) await doomed.close()
          }
          return send(method as never, params as never)
        }) as typeof cdp.send
        return cdp
      }
    })

    const images = await highlightOn(killer, server, '/two', [FIRST, SECOND])

    expect([...images.keys()]).toEqual([FIRST])
    expect(doomed.contexts()).toEqual([])
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

  it('settles soon after the abort when it is already silent at the start', async () => {
    frozen = true
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const started = Date.now()

    const images = await highlightOn(wedged, server, '/two', [FIRST], { signal: controller.signal })

    expect(images.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
  })

  it('gives up on setup by itself', async () => {
    frozen = true
    const started = Date.now()

    const images = await highlightOn(wedged, server, '/two', [FIRST], { pageTimeoutMs: 500 })

    expect(images.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
  })

  it('settles soon after the abort when it goes silent mid-run', async () => {
    const controller = new AbortController()
    let abortedAt = 0
    onFirstRequest = () => {
      setTimeout(() => {
        frozen = true
        setTimeout(() => {
          abortedAt = Date.now()
          controller.abort()
        }, 500)
      }, 300)
    }

    const timersBefore = timers()
    await highlightOn(wedged, server, '/watched', [FIRST, SECOND], { signal: controller.signal, pageTimeoutMs: 2_000 })

    expect(Date.now() - abortedAt).toBeLessThan(BROWSER_CLOSE_TIMEOUT_MS + 2_000)
    // Nothing is logged for a run that was aborted, and no timer is left to run the visit's deadline.
    expect(vi.mocked(console.error)).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(timers()).toBeLessThanOrEqual(timersBefore)
  })

  it('moves past a silent browser by itself, without any abort', async () => {
    onFirstRequest = () => setTimeout(() => (frozen = true), 300)
    const started = Date.now()

    const images = await highlightOn(wedged, server, '/watched', [FIRST, SECOND], { signal: never, pageTimeoutMs: 500 })

    for (const image of images.values()) expect(isJpeg(image)).toBe(true)
    expect(Date.now() - started).toBeLessThan(500 * 4 + BROWSER_CLOSE_TIMEOUT_MS * 2 + 2_000)
  })
})
