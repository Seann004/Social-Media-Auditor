/**
 * Runs a real highlight under tsx, whose esbuild keepNames setting can inject a __name helper
 * that does not exist in the browser. vitest does not set keepNames, so only a run like this one
 * shows that the code sent to the page survives it.
 */
import { closeBrowser, getBrowser } from '../browser.js'
import { captureHighlights } from '../highlight.js'
import { createUrlGuard } from '../urlGuard.js'
import { startFixtureSite } from './site.js'

const site = await startFixtureSite()
try {
  const guard = createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`] })
  const quote = 'Teen accounts are private by default.'
  const images = await captureHighlights({
    browser: await getBrowser(),
    guard,
    navigationGuard: guard,
    pageUrl: `${site.url}/privacy`,
    quotes: [quote, 'Not on the page at all.'],
    signal: new AbortController().signal,
  })
  const image = images.get(quote)
  process.stdout.write(
    JSON.stringify({
      keys: [...images.keys()],
      jpeg: image !== undefined && image[0] === 0xff && image[1] === 0xd8,
      bytes: image?.length ?? 0,
    }),
  )
} finally {
  await closeBrowser()
  await site.close()
}
