/**
 * Scoring, with no side effects: each repeat against the case's known answer, each case's
 * stability across its repeats, and the overall numbers.
 */
import type { Answer, BenchmarkCase, CaseScore, Outcome, RepeatRecord, Summary } from './types.js'

type Scorable = Pick<BenchmarkCase, 'expected' | 'alsoAcceptable' | 'hedges'>

const isClaim = (answer: Answer): boolean => answer !== 'not_settled'

/** A claim the case does not list as a hedge. */
const isRealClaim = (c: Scorable, answer: Answer | null): boolean => answer !== null && isClaim(answer) && !(c.hedges ?? []).includes(answer)

/**
 * A repeat without a suggestion is an error. An answer that is not acceptable is wrong when it is a
 * claim and not settled when it is not, or when the case lists it as a hedge. An acceptable claim
 * needs at least one verified quote to be correct; without one it is unproven. A wrong claim is wrong
 * whatever its quotes.
 */
export function scoreRepeat(c: Scorable, r: Pick<RepeatRecord, 'answer' | 'quotes'>): Outcome {
  if (r.answer === null) return 'error'
  const accepted: readonly Answer[] = [c.expected, ...c.alsoAcceptable]
  if (!accepted.includes(r.answer)) return isRealClaim(c, r.answer) ? 'wrong' : 'not_settled'
  if (isClaim(r.answer) && !r.quotes.some((q) => q.verified)) return 'unproven'
  return 'correct'
}

/** Repeats are taken in the order given. Stability counts only the repeats that gave a suggestion. */
export function scoreCase(c: BenchmarkCase, repeats: RepeatRecord[]): CaseScore {
  const answered = repeats.flatMap((r) => (r.answer === null ? [] : [r.answer]))
  return {
    caseId: c.id,
    source: c.source,
    expected: c.expected,
    alsoAcceptable: [...c.alsoAcceptable],
    answers: repeats.map((r) => r.answer),
    outcomes: repeats.map((r) => scoreRepeat(c, r)),
    claimed: repeats.map((r) => isRealClaim(c, r.answer)),
    stable: answered.length < 2 ? null : answered.every((a) => a === answered[0]),
  }
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole)
const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0)
const count = (outcomes: Outcome[], wanted: Outcome): number => outcomes.filter((o) => o === wanted).length

/** The overall numbers of a set of scored cases and the repeats they were scored from. */
export function summarise(scores: CaseScore[], records: RepeatRecord[]): Summary {
  const outcomes = scores.flatMap((s) => s.outcomes)
  const claims = scores.flatMap((s) => s.claimed).filter(Boolean).length
  const errors = count(outcomes, 'error')
  const scored = outcomes.length - errors
  const known = scores.filter((s) => s.stable !== null)
  const steps = records.flatMap((r) => (r.steps === null ? [] : [r.steps]))
  const totalTokens = sum(records.map((r) => r.tokens))
  const totalSeconds = sum(records.map((r) => r.seconds))
  return {
    cases: scores.length,
    repeats: outcomes.length,
    scored,
    correct: count(outcomes, 'correct'),
    wrong: count(outcomes, 'wrong'),
    notSettled: count(outcomes, 'not_settled'),
    unproven: count(outcomes, 'unproven'),
    errors,
    accuracy: ratio(count(outcomes, 'correct'), scored),
    coverage: ratio(claims, scored),
    wrongClaimRate: ratio(count(outcomes, 'wrong'), claims),
    stability: ratio(known.filter((s) => s.stable === true).length, known.length),
    averageSteps: ratio(sum(steps), steps.length),
    totalTokens,
    averageTokens: ratio(totalTokens, records.length),
    totalSeconds,
    averageSeconds: ratio(totalSeconds, records.length),
  }
}
