import { randomUUID } from 'node:crypto'
import { highlightGuard } from './capture.js'
import { logRunProblem, type RunCtx } from './runnerShared.js'
import type { CapturedPage } from './types.js'

/** The key a quote on a page is looked up by. */
export const highlightKey = (pageId: string, quote: string): string => `${pageId}\n${quote}`

/**
 * Takes the close-ups of the given quotes, once per page, and stores them. Resolves with the
 * storage path of each quote that has one, keyed by highlightKey. A quote that is missing from
 * the result is normal: its card shows the page's full screenshot. Never rejects.
 */
export async function takeHighlights(
  ctx: RunCtx,
  pages: ReadonlyMap<string, CapturedPage>,
  quotesByPage: ReadonlyMap<string, string[]>,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>()
  for (const [pageId, quotes] of quotesByPage) {
    const page = pages.get(pageId)
    if (!page || ctx.signal.aborted || quotes.length === 0) continue
    const pageUrl = page.finalUrl ?? page.url
    let images: Map<string, Buffer>
    try {
      const browser = await ctx.browser()
      images = await ctx.deps.highlights({
        browser,
        guard: highlightGuard(pageUrl, ctx.deps.guard, ctx.robots),
        pageUrl,
        quotes,
        signal: ctx.signal,
      })
    } catch (err) {
      logRunProblem(ctx, `Could not take highlights on ${pageUrl}`, err)
      continue
    }
    for (const [quote, image] of images) {
      const path = `${ctx.run.projectId}/${ctx.run.id}/hl-${randomUUID()}.jpg`
      try {
        await ctx.deps.screenshots.upload(path, image)
        paths.set(highlightKey(pageId, quote), path)
      } catch (err) {
        logRunProblem(ctx, `Could not save a highlight of ${pageUrl}`, err)
      }
    }
  }
  return paths
}
