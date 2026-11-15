import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../src/lib/groq.js'
import { BudgetReachedError, createBudget } from './execute.js'
import { gateGroqFetch, installGroqGate, meteredAssess, meteredDecideStep } from './world.js'

const GROQ = 'https://api.groq.com/openai/v1/chat/completions'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Groq gate on fetch', () => {
  it('lets a Groq call through while the budget is open, and refuses it without calling once the cap is reached', async () => {
    const original = vi.fn(async () => new Response('{}'))
    const budget = createBudget(100)
    const gated = gateGroqFetch(original as unknown as typeof fetch, budget)

    await gated(GROQ, { method: 'POST' })
    expect(original).toHaveBeenCalledTimes(1)

    budget.charge(100)
    await expect(gated(GROQ, { method: 'POST' })).rejects.toThrow(BudgetReachedError)
    await expect(gated(new URL(GROQ))).rejects.toThrow(BudgetReachedError)
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('never stops a request to another host', async () => {
    const original = vi.fn(async () => new Response('ok'))
    const budget = createBudget(1)
    budget.charge(5)
    await gateGroqFetch(original as unknown as typeof fetch, budget)('http://127.0.0.1:4000/login')
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('is installed on globalThis.fetch for a repeat and the original is put back', async () => {
    const before = globalThis.fetch
    const budget = createBudget(1)
    budget.charge(1)
    const restore = installGroqGate(budget)
    try {
      expect(globalThis.fetch).not.toBe(before)
      await expect(globalThis.fetch(GROQ)).rejects.toThrow(BudgetReachedError)
    } finally {
      restore()
    }
    expect(globalThis.fetch).toBe(before)
  })
})

describe('metered AI calls', () => {
  it('meteredAssess counts the tokens of a call that failed, as meteredDecideStep does', async () => {
    const budget = createBudget(10_000)
    const failing = async () => {
      throw Object.assign(new Error('Groq returned invalid JSON twice'), { tokensUsed: 70 })
    }
    await expect(meteredAssess(failing, budget)({} as never)).rejects.toThrow('invalid JSON')
    expect(budget.spent()).toBe(70)

    const step = async () => {
      throw Object.assign(new Error('unusable'), { tokensUsed: 30 })
    }
    await expect(meteredDecideStep(step, budget)({} as never)).rejects.toThrow('unusable')
    expect(budget.spent()).toBe(100)
  })

  it("notes Groq's daily limit from either call", async () => {
    const budget = createBudget(10_000)
    const limited = async () => {
      throw new GroqLimitError(3_600)
    }
    await expect(meteredAssess(limited, budget)({} as never)).rejects.toThrow(GroqLimitError)
    expect(budget.limitHit()).toBe(true)
  })
})
