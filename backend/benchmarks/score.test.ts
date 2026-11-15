import { describe, expect, it } from 'vitest'
import { scoreCase, scoreRepeat, summarise } from './score.js'
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

  it('a repeat without any suggestion is an error, whatever was expected', () => {
    expect(scoreRepeat(aCase('not_settled'), repeat(null))).toBe('error')
    expect(scoreRepeat(aCase('yes'), repeat(null))).toBe('error')
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

  it('leaves errors out of stability, and does not know it with fewer than two answers', () => {
    expect(scoreCase(aCase('yes'), [repeat('yes'), repeat(null), repeat('yes')]).stable).toBe(true)
    expect(scoreCase(aCase('yes'), [repeat('yes'), repeat(null)]).stable).toBeNull()
    expect(scoreCase(aCase('yes'), [repeat('yes')]).stable).toBeNull()
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
      repeat(null, 0, { caseId: 'b', source: 'repo', steps: null, tokens: 0, seconds: 1 }),
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
      totalSeconds: 9,
    })
    expect(summary.accuracy).toBeCloseTo(3 / 4)
    // Two of the four scored repeats made a claim; one of those two was wrong.
    expect(summary.coverage).toBeCloseTo(2 / 4)
    expect(summary.wrongClaimRate).toBeCloseTo(1 / 2)
    // Case a varied (yes, no); case b was stable.
    expect(summary.stability).toBeCloseTo(1 / 2)
    expect(summary.averageSteps).toBeCloseTo(8)
    expect(summary.averageTokens).toBeCloseTo(100)
    expect(summary.averageSeconds).toBeCloseTo(9 / 5)
  })

  it('gives null rates when there is nothing to divide by', () => {
    const summary = summarise([scoreCase(aCase('yes'), [repeat(null, 0, { steps: null })])], [repeat(null, 0, { steps: null })])
    expect(summary).toMatchObject({ accuracy: null, coverage: null, wrongClaimRate: null, stability: null, averageSteps: null, errors: 1 })
  })

  it('gives null averages for an empty run', () => {
    expect(summarise([], [])).toMatchObject({ cases: 0, repeats: 0, averageTokens: null, averageSeconds: null, totalTokens: 0 })
  })
})
