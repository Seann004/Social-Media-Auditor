import type { AuditData } from './auditData.js'
import {
  LOCKED_SUBMISSION_STATUSES,
  MAX_RUNS_PER_PROJECT_PER_DAY,
  RUNS_WINDOW_MS,
  RUN_TIMEOUT_MS,
  STALE_QUEUED_RUN_MS,
  STALE_RUN_MARGIN_MS,
} from './config.js'
import type { RunQueue } from './queue.js'
import type { EvidenceRepository } from './repository.js'
import type { EvidenceRun, RunScope } from './types.js'

export interface RunStartDeps {
  repo: EvidenceRepository
  audit: Pick<AuditData, 'getSubmissionStatus'>
  queue: RunQueue
  acquire: (projectId: string) => (() => void) | null
  /** For tests. Defaults to the clock. */
  now?: () => number
}

export type StartOutcome =
  | { ok: true; run: EvidenceRun }
  | { ok: false; status: 400 | 404 | 409 | 429; error: string }

const STALE_ERROR = 'This run was lost: the server stopped hearing from it. Start a new run.'
const MAX_STALE_SWEEP = 10

const refuse = (status: 400 | 404 | 409 | 429, error: string): StartOutcome => ({ ok: false, status, error })

function isStale(run: EvidenceRun, now: number): boolean {
  // A queued run has not started; judge it by when it was made.
  const since = Date.parse(run.startedAt ?? run.createdAt)
  if (Number.isNaN(since)) return false
  const age = now - since
  if (run.status === 'queued') return age > STALE_QUEUED_RUN_MS
  return age > RUN_TIMEOUT_MS + STALE_RUN_MARGIN_MS
}

/**
 * The run that really is still going, if any. A run whose last update was lost would otherwise lock
 * the project for good, so one past its bound is failed here and no longer counts.
 */
async function liveActiveRun(deps: RunStartDeps, projectId: string): Promise<EvidenceRun | null> {
  const now = (deps.now ?? Date.now)()
  for (let i = 0; i < MAX_STALE_SWEEP; i += 1) {
    const active = await deps.repo.activeRun(projectId)
    if (!active) return null
    if (!isStale(active, now)) return active
    await deps.repo.updateRun(active.id, { status: 'failed', error: STALE_ERROR, finishedAt: new Date(now).toISOString() })
  }
  return null
}

interface NewRunPlan {
  projectId: string
  userId: string
  scope: RunScope
}

type Prepared = { refusal: StartOutcome } | { refusal?: undefined; capturedInRunId?: string }

/** The checks shared by a new run and a re-assess, then the run itself, all under the project's lock. */
async function createAndQueue(deps: RunStartDeps, plan: NewRunPlan, prepare: () => Promise<Prepared>): Promise<StartOutcome> {
  const release = deps.acquire(plan.projectId)
  if (!release) return refuse(409, 'A run is already being started for this project.')
  try {
    const submission = await deps.audit.getSubmissionStatus(plan.projectId)
    if (submission === null) return refuse(404, 'The project no longer exists.')
    if (LOCKED_SUBMISSION_STATUSES.includes(submission)) {
      return refuse(409, 'The audit has been submitted, so its answers can no longer change.')
    }
    const prepared = await prepare()
    if (prepared.refusal) return prepared.refusal
    if (await liveActiveRun(deps, plan.projectId)) return refuse(409, 'A run is already in progress for this project.')
    const since = new Date((deps.now ?? Date.now)() - RUNS_WINDOW_MS).toISOString()
    if ((await deps.repo.countRunsSince(plan.projectId, since)) >= MAX_RUNS_PER_PROJECT_PER_DAY) {
      return refuse(429, `This project has used its ${MAX_RUNS_PER_PROJECT_PER_DAY} runs for today. Try again tomorrow.`)
    }
    const run = await deps.repo.createRun({
      projectId: plan.projectId,
      startedBy: plan.userId,
      scope: plan.scope,
      ...(prepared.capturedInRunId ? { capturedInRunId: prepared.capturedInRunId } : {}),
    })
    deps.queue.enqueue(run.id)
    return { ok: true, run }
  } finally {
    release()
  }
}

/** A run that captures pages from the saved addresses, then assesses every category. */
export function startRun(deps: RunStartDeps, projectId: string, userId: string): Promise<StartOutcome> {
  return createAndQueue(deps, { projectId, userId, scope: 'all' }, async () => {
    const source = await deps.repo.getSource(projectId)
    if (source && source.startUrls.length > 0) return {}
    return { refusal: refuse(400, 'Save the website addresses to check before starting a run.') }
  })
}

/**
 * A run that assesses again from the pages an earlier run captured. It has no pages of its own, so it
 * points at the pages of the run it was made from. Only the latest results can be re-assessed: an old
 * tab would otherwise show suggestions from pages that are no longer the current ones.
 */
export function startReassess(
  deps: RunStartDeps,
  projectId: string,
  userId: string,
  runId: string,
  scope: RunScope,
): Promise<StartOutcome> {
  return createAndQueue(deps, { projectId, userId, scope }, async () => {
    const from = await deps.repo.getRun(runId)
    if (!from || from.projectId !== projectId) return { refusal: refuse(404, 'That run was not found.') }
    if (from.status !== 'completed' && from.status !== 'partial') {
      return { refusal: refuse(409, 'Only a finished run can be assessed again.') }
    }
    const latest = await deps.repo.latestResultRun(projectId)
    if (!latest || latest.capturedInRunId !== from.capturedInRunId) {
      return { refusal: refuse(409, 'A newer run has replaced these results. Reload the page and assess again from the latest run.') }
    }
    return { capturedInRunId: from.capturedInRunId }
  })
}
