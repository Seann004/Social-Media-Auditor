/**
 * What an app repeat and a code repeat share: the checklist item made from a case, an audit with
 * only that item, the AI calls metered by the budget, and the record built from the finished run.
 */
import type { DecideStep } from '../src/features/evidence/appAgent.js'
import type { AssessInput, AssessItem, AssessOutput } from '../src/features/evidence/assess.js'
import type { AuditData } from '../src/features/evidence/auditData.js'
import { createMemoryRepository } from '../src/features/evidence/memoryRepository.js'
import { isGroqLimit } from '../src/features/evidence/runnerShared.js'
import type { EvidenceRun, Suggestion } from '../src/features/evidence/types.js'
import { PLATFORM } from './cases.js'
import type { Budget } from './execute.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'

export const PROJECT_ID = 'benchmark-project'
const STARTED_BY = 'benchmark'

/** The AI the pipeline uses: the real calls in a benchmark, fakes in a test. */
export interface AiDeps {
  decideStep: DecideStep
  assessBatch: (input: AssessInput) => Promise<AssessOutput>
}

export interface RepeatContext {
  apiKey: string
  model: string
  ai: AiDeps
  budget: Budget
}

export type MemoryRepo = ReturnType<typeof createMemoryRepository>

/** The checklist item of a case: its id is the case id. */
export function itemOf(c: BenchmarkCase): AssessItem {
  return { id: c.id, guidelineId: 'benchmark', category: c.category, name: null, text: c.item, helpText: null }
}

/** An audit holding only the given item, with no answers, so nothing is ever auto-matched or written. */
export function benchmarkAudit(item: AssessItem): AuditData {
  return {
    listChecklistItems: async () => [{ ...item }],
    listAnswers: async () => [],
    getPlatform: async () => PLATFORM,
    getProjectAccess: async () => null,
    getSubmissionStatus: async () => 'not_submitted',
    applyAnswer: async () => {
      throw new Error('the benchmark never applies an answer')
    },
  }
}

function tokensOf(err: unknown): number {
  const tokens = (err as { tokensUsed?: unknown } | null)?.tokensUsed
  return typeof tokens === 'number' ? tokens : 0
}

/** The step call, refused once the budget is spent, its tokens counted. */
export function meteredDecideStep(real: DecideStep, budget: Budget): DecideStep {
  return async (input) => {
    budget.assertOpen()
    try {
      const out = await real(input)
      budget.charge(out.tokensUsed)
      return out
    } catch (err) {
      budget.charge(tokensOf(err))
      if (isGroqLimit(err)) budget.noteLimit()
      throw err
    }
  }
}

/** The judge call, refused once the budget is spent, its tokens counted, also when it failed. */
export function meteredAssess(real: AiDeps['assessBatch'], budget: Budget): AiDeps['assessBatch'] {
  return async (input) => {
    budget.assertOpen()
    try {
      const out = await real(input)
      budget.charge(out.tokensUsed)
      return out
    } catch (err) {
      budget.charge(tokensOf(err))
      if (isGroqLimit(err)) budget.noteLimit()
      throw err
    }
  }
}

const GROQ_HOST = 'api.groq.com'

function hostOf(input: RequestInfo | URL): string | null {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname
  } catch {
    return null
  }
}

/**
 * A fetch that refuses every request to Groq once the budget is spent, before it is sent. It covers
 * every AI call the pipeline makes, including tries again after a 429 and the code run's search-words
 * call, which the metered wrappers do not see. Requests to any other host pass untouched.
 */
export function gateGroqFetch(original: typeof fetch, budget: Budget): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (hostOf(input) === GROQ_HOST) budget.assertOpen()
    return original(input, init)
  }) as typeof fetch
}

/** Puts the gate on globalThis.fetch for one repeat. Returns the function that puts the original back. */
export function installGroqGate(budget: Budget): () => void {
  const original = globalThis.fetch
  globalThis.fetch = gateGroqFetch(original, budget)
  return () => {
    globalThis.fetch = original
  }
}

/** A queued capture run of the given source for the case's item. */
export function createRun(repo: MemoryRepo, c: BenchmarkCase, promptVersion: string): Promise<EvidenceRun> {
  return repo.createRun({ projectId: PROJECT_ID, startedBy: STARTED_BY, scope: 'all', source: c.source, checkedItemIds: [c.id], promptVersion })
}

export interface FinishedRun {
  run: EvidenceRun
  suggestion: Suggestion | undefined
  steps: number | null
  lines: string[]
  seconds: number
}

/** What a finished run said about the case's item. No suggestion means no answer at all. */
export function recordOf(c: BenchmarkCase, repeat: number, done: FinishedRun): RepeatRecord {
  const { run, suggestion } = done
  return {
    caseId: c.id,
    source: c.source,
    repeat,
    answer: suggestion === undefined ? null : (suggestion.suggestedResult ?? 'not_settled'),
    reason: suggestion?.reason ?? '',
    quotes: (suggestion?.quotes ?? []).map((q) => ({ text: q.quoteText, verified: q.verified })),
    flags: (suggestion?.flags ?? []).map((f) => f.type),
    runStatus: run.status,
    runError: run.error,
    tokens: run.tokensUsed,
    seconds: done.seconds,
    steps: done.steps,
    lines: done.lines,
  }
}

/** The run as it ended, and the suggestion it made for the case's item, if any. */
export async function finishedRun(repo: MemoryRepo, runId: string, itemId: string): Promise<{ run: EvidenceRun; suggestion: Suggestion | undefined }> {
  const run = await repo.getRun(runId)
  if (run === null) throw new Error('the run disappeared')
  const suggestion = (await repo.listSuggestions(runId)).find((s) => s.itemId === itemId)
  return { run, suggestion }
}
