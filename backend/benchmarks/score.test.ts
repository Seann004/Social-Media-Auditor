import { describe, expect, it } from 'vitest'
import { constantFloors, scoreCase, scoreRepeat, summarise } from './score.js'
import type { Answer, BenchmarkCase, ExpectedAnswer, RepeatRecord } from './types.js'

function aCase(expected: ExpectedAnswer, alsoAcceptable: Answer[] = [], over: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return { id: 'c1', source: 'app', category: 'Privacy', item: 'Item?', expected, alsoAcceptable, why: 'Because.', kinds: ['clear'], ...over }
}

/** A fake AI output for one repeat: the answer, and how many of its quotes verified. */
function repeat(answer: Answer | null, verified = 1, over: Partial<RepeatRecord> = {}): RepeatRecord {
  const quotes = answer === null || answer === 'not_settled' ? [] : [{ text: 'quoted', verified: verified > 0 }]
  return {
    caseId: 'c1',
    source: 'app',
    repeat: 1,
    answer,
    reason: 'The AI said so.',
    quotes,
    flags: [],
    runStatus: answer === null ? 'partial' : 'completed',
    runError: null,
    tokens: 1_000,
    seconds: 10,
    steps: 8,
    lines: [],
    ...over,
  }
}

describe('scoreRepeat', () => {
  it('a claim equal to the expected answer, with a verified quote, is correct', () => {
    expect(scoreRepeat(aCase('yes'), repeat('yes'))).toBe('correct')
  })

  it('an also-acceptable answer is correct', () => {
    expect(scoreRepeat(aCase('not_settled', ['partially']), repeat('partially'))).toBe('correct')
  })

  it('no result is correct when no result is expected, without any quote', () => {
    expect(scoreRepeat(aCase('not_settled'), repeat('not_settled'))).toBe('correct')
  })

  it('a different claim is wrong', () => {
    expect(scoreRepeat(aCase('no'), repeat('yes'))).toBe('wrong')
    expect(scoreRepeat(aCase('not_settled'), repeat('no'))).toBe('wrong')
    expect(scoreRepeat(aCase('yes'), repeat('partially'))).toBe('wrong')
  })

  it('a wrong claim stays wrong even when none of its quotes verified', () => {
    expect(scoreRepeat(aCase('no'), repeat('yes', 0))).toBe('wrong')
  })

  it('no result where a claim was expected is not settled', () => {
    expect(scoreRepeat(aCase('yes'), repeat('not_settled'))).toBe('not_settled')
  })

  it('the right claim with no verified quote is unproven', () => {
    expect(scoreRepeat(aCase('yes'), repeat('yes', 0))).toBe('unproven')
    expect(scoreRepeat(aCase('yes'), repeat('yes', 0, { quotes: [] }))).toBe('unproven')
  })

  it('one verified quote among unverified ones is enough', () => {
    const record = repeat('no', 1, { quotes: [{ text: 'a', verified: false }, { text: 'b', verified: true }] })
    expect(scoreRepeat(aCase('no'), record)).toBe('correct')
  })

  it('a hedge the case lists counts as not settled, never as wrong', () => {
    const c = aCase('yes', [], { hedges: ['partially', 'not_settled'] })
    expect(scoreRepeat(c, repeat('partially'))).toBe('not_settled')
    expect(scoreRepeat(c, repeat('no'))).toBe('wrong')
    expect(scoreRepeat(c, repeat('yes'))).toBe('correct')
  })

  it('a repeat stopped by the token cap, the daily limit or never run is an error, whatever was expected', () => {
    for (const excluded of ['token_cap', 'daily_limit', 'not_run'] as const) {
      expect(scoreRepeat(aCase('not_settled'), repeat(null, 0, { excluded }))).toBe('error')
      expect(scoreRepeat(aCase('yes'), repeat(null, 0, { excluded }))).toBe('error')
    }
  })

  it('any other repeat without a suggestion counts as not settled, and never as correct', () => {
    expect(scoreRepeat(aCase('yes'), repeat(null))).toBe('not_settled')
    expect(scoreRepeat(aCase('not_settled'), repeat(null))).toBe('not_settled')
  })
})

describe('scoreCase', () => {
  it('lists the answers and outcomes in repeat order and is stable when every answer agrees', () => {
    const score = scoreCase(aCase('yes'), [repeat('yes'), repeat('yes', 0), repeat('yes')])
    expect(score.answers).toEqual(['yes', 'yes', 'yes'])
    expect(score.outcomes).toEqual(['correct', 'unproven', 'correct'])
    expect(score.stable).toBe(true)
  })

  it('is not stable when the answers vary', () => {
    expect(scoreCase(aCase('yes'), [repeat('yes'), repeat('not_settled')]).stable).toBe(false)
  })

  it('leaves errors out of stability, counts a failed repeat as not settled, and does not know it with fewer than two answers', () => {
    const capped = repeat(null, 0, { excluded: 'token_cap' })
    expect(scoreCase(aCase('yes'), [repeat('yes'), capped, repeat('yes')]).stable).toBe(true)
    expect(scoreCase(aCase('yes'), [repeat('yes'), capped]).stable).toBeNull()
    expect(scoreCase(aCase('yes'), [repeat('yes')]).stable).toBeNull()
    expect(scoreCase(aCase('yes'), [repeat('not_settled'), repeat(null)]).stable).toBe(true)
    expect(scoreCase(aCase('yes'), [repeat('yes'), repeat(null)]).stable).toBe(false)
  })
})

