/**
 * The shapes the benchmark shares: a case with its known answer, what one repeat of it produced,
 * and how that repeat is scored.
 */
import type { SocialMode, SocialStatePatch } from '../src/features/evidence/__fixtures__/socialApp.js'
/** What the tool can answer for an item. `not_settled` is a suggestion with no result. */
export type Answer = 'yes' | 'no' | 'partially' | 'not_applicable' | 'not_settled'

/** What a case may expect. `not_applicable` is never the expected answer, only an acceptable one. */
export type ExpectedAnswer = 'yes' | 'no' | 'partially' | 'not_settled'

export const ANSWERS: readonly Answer[] = ['yes', 'no', 'partially', 'not_applicable', 'not_settled']
export const EXPECTED_ANSWERS: readonly ExpectedAnswer[] = ['yes', 'no', 'partially', 'not_settled']

export type CaseSource = 'app' | 'repo'

/** What a case tests, so that the set can be checked to cover every kind the design asks for. */
export type CaseKind = 'clear' | 'default' | 'cannot_show' | 'trap' | 'second_page' | 'two_accounts'

/** The state the practice app starts in for an app case. Every repeat starts a fresh app in this state. */
export interface AppSetup {
  state?: SocialStatePatch
  /** Added to the modes every app case runs with (BASE_APP_MODE in cases.ts). */
  mode?: Partial<SocialMode>
}

export interface BenchmarkCase {
  /** Lower case letters, digits and dashes; unique. */
  id: string
  source: CaseSource
  /** The checklist category the item is filed under. */
  category: string
  /** The checklist item, as an auditor would read it. */
  item: string
  expected: ExpectedAnswer
  /** Other answers that also count as correct. */
  alsoAcceptable: Answer[]
  /**
   * Answers that are an honest hedge here rather than a wrong claim: scored as not settled, never as
   * wrong, and not counted as claims. For a case whose answer can be missed honestly (on a second page).
   */
  hedges?: Answer[]
  /** Why the expected answer is right, from what the practice app or the synthetic repository really contain. */
  why: string
  kinds: CaseKind[]
  /** App cases only: the practice app's starting state and modes. */
  app?: AppSetup
}

/** One quote of a suggestion, and whether the tool could find it in what it sent. */
export interface RepeatQuote {
  text: string
  verified: boolean
}

/** What one repeat of one case produced. A repeat is one fresh run of the real pipeline. */
export interface RepeatRecord {
  caseId: string
  source: CaseSource
  /** From 1. */
  repeat: number
  /** Null when the run left the item without any suggestion (the run failed, a limit, the token cap). */
  answer: Answer | null
  reason: string
  quotes: RepeatQuote[]
  flags: string[]
  runStatus: string
  runError: string | null
  tokens: number
  seconds: number
  /** App cases: the steps the check recorded. Null for code cases. */
  steps: number | null
  /** App cases: the step lines. Code cases: the pieces of code the judge was sent. */
  lines: string[]
}

/**
 * - correct: the answer is the expected one or an acceptable one (with a verified quote, if it is a claim);
 * - wrong: a different claim;
 * - not_settled: no result, where a claim was expected;
 * - unproven: the right claim, but none of its quotes could be found in what was sent;
 * - error: no suggestion at all, so the repeat says nothing about the AI's judgement.
 */
export type Outcome = 'correct' | 'wrong' | 'not_settled' | 'unproven' | 'error'

export interface CaseScore {
  caseId: string
  source: CaseSource
  expected: ExpectedAnswer
  alsoAcceptable: Answer[]
  answers: (Answer | null)[]
  outcomes: Outcome[]
  /** Per repeat: whether it made a claim, that is an answer other than not settled or one of the case's hedges. */
  claimed: boolean[]
  /** Every repeat that gave a suggestion gave the same answer. Null with fewer than two such repeats. */
  stable: boolean | null
}

export interface Summary {
  cases: number
  repeats: number
  /** Repeats with a suggestion: the ones that count for accuracy and coverage. */
  scored: number
  correct: number
  wrong: number
  notSettled: number
  unproven: number
  errors: number
  /** correct / scored. */
  accuracy: number | null
  /** Repeats that made a claim (any answer but not_settled) / scored. */
  coverage: number | null
  /** wrong / claims. */
  wrongClaimRate: number | null
  /** Stable cases / cases whose stability is known. */
  stability: number | null
  /** Over app repeats only. */
  averageSteps: number | null
  totalTokens: number
  averageTokens: number | null
  totalSeconds: number
  averageSeconds: number | null
}
