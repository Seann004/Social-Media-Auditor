import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser, Page } from 'playwright'
import { onTestFailed, vi } from 'vitest'
import { capturePages, type CaptureLimits, type CapturedPageData } from '../../src/features/evidence/capture.js'
import { BROWSER_CLOSE_TIMEOUT_MS, VISIT_DEADLINE_PAGE_TIMEOUTS } from '../../src/features/evidence/config.js'
import { createUrlGuard, type UrlGuard } from '../../src/features/evidence/urlGuard.js'

export type PageHandler = string | ((res: ServerResponse, req: IncomingMessage) => void)

export interface PageRequest {
  host: string
  path: string
  headers: IncomingHttpHeaders
}

export interface PageServer {
  url: string
  port: number
  requests(): PageRequest[]
  /** How many requests reached this path. */
  hits(path: string): number
  /** A guard that allows this server under the given names, and nothing else. */
  guard(...names: string[]): UrlGuard
  close(): Promise<void>
}

/** Short enough that a stalled step reports itself, and leaves time for the rest of the test. */
export const TEST_PAGE_TIMEOUT_MS = 12_000

/**
 * Past the visit deadline at that page timeout, so that even a step only the deadline can stop
 * (newPage, say) ends in a failed assertion with the log, not in a test timeout with nothing.
 */
export const TEST_TIMEOUT_MS = TEST_PAGE_TIMEOUT_MS * VISIT_DEADLINE_PAGE_TIMEOUTS + BROWSER_CLOSE_TIMEOUT_MS + 5_000

/**
 * Keeps the capture's own console.error quiet in a test where failures are on purpose. Only a test
 * that fails has any use for the log, and it then says which step of the capture went wrong.
 * Kept in its own list: by the time onTestFailed runs, afterEach has reset the mock's record.
 */
export function quietLogUnlessTestFails(): void {
  const logged: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.join(' '))
  })
  onTestFailed(() => {
    process.stderr.write(`Capture log of the failed test:\n${logged.join('\n')}\n`)
  })
}

export function html(title: string, body: string, head = ''): string {
  return `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`
}

/** A small one-off site for a test file, serving the given pages as text/html. */
export async function startPageServer(pages: Record<string, PageHandler>): Promise<PageServer> {
  const requests: PageRequest[] = []
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname
    requests.push({ host: req.headers.host ?? '', path, headers: req.headers })
    const page = pages[path]
    if (typeof page === 'function') {
      page(res, req)
    } else if (typeof page === 'string') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page)
    } else {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html('Not found', '<p>Not found.</p>'))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests: () => [...requests],
    hits: (path) => requests.filter((r) => r.path === path).length,
    guard: (...names) => createUrlGuard({ allowedPrivateHosts: names.map((name) => `${name}:${port}`) }),
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

export interface CaptureAllOptions {
  browser: Browser
  guard: UrlGuard
  startUrls: string[]
  respectRobots?: boolean
  signal?: AbortSignal
  limits?: Partial<CaptureLimits>
}

/** Runs a capture and returns every page it reported. */
export async function captureAll(options: CaptureAllOptions): Promise<CapturedPageData[]> {
  const pages: CapturedPageData[] = []
  await capturePages({
    respectRobots: false,
    signal: new AbortController().signal,
    ...options,
    onPage: async (page) => {
      pages.push(page)
    },
  })
  return pages
}

/** A browser whose new pages have been altered, for failures a real page will not produce on demand. */
export function withAlteredPages(browser: Browser, alter: (page: Page) => void): Browser {
  const newContext = browser.newContext.bind(browser)
  return new Proxy(browser, {
    get(target, key) {
      if (key !== 'newContext') return Reflect.get(target, key)
      return async (...args: Parameters<Browser['newContext']>) => {
        const context = await newContext(...args)
        const newPage = context.newPage.bind(context)
        context.newPage = async () => {
          const created = await newPage()
          alter(created)
          return created
        }
        return context
      }
    },
  })
}
