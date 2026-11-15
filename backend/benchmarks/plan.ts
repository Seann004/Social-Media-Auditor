/** Which cases a benchmark runs, and a rough estimate of the AI calls and tokens it needs. No side effects. */
import { APP_MAX_STEPS_PER_CHECK } from '../src/features/evidence/config.js'
import type { BenchmarkArgs } from './args.js'
import type { BenchmarkCase, CaseSource } from './types.js'

interface SourceEstimate {
  /** AI calls in a usual repeat. */
  typicalCalls: number
  /** AI calls a repeat can make at most, not counting a second try at an unreadable reply. */
  maxCalls: number
  /** Tokens of a usual repeat. */
  tokens: number
}

/**
 * Rough numbers per repeat. App: about ten step calls, then one judge call; at most one call per step
 * allowed plus the judge. The first real run (app-private-off, 2026-11-16) made 8 step calls and the
 * judge call for 12 048 tokens, about 1 300 a call. Code: one search-words call and one judge call; at
 * most a second search and a second judge call when the first could not settle the item.
 */
export const ESTIMATES: Readonly<Record<CaseSource, SourceEstimate>> = {
  app: { typicalCalls: 11, maxCalls: APP_MAX_STEPS_PER_CHECK + 1, tokens: 16_000 },
  repo: { typicalCalls: 2, maxCalls: 4, tokens: 9_000 },
}

export type Selection = { ok: true; cases: BenchmarkCase[] } | { ok: false; error: string }

/** The cases of the chosen source, and of those the ones named with --only, in the order of the case list. */
export function selectCases(all: readonly BenchmarkCase[], args: Pick<BenchmarkArgs, 'only' | 'source'>): Selection {
  const unknown = args.only.filter((id) => !all.some((c) => c.id === id))
  if (unknown.length > 0) return { ok: false, error: `Unknown case id: ${unknown.join(', ')}. Run with --dry-run to list the cases.` }
  const cases = all.filter((c) => (args.source === null || c.source === args.source) && (args.only.length === 0 || args.only.includes(c.id)))
  if (cases.length === 0) return { ok: false, error: 'No case matches both --only and --source.' }
  return { ok: true, cases }
}

export interface Estimate {
  runs: number
  typicalCalls: number
  maxCalls: number
  tokens: number
}

export function estimateOf(cases: readonly BenchmarkCase[], repeats: number): Estimate {
  const per = (pick: (e: SourceEstimate) => number) => cases.reduce((total, c) => total + pick(ESTIMATES[c.source]) * repeats, 0)
  return { runs: cases.length * repeats, typicalCalls: per((e) => e.typicalCalls), maxCalls: per((e) => e.maxCalls), tokens: per((e) => e.tokens) }
}

const num = (n: number): string => n.toLocaleString('en-US')
const counted = (n: number, word: string): string => `${num(n)} ${word}${n === 1 ? '' : 's'}`
const SOURCE_NAMES: Readonly<Record<CaseSource, string>> = { app: 'App', repo: 'Code' }

/** What the plan of a run looks like: the counts, and the estimate against the cap. */
export function planLines(cases: readonly BenchmarkCase[], repeats: number, maxTokens: number): string[] {
  const apps = cases.filter((c) => c.source === 'app').length
  const est = estimateOf(cases, repeats)
  const perCase = `${counted(repeats, 'repeat')} per case`
  const over =
    est.tokens > maxTokens
      ? `; that is more than the token cap of ${num(maxTokens)}, so the run would stop early. Use --only, --source or --repeats, or raise --max-tokens.`
      : `, within the token cap of ${num(maxTokens)}.`
  return [
    `${counted(cases.length, 'case')} (${apps} app, ${cases.length - apps} code), ${perCase}: ${counted(est.runs, 'run')}.`,
    `Estimated AI calls: about ${num(est.typicalCalls)}, at most ${num(est.maxCalls)} (a call may be tried once more on an unreadable reply).`,
    `Estimated tokens: about ${num(est.tokens)}${over}`,
  ]
}

/** One line per case: id, source, expected answer and item. */
export function caseLines(cases: readonly BenchmarkCase[]): string[] {
  const width = Math.max(...cases.map((c) => c.id.length))
  return cases.map((c) => {
    const expected = [c.expected, ...c.alsoAcceptable].join(' or ')
    return `  ${c.id.padEnd(width)}  ${SOURCE_NAMES[c.source].padEnd(4)}  expects ${expected.padEnd(24)}  ${c.item}`
  })
}
