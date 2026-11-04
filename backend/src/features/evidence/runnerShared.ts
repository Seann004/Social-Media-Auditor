import type { Browser } from 'playwright'
import { GroqLimitError } from '../../lib/groq.js'
import type { AssessInput, AssessItem, AssessOutput } from './assess.js'
import type { AuditData } from './auditData.js'
import type { CaptureOptions } from './capture.js'
import type { HighlightOptions } from './highlight.js'
import type { EvidenceRepository, RunPatch, ScreenshotStore } from './repository.js'
import type { RobotsChecker } from './robots.js'
import type { EvidenceRun } from './types.js'
import type { UrlGuard } from './urlGuard.js'

export interface RunnerDeps {
  repo: EvidenceRepository
  screenshots: ScreenshotStore
  audit: AuditData
  guard: UrlGuard
  apiKey: string
  model: string
  /** Defaults to the shared browser. */
  browserProvider?: () => Promise<Browser>
  /** Defaults to capturePages. */
  capture?: (opts: CaptureOptions) => Promise<void>
  /** Defaults to captureHighlights. */
  highlights?: (opts: HighlightOptions) => Promise<Map<string, Buffer>>
  /** Defaults to assessBatch. */
  assessBatch?: (input: AssessInput) => Promise<AssessOutput>
  /** For tests. Defaults to RUN_TIMEOUT_MS. */
  runTimeoutMs?: number
}

export type ResolvedDeps = Required<Omit<RunnerDeps, 'runTimeoutMs'>>

/** What every phase of one run shares. */
export interface RunCtx {
  run: EvidenceRun
  deps: ResolvedDeps
  signal: AbortSignal
  /** One checker for the whole run, so that robots.txt is read once per site. Null when permission was recorded. */
  robots: RobotsChecker | null
  /** The browser of this run, started on first use. */
  browser(): Promise<Browser>
}

/** The project, and so this run, was deleted while the job was running. The job ends without a word. */
export class RunGoneError extends Error {}

/** The run is over, and this is the sentence for the auditor. */
export class RunFailure extends Error {}

/** The whole-run time ran out while waiting. */
export class RunAbortedError extends Error {}

/**
 * The key of a category. Names repeat across guidelines, so the guideline is part of it. The same
 * key plans the batches, so a category is exactly the set of items one planBatches group holds.
 */
export function categoryKey(item: Pick<AssessItem, 'guidelineId' | 'category'>): string {
  return `${item.guidelineId}__${item.category}`
}

/** A category's name as an auditor reads it, from its key. */
export function categoryNameOf(key: string): string {
  const at = key.indexOf('__')
  return at < 0 ? key : key.slice(at + 2)
}

/** A text that is safe to log or show: no key, no bearer token. */
export function safeMessage(err: unknown, apiKey: string): string {
  let text = err instanceof Error ? err.message : String(err)
  if (apiKey) text = text.split(apiKey).join('[redacted]')
  return text.replace(/gsk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
}

export function logRunProblem(ctx: { run: { id: string }; deps: { apiKey: string } }, what: string, err: unknown): void {
  console.error(`[evidence] ${what} (run ${ctx.run.id}):`, safeMessage(err, ctx.deps.apiKey))
}

/**
 * Groq's daily limit. groq.ts raises GroqLimitError when the wait asked for is too long, but a
 * final 429 after the short retries comes out of assess.ts as a plain error with this message.
 */
export function isGroqLimit(err: unknown): boolean {
  if (err instanceof GroqLimitError) return true
  return err instanceof Error && /Groq request failed with status 429\b/.test(err.message)
}

/** True when the run row is gone, as after its project was deleted. A failing read is not taken for gone. */
export async function isRunGone(ctx: Pick<RunCtx, 'run' | 'deps'>): Promise<boolean> {
  try {
    return (await ctx.deps.repo.getRun(ctx.run.id)) === null
  } catch {
    return false
  }
}

/** Throws RunGoneError if the failure came from a run that is gone; otherwise does nothing. */
export async function endIfRunGone(ctx: Pick<RunCtx, 'run' | 'deps'>): Promise<void> {
  if (await isRunGone(ctx)) throw new RunGoneError()
}

/** Updates the run. Returns false when it could not, unless the run is gone, which ends the job. */
export async function updateRun(ctx: Pick<RunCtx, 'run' | 'deps'>, patch: RunPatch): Promise<boolean> {
  try {
    await ctx.deps.repo.updateRun(ctx.run.id, patch)
    return true
  } catch (err) {
    await endIfRunGone(ctx)
    logRunProblem(ctx, 'Could not update the run', err)
    return false
  }
}

/** Settles with the work, or rejects with RunAbortedError as soon as the signal aborts. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined)
    return Promise.reject(new RunAbortedError())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RunAbortedError())
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
