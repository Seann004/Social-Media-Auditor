/**
 * Runs the cases' repeats in rounds (repeat 1 of every case, then repeat 2, ...), so that a run cut
 * short still has a first answer for as many cases as possible. A hard token cap is shared by every
 * AI call: once it is reached no call starts, and the benchmark stops.
 */
import { appPartialSummary } from '../src/features/evidence/itemRun.js'
import { redactSecrets } from './report.js'
import { scoreRepeat } from './score.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'

/** Thrown by a metered AI call that would start after the cap was reached. */
export class BudgetReachedError extends Error {
  constructor(cap: number) {
    super(`The benchmark's token cap of ${cap} tokens was reached`)
    this.name = 'BudgetReachedError'
  }
}

export interface Budget {
  readonly cap: number
  /** Tokens of finished repeats plus the calls of the repeat in progress. */
  spent(): number
  isReached(): boolean
  /** Throws BudgetReachedError once the cap is reached. Called before every AI call. */
  assertOpen(): void
  /** Counts the tokens of one AI call of the repeat in progress. */
  charge(tokens: number): void
  /** Ends a repeat: counts the larger of its calls and the run's own total (which includes calls not metered here). */
  settle(runTokens: number): void
  /** Notes that Groq's daily limit was hit. */
  noteLimit(): void
  limitHit(): boolean
}

export function createBudget(cap: number): Budget {
  let settled = 0
  let live = 0
  let limit = false
  const spent = () => settled + live
  return {
    cap,
    spent,
    isReached: () => spent() >= cap,
    assertOpen() {
      if (spent() >= cap) throw new BudgetReachedError(cap)
    },
    charge(tokens) {
      live += Math.max(0, tokens)
    },
    settle(runTokens) {
      settled += Math.max(live, runTokens)
      live = 0
    },
    noteLimit() {
      limit = true
    },
    limitHit: () => limit,
  }
}

/** Runs one repeat of one case: a fresh run of the real pipeline, every AI call metered by the budget. */
export type RunRepeat = (c: BenchmarkCase, repeat: number, budget: Budget) => Promise<RepeatRecord>

export interface ExecuteResult {
  records: RepeatRecord[]
  /** Why the benchmark stopped before every repeat ran; null when it ran them all. */
  stoppedEarly: string | null
  tokensUsed: number
}

/** How a run's summary starts when Groq's daily limit stopped it. */
const LIMIT_PREFIX = appPartialSummary('limit', 1).split(';')[0]
const CAP_NOTE = "(the benchmark's token cap was reached during this repeat)"
const num = (n: number): string => n.toLocaleString('en-US')

function notRun(c: BenchmarkCase, repeat: number, err: unknown): RepeatRecord {
  const message = err instanceof Error ? err.message : String(err)
  return {
    caseId: c.id,
    source: c.source,
    repeat,
    answer: null,
    reason: '',
    quotes: [],
    flags: [],
    runStatus: 'not run',
    runError: `The repeat could not run: ${redactSecrets(message)}`,
    tokens: 0,
    seconds: 0,
    steps: null,
    lines: [],
  }
}

function progressLine(index: number, total: number, c: BenchmarkCase, r: RepeatRecord): string {
  const steps = r.steps === null ? '' : `, ${r.steps} steps`
  const head = `[${index}/${total}] ${c.id} #${r.repeat}: ${r.answer ?? 'no suggestion'} → ${scoreRepeat(c, r)}`
  const error = r.answer === null && r.runError ? ` — ${redactSecrets(r.runError)}` : ''
  return `${head} (${num(r.tokens)} tokens, ${r.seconds.toFixed(1)} s${steps})${error}`
}

export async function executeCases(
  cases: readonly BenchmarkCase[],
  repeats: number,
  budget: Budget,
  runRepeat: RunRepeat,
  log: (line: string) => void,
): Promise<ExecuteResult> {
  const total = cases.length * repeats
  const records: RepeatRecord[] = []
  let stoppedEarly: string | null = null
  rounds: for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const c of cases) {
      if (budget.isReached()) {
        stoppedEarly = `The token cap of ${num(budget.cap)} tokens was reached after ${num(budget.spent())} tokens; ${total - records.length} of ${total} repeats were not run. Raise the cap with --max-tokens.`
        break rounds
      }
      if (budget.limitHit()) {
        stoppedEarly = `Groq's daily limit was reached; ${total - records.length} of ${total} repeats were not run. Try again when the limit resets.`
        break rounds
      }
      let record: RepeatRecord
      try {
        record = await runRepeat(c, repeat, budget)
      } catch (err) {
        record = notRun(c, repeat, err)
      }
      budget.settle(record.tokens)
      if (record.answer === null && budget.isReached()) {
        record = { ...record, runError: `${record.runError ?? 'No suggestion'} ${CAP_NOTE}` }
      }
      if (record.runError?.startsWith(LIMIT_PREFIX)) budget.noteLimit()
      records.push(record)
      log(progressLine(records.length, total, c, record))
    }
  }
  if (stoppedEarly === null && records.some((r) => r.runError?.endsWith(CAP_NOTE))) {
    stoppedEarly = `The token cap of ${num(budget.cap)} tokens was reached during the last repeat, which was cut short. Raise the cap with --max-tokens.`
  }
  return { records, stoppedEarly, tokensUsed: budget.spent() }
}
