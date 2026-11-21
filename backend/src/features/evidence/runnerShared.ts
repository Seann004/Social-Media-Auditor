import type { Embedder } from '../../lib/embedder.js'
import type { VerifyClaim } from './claimCheck.js'
import type { Browser } from 'playwright'
import { GroqLimitError } from '../../lib/groq.js'
import type { DecideStep } from './appAgent.js'
import type { AppRepository } from './appRepository.js'
import type { AssessInput, AssessItem, AssessOutput } from './assess.js'
import type { AuditData } from './auditData.js'
import type { CaptureOptions } from './capture.js'
import type { HighlightOptions } from './highlight.js'
import type { GithubFetcher } from './repoFetch.js'
import type { RepoRepository } from './repoRepository.js'
import type { EvidenceRepository, RunPatch, ScreenshotStore } from './repository.js'
import type { RobotsChecker } from './robots.js'
import type { TokenMeter } from './runnerAssess.js'
import type { EvidenceRun } from './types.js'
import type { UrlGuard } from './urlGuard.js'

/** What an app run needs besides a pages run's dependencies. */
export interface AppRunnerDeps {
  appRepo: AppRepository
  /** The key the test-account passwords are encrypted with. Null when the server has none. */
  secretKey: Buffer | null
  /** Defaults to the Groq step call. */
  decideStep?: DecideStep
  /** For tests. Defaults to APP_RESTORE_GRACE_MS. */
  restoreGraceMs?: number
  /** Signs a test account in by itself when its sign-in form shows after a switch. Defaults to true. */
  autoSignIn?: boolean
  /** A second look at each yes/no claim an app check makes. Without it, claims are stored as the first answer gave them. */
  verifyClaim?: VerifyClaim | null
}

/** What a code repository run needs besides a pages run's dependencies. */
export interface CodeRunnerDeps {
  repoRepo: RepoRepository
  /** Defaults to the real GitHub fetcher. */
  fetcher?: (guard: UrlGuard, signal: AbortSignal) => GithubFetcher
}

export type ResolvedCodeDeps = Required<CodeRunnerDeps>

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
  /** For app runs. Without it, an app run fails with a sentence saying so. */
  app?: AppRunnerDeps | null
  /** For code repository runs. Without it, a repo run fails with a sentence saying so. */
  code?: CodeRunnerDeps | null
  /** Finds page passages by meaning as well as by words. Null or missing: words only. */
  embedder?: Embedder | null
  /** For tests. Defaults to the run's own timeout: runTimeoutMsOf. */
  runTimeoutMs?: number
  /** Waits between tries at an update that failed. For tests. Defaults to RUN_UPDATE_RETRY_DELAYS_MS. */
  retryDelaysMs?: readonly number[]
}

export type ResolvedDeps = Required<Omit<RunnerDeps, 'runTimeoutMs' | 'code'>> & { code: ResolvedCodeDeps | null }

/** What the helpers that keep a run's status true need. A run that could not be read has only its id. */
export interface RunHandle {
  run: { id: string }
  deps: Pick<ResolvedDeps, 'repo' | 'apiKey' | 'retryDelaysMs'>
}

/** What every phase of one run shares. */
export interface RunCtx extends RunHandle {
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

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  // The database service throws the plain error objects of PostgREST.
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return typeof err === 'string' ? err : 'an error without a message'
}

/** A text that is safe to log or show: no key, no bearer token, no stack. */
export function safeMessage(err: unknown, apiKey: string): string {
  let text = messageOf(err)
  if (apiKey) text = text.split(apiKey).join('[redacted]')
  return text.replace(/gsk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
}

export function logRunProblem(ctx: RunHandle, what: string, err: unknown): void {
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
export async function isRunGone(ctx: RunHandle): Promise<boolean> {
  try {
    return (await ctx.deps.repo.getRun(ctx.run.id)) === null
  } catch {
    return false
  }
}

/** Throws RunGoneError if the failure came from a run that is gone; otherwise does nothing. */
export async function endIfRunGone(ctx: RunHandle): Promise<void> {
  if (await isRunGone(ctx)) throw new RunGoneError()
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Updates the run once. Returns false when it could not, unless the run is gone, which ends the job. */
export async function updateRun(ctx: RunHandle, patch: RunPatch): Promise<boolean> {
  try {
    await ctx.deps.repo.updateRun(ctx.run.id, patch)
    return true
  } catch (err) {
    await endIfRunGone(ctx)
    logRunProblem(ctx, 'Could not update the run', err)
    return false
  }
}

/**
 * Updates the run, trying again after each of the configured delays. For the updates that decide
 * whether the project is locked: a run left in a working status keeps the project from starting
 * another one until the server restarts. Returns false only when every try failed.
 */
export async function updateRunReliably(ctx: RunHandle, patch: RunPatch): Promise<boolean> {
  const delays = ctx.deps.retryDelaysMs
  for (let attempt = 0; ; attempt += 1) {
    try {
      await ctx.deps.repo.updateRun(ctx.run.id, patch)
      return true
    } catch (err) {
      await endIfRunGone(ctx)
      if (attempt >= delays.length) {
        logRunProblem(ctx, 'Could not update the run, so it may stay in its last status', err)
        return false
      }
      await sleep(delays[attempt])
    }
  }
}

/** Reads the run, trying again after each of the configured delays. Rejects with the last error. */
export async function readRunReliably(deps: RunHandle['deps'], runId: string): Promise<EvidenceRun | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await deps.repo.getRun(runId)
    } catch (err) {
      if (attempt >= deps.retryDelaysMs.length) throw err
      await sleep(deps.retryDelaysMs[attempt])
    }
  }
}

/** Counts the tokens of one run. */
export function createMeter(): TokenMeter {
  let used = 0
  return {
    used: () => used,
    add(tokens) {
      used += tokens
    },
  }
}

const CHECKLIST_UNREADABLE = 'The checklist of this project could not be read because the database did not answer. Start the run again later.'

/** The project's checklist and platform, or a RunFailure with a sentence for the auditor. */
export async function loadChecklist(ctx: RunCtx): Promise<{ items: AssessItem[]; platform: string }> {
  try {
    const { audit } = ctx.deps
    const items = await audit.listChecklistItems(ctx.run.projectId)
    return { items, platform: await audit.getPlatform(ctx.run.projectId) }
  } catch (err) {
    if (await isRunGone(ctx)) throw new RunGoneError()
    logRunProblem(ctx, 'Could not read the checklist', err)
    throw new RunFailure(CHECKLIST_UNREADABLE)
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
