import { describe, expect, it } from 'vitest'
import { BudgetReachedError, createBudget, executeCases, type RunRepeat } from './execute.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'

const aCase = (id: string): BenchmarkCase => ({
  id,
  source: 'repo',
  category: 'C',
  item: `Item ${id}?`,
  expected: 'yes',
  alsoAcceptable: [],
  why: 'Because.',
  kinds: ['clear'],
})

const CASES = [aCase('a'), aCase('b')]

function record(c: BenchmarkCase, repeat: number, over: Partial<RepeatRecord> = {}): RepeatRecord {
  return {
    caseId: c.id,
    source: c.source,
    repeat,
    answer: 'yes',
    reason: '',
    quotes: [{ text: 'q', verified: true }],
    flags: [],
    runStatus: 'completed',
    runError: null,
    tokens: 0,
    seconds: 1,
    steps: null,
    lines: [],
    ...over,
  }
}

/** A fake pipeline: each AI call goes through the budget, as the metered real calls do. */
function fakeRepeat(callsPerRepeat: number, tokensPerCall: number, calls: string[] = []): RunRepeat {
  return async (c, repeat, budget) => {
    let used = 0
    for (let i = 0; i < callsPerRepeat; i++) {
      try {
        budget.assertOpen()
      } catch (err) {
        if (err instanceof BudgetReachedError) return record(c, repeat, { answer: null, runStatus: 'partial', runError: '1 item could not be checked', tokens: used })
        throw err
      }
      calls.push(`${c.id}#${repeat}`)
      budget.charge(tokensPerCall)
      used += tokensPerCall
    }
    return record(c, repeat, { tokens: used })
  }
}

const quiet = () => undefined

describe('createBudget', () => {
  it('counts live calls, settles each repeat at the larger of its own count and the run total, and closes at the cap', () => {
    const budget = createBudget(1_000)
    budget.charge(300)
    expect(budget.spent()).toBe(300)
    budget.settle(450)
    expect(budget.spent()).toBe(450)
    budget.charge(200)
    budget.settle(100)
    expect(budget.spent()).toBe(650)
    expect(budget.isReached()).toBe(false)
    budget.charge(350)
    expect(budget.isReached()).toBe(true)
    expect(() => budget.assertOpen()).toThrow(BudgetReachedError)
  })
})

describe('executeCases', () => {
  it('runs repeat 1 of every case before repeat 2, and keeps the records in that order', async () => {
    const calls: string[] = []
    const result = await executeCases(CASES, 2, createBudget(1_000_000), fakeRepeat(1, 10, calls), quiet)
    expect(calls).toEqual(['a#1', 'b#1', 'a#2', 'b#2'])
    expect(result.records.map((r) => `${r.caseId}#${r.repeat}`)).toEqual(['a#1', 'b#1', 'a#2', 'b#2'])
    expect(result.stoppedEarly).toBeNull()
    expect(result.tokensUsed).toBe(40)
  })

  it('stops once the token cap is reached, starting no AI call after it, and says how to raise it', async () => {
    const calls: string[] = []
    // Each repeat makes 3 calls of 100 tokens; the cap of 450 is reached during the second repeat.
    const result = await executeCases(CASES, 3, createBudget(450), fakeRepeat(3, 100, calls), quiet)
    expect(calls).toEqual(['a#1', 'a#1', 'a#1', 'b#1', 'b#1'])
    expect(result.records.map((r) => [r.caseId, r.repeat, r.answer])).toEqual([
      ['a', 1, 'yes'],
      ['b', 1, null],
    ])
    expect(result.records[1].runError).toContain("the benchmark's token cap was reached")
    expect(result.stoppedEarly).toBe('The token cap of 450 tokens was reached after 500 tokens; 4 of 6 repeats were not run. Raise the cap with --max-tokens.')
  })

  it('says so when the cap cut the last repeat short', async () => {
    const result = await executeCases([aCase('a')], 1, createBudget(150), fakeRepeat(3, 100), quiet)
    expect(result.records).toHaveLength(1)
    expect(result.stoppedEarly).toBe('The token cap of 150 tokens was reached during the last repeat, which was cut short. Raise the cap with --max-tokens.')
  })

  it("stops after Groq's daily limit, which would fail every later repeat too", async () => {
    let n = 0
    const limited: RunRepeat = async (c, repeat) => {
      n += 1
      return n === 2 ? record(c, repeat, { answer: null, runStatus: 'partial', runError: 'AI daily limit reached; 1 item not checked' }) : record(c, repeat)
    }
    const result = await executeCases(CASES, 2, createBudget(1_000_000), limited, quiet)
    expect(result.records).toHaveLength(2)
    expect(result.stoppedEarly).toBe("Groq's daily limit was reached; 2 of 4 repeats were not run. Try again when the limit resets.")
  })

  it('records a repeat that threw as an error and goes on', async () => {
    const throwing: RunRepeat = async (c, repeat) => {
      if (c.id === 'a') throw new Error('the browser could not start, key gsk_secret123456')
      return record(c, repeat)
    }
    const lines: string[] = []
    const result = await executeCases(CASES, 1, createBudget(1_000_000), throwing, (line) => lines.push(line))
    expect(result.records[0]).toMatchObject({ caseId: 'a', answer: null, runStatus: 'not run', tokens: 0 })
    expect(result.records[0].runError).toContain('the browser could not start')
    expect(result.records[0].runError).not.toContain('gsk_secret123456')
    expect(result.records[1]).toMatchObject({ caseId: 'b', answer: 'yes' })
    expect(lines.join('\n')).not.toContain('gsk_secret123456')
  })

  it('logs one progress line per repeat', async () => {
    const lines: string[] = []
    await executeCases(CASES, 1, createBudget(1_000_000), fakeRepeat(1, 10), (line) => lines.push(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[1\/2\] a #1: yes → correct/)
  })
})
