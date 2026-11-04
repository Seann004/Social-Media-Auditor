import { randomUUID } from 'node:crypto'
import type { CapturedPageData } from './capture.js'
import type { NewPassage } from './repository.js'
import { extractControlLines, splitControlLines, splitIntoPassages } from './passages.js'
import type { CapturedPage } from './types.js'
import { abortable, endIfRunGone, logRunProblem, RunAbortedError, RunFailure, updateRun, type RunCtx } from './runnerShared.js'

/** The passages of a readable page: its text split up, then its form controls as one more. */
export function passagesOf(data: Pick<CapturedPageData, 'text' | 'accessibilitySnapshot'>): NewPassage[] {
  const passages: NewPassage[] = splitIntoPassages(data.text).map((text, position) => ({ position, kind: 'text', text }))
  const controls = data.accessibilitySnapshot ? extractControlLines(data.accessibilitySnapshot) : ''
  for (const text of controls ? splitControlLines(controls) : []) {
    passages.push({ position: passages.length, kind: 'controls', text })
  }
  return passages
}

async function saveScreenshot(ctx: RunCtx, data: CapturedPageData): Promise<string | null> {
  if (!data.screenshot) return null
  const path = `${ctx.run.projectId}/${ctx.run.id}/page-${randomUUID()}.jpg`
  try {
    await ctx.deps.screenshots.upload(path, data.screenshot)
    return path
  } catch (err) {
    // The text is still evidence without the picture.
    logRunProblem(ctx, `Could not save the screenshot of ${data.url}`, err)
    return null
  }
}

/**
 * Stores one captured page whatever its status, with its screenshot. Only a readable page gets
 * passages: login, blocked and error pages are kept for the auditor and never reach the AI.
 * Returns whether the page was stored.
 */
async function storePage(ctx: RunCtx, data: CapturedPageData): Promise<boolean> {
  const screenshotPath = await saveScreenshot(ctx, data)
  try {
    const row = await ctx.deps.repo.addPage(ctx.run.id, {
      url: data.url,
      finalUrl: data.finalUrl,
      httpStatus: data.httpStatus,
      accessStatus: data.accessStatus,
      accessDetail: data.accessDetail,
      title: data.title,
      text: data.text,
      accessibilitySnapshot: data.accessibilitySnapshot,
      screenshotPath,
      contentHash: data.contentHash,
    })
    if (data.accessStatus === 'ok') {
      const passages = passagesOf(data)
      if (passages.length > 0) await ctx.deps.repo.addPassages(row.id, passages)
    }
    return true
  } catch (err) {
    await endIfRunGone(ctx)
    logRunProblem(ctx, `Could not store the page ${data.url}`, err)
    return false
  }
}

export interface CaptureOutcome {
  /** The pages stored, which may be none. */
  pages: CapturedPage[]
  /** How many readable pages the capture reported, whether or not they could be stored. */
  readableReported: number
}

/**
 * Captures the project's start urls and stores what was captured. Throws RunFailure when nothing
 * can be captured at all.
 */
export async function capturePhase(ctx: RunCtx): Promise<CaptureOutcome> {
  const { repo, capture, guard } = ctx.deps
  const source = await repo.getSource(ctx.run.projectId)
  if (!source || source.startUrls.length === 0) {
    throw new RunFailure('No start URLs are saved for this project, so there was nothing to capture.')
  }

  let browser
  try {
    browser = await abortable(ctx.browser(), ctx.signal)
  } catch (err) {
    if (err instanceof RunAbortedError) return { pages: [], readableReported: 0 }
    logRunProblem(ctx, 'The browser could not be started', err)
    throw new RunFailure('The browser could not be started, so no pages were captured.')
  }

  let pagesDone = 0
  let readableReported = 0
  try {
    await abortable(
      capture({
        browser,
        guard,
        startUrls: source.startUrls,
        respectRobots: ctx.robots !== null,
        robots: ctx.robots ?? undefined,
        signal: ctx.signal,
        onPage: async (data) => {
          if (data.accessStatus === 'ok') readableReported += 1
          if (await storePage(ctx, data)) pagesDone += 1
          await updateRun(ctx, { pagesDone, pagesTotal: Math.max(pagesDone, ctx.run.pagesTotal) })
        },
      }),
      ctx.signal,
    )
  } catch (err) {
    // Out of time: whatever was stored is kept, and the run decides what that is worth.
    if (!(err instanceof RunAbortedError)) throw err
  }
  return { pages: await repo.listPages(ctx.run.capturedInRunId), readableReported }
}