describe('summarise', () => {
  it('works out accuracy, coverage, wrong-claim rate, stability, steps, tokens and seconds', () => {
    const yes = aCase('yes', [], { id: 'a' })
    const unsettled = aCase('not_settled', [], { id: 'b', source: 'repo' })
    const records = [
      repeat('yes', 1, { caseId: 'a', steps: 6, tokens: 100, seconds: 2 }),
      repeat('no', 1, { caseId: 'a', steps: 10, tokens: 300, seconds: 4 }),
      repeat('not_settled', 0, { caseId: 'b', source: 'repo', steps: null, tokens: 50, seconds: 1 }),
      repeat('not_settled', 0, { caseId: 'b', source: 'repo', steps: null, tokens: 50, seconds: 1 }),
      repeat(null, 0, { caseId: 'b', source: 'repo', steps: null, tokens: 0, seconds: 0, runStatus: 'not run', excluded: 'not_run' }),
    ]
    const scores = [scoreCase(yes, records.slice(0, 2)), scoreCase(unsettled, records.slice(2))]
    const summary = summarise(scores, records)

    expect(summary).toMatchObject({
      cases: 2,
      repeats: 5,
      scored: 4,
      correct: 3,
      wrong: 1,
      notSettled: 0,
      unproven: 0,
      errors: 1,
      totalTokens: 500,
      totalSeconds: 8,
    })
    expect(summary.accuracy).toBeCloseTo(3 / 4)
    // Strict: the error counts as not settled.
    expect(summary.strictAccuracy).toBeCloseTo(3 / 5)
    // Two of the four scored repeats made a claim; one of those two was wrong.
    expect(summary.coverage).toBeCloseTo(2 / 4)
    expect(summary.wrongClaimRate).toBeCloseTo(1 / 2)
    // Case a varied (yes, no); case b was stable.
    expect(summary.stability).toBeCloseTo(1 / 2)
    expect(summary.averageSteps).toBeCloseTo(8)
    // Averages over the four repeats that ran.
    expect(summary.averageTokens).toBeCloseTo(125)
    expect(summary.averageSeconds).toBeCloseTo(2)
  })

  it('counts a repeat that failed for another reason as scored and not settled', () => {
    const records = [repeat('yes'), repeat(null, 0, { runError: '1 item could not be checked' })]
    const summary = summarise([scoreCase(aCase('yes'), records)], records)
    expect(summary).toMatchObject({ scored: 2, correct: 1, notSettled: 1, errors: 0 })
    expect(summary.accuracy).toBeCloseTo(1 / 2)
    expect(summary.strictAccuracy).toBeCloseTo(1 / 2)
  })

  it('does not count a hedge as a claim', () => {
    const c = aCase('yes', [], { hedges: ['partially'] })
    const records = [repeat('partially'), repeat('yes')]
    const summary = summarise([scoreCase(c, records)], records)
    expect(summary.coverage).toBeCloseTo(1 / 2)
    expect(summary.wrongClaimRate).toBe(0)
    expect(summary.notSettled).toBe(1)
  })

  it('gives null rates when there is nothing to divide by', () => {
    const capped = repeat(null, 0, { steps: null, excluded: 'token_cap' })
    const summary = summarise([scoreCase(aCase('yes'), [capped])], [capped])
    expect(summary).toMatchObject({ accuracy: null, coverage: null, wrongClaimRate: null, stability: null, averageSteps: null, errors: 1, strictAccuracy: 0 })
  })

  it('gives null averages for an empty run', () => {
    expect(summarise([], [])).toMatchObject({ cases: 0, repeats: 0, averageTokens: null, averageSeconds: null, totalTokens: 0, strictAccuracy: null })
  })
})

describe('constantFloors', () => {
  it('is the share of cases a tool giving one fixed answer would get right; a hedge is not right', () => {
    const cases = [
      aCase('yes', [], { id: 'a' }),
      aCase('no', [], { id: 'b' }),
      aCase('not_settled', ['partially'], { id: 'c' }),
      aCase('yes', [], { id: 'd', hedges: ['partially', 'not_settled'] }),
    ]
    expect(constantFloors(cases)).toEqual({ yes: 0.5, no: 0.25, partially: 0.25, not_settled: 0.25 })
    expect(constantFloors([])).toEqual({ yes: null, no: null, partially: null, not_settled: null })
  })
})
