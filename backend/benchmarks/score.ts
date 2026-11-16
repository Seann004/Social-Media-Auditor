/**
 * Scoring, with no side effects: each repeat against the case's known answer, each case's
 * stability across its repeats, the overall numbers, and the floors a fixed answer would reach.
 */
import { EXPECTED_ANSWERS, type Answer, type BenchmarkCase, type CaseScore, type Floors, type Outcome, type RepeatRecord, type Summary } from './types.js'

type Scorable = Pick<BenchmarkCase, 'expected' | 'alsoAcceptable' | 'hedges'>
type Scored = Pick<RepeatRecord, 'answer' | 'quotes' | 'excluded'>

const isClaim = (answer: Answer): boolean => answer !== 'not_settled'
const isExcluded = (r: Pick<RepeatRecord, 'excluded'>): boolean => r.excluded !== undefined && r.excluded !== null

/** A claim the case does not list as a hedge. */
const isRealClaim = (c: Scorable, answer: Answer | null): boolean => answer !== null && isClaim(answer) && !(c.hedges ?? []).includes(answer)

/** The answers a case counts as correct. */
const acceptedOf = (c: Scorable): readonly Answer[] => [c.expected, ...c.alsoAcceptable]

/**
 * An excluded repeat (token cap, daily limit, not run) is an error. Any other repeat without a
 * suggestion is not settled, and never correct: the tool failed, it did not decide. An answer that is
 * not acceptable is wrong when it is a claim and not settled when it is not, or when the case lists
 * it as a hedge. An acceptable claim needs at least one verified quote to be correct; without one it
 * is unproven. A wrong claim is wrong whatever its quotes.
 */
export function scoreRepeat(c: Scorable, r: Scored): Outcome {
  if (isExcluded(r)) return 'error'
  if (r.answer === null) return 'not_settled'
  if (!acceptedOf(c).includes(r.answer)) return isRealClaim(c, r.answer) ? 'wrong' : 'not_settled'
  if (isClaim(r.answer) && !r.quotes.some((q) => q.verified)) return 'unproven'
  return 'correct'
}

/** Repeats are taken in the order given. Stability leaves out excluded repeats; a failed one counts as not settled. */
export function scoreCase(c: BenchmarkCase, repeats: RepeatRecord[]): CaseScore {
  const answered = repeats.filter((r) => !isExcluded(r)).map((r) => r.answer ?? 'not_settled')
  return {
    caseId: c.id,
    source: c.source,
    expected: c.expected,
    alsoAcceptable: [...c.alsoAcceptable],
    answers: repeats.map((r) => r.answer),
    outcomes: repeats.map((r) => scoreRepeat(c, r)),
    claimed: repeats.map((r) => !isExcluded(r) && isRealClaim(c, r.answer)),
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
  const correct = count(outcomes, 'correct')
  const scored = outcomes.length - errors
  const known = scores.filter((s) => s.stable !== null)
  const steps = records.flatMap((r) => (r.steps === null ? [] : [r.steps]))
  const ran = records.filter((r) => r.excluded !== 'not_run')
  return {
    cases: scores.length,
    repeats: outcomes.length,
    scored,
    correct,
    wrong: count(outcomes, 'wrong'),
    notSettled: count(outcomes, 'not_settled'),
    unproven: count(outcomes, 'unproven'),
    errors,
    accuracy: ratio(correct, scored),
    strictAccuracy: ratio(correct, outcomes.length),
    coverage: ratio(claims, scored),
    wrongClaimRate: ratio(count(outcomes, 'wrong'), claims),
    stability: ratio(known.filter((s) => s.stable === true).length, known.length),
    averageSteps: ratio(sum(steps), steps.length),
    totalTokens: sum(records.map((r) => r.tokens)),
    averageTokens: ratio(sum(ran.map((r) => r.tokens)), ran.length),
    totalSeconds: sum(records.map((r) => r.seconds)),
    averageSeconds: ratio(sum(ran.map((r) => r.seconds)), ran.length),
  }
}

/**
 * The accuracy a tool would reach by always giving one answer (with a verified quote for a claim):
 * the share of cases that accept it. A hedge is not correct, so it does not count.
 */
export function constantFloors(cases: readonly Scorable[]): Floors {
  const entries = EXPECTED_ANSWERS.map((answer) => [answer, ratio(cases.filter((c) => acceptedOf(c).includes(answer)).length, cases.length)] as const)
  return Object.fromEntries(entries) as Floors
}
