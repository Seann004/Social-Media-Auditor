/**
 * Runs a real capture under tsx, whose esbuild keepNames setting can inject a
 * __name helper that does not exist in the browser. vitest does not set keepNames,
 * so only a run like this one shows that the code sent to the page survives it.
 */
import { closeBrowser, getBrowser } from '../browser.js'
import { capturePages, type CapturedPageData } from '../capture.js'
import { createUrlGuard } from '../urlGuard.js'
import { startFixtureSite } from './site.js'

const site = await startFixtureSite()
try {
  const pages: CapturedPageData[] = []
  await capturePages({
    browser: await getBrowser(),
    guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`] }),
    startUrls: [`${site.url}/`, `${site.url}/settings`],
    respectRobots: true,
    signal: new AbortController().signal,
    limits: { maxPages: 3 },
    onPage: async (page) => {
      pages.push(page)
    },
  })
  const summary = pages.map((p) => ({
    url: p.url,
    accessStatus: p.accessStatus,
    title: p.title,
    text: p.text,
    accessibilitySnapshot: p.accessibilitySnapshot,
    hasScreenshot: p.screenshot !== null,
  }))
  process.stdout.write(JSON.stringify(summary))
} finally {
  await closeBrowser()
  await site.close()
}
