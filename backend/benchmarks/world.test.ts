import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideStep, StepDecisionError } from '../src/features/evidence/appAgent.js'
import { assessBatch } from '../src/features/evidence/assess.js'
import { GroqLimitError } from '../src/lib/groq.js'
import { BudgetReachedError, createBudget } from './execute.js'
import { gateGroqFetch, installGroqGate, meteredAssess, meteredDecideStep } from './world.js'

const GROQ = 'https://api.groq.com/openai/v1/chat/completions'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Groq gate on fetch', () => {
  it('counts the tokens a Groq reply reports, whatever its status, and ignores a reply without usage', async () => {
    const replies = [
      new Response(JSON.stringify({ usage: { total_tokens: 25 } })),
      new Response(JSON.stringify({ error: { code: 'json_validate_failed' }, usage: { total_tokens: 15 } }), { status: 400 }),
      new Response('rate limited', { status: 429 }),
    ]
    const original = vi.fn(async () => replies.shift() as Response)
    const budget = createBudget(1_000)
    const gated = gateGroqFetch(original as unknown as typeof fetch, budget)
    for (let i = 0; i < 3; i++) await gated(GROQ, { method: 'POST' })
    expect(budget.spent()).toBe(40)
    // The caller still reads the reply itself.
    const last = await gateGroqFetch(async () => new Response('{"usage":{"total_tokens":5},"x":1}'), budget)(GROQ)
    expect(await last.json()).toEqual({ usage: { total_tokens: 5 }, x: 1 })
  })

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

/** Groq answering every request with a reply that is not JSON, and the usage of each. */
function unreadableGroq(tokensEach: number) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }], usage: { total_tokens: tokensEach } })))
}

const ITEM = { id: 'i1', guidelineId: 'g', category: 'C', name: null, text: 'Item?', helpText: null }

describe('tokens of AI calls, counted at the Groq gate', () => {
  it('counts the tokens of a real judge call that failed twice, which throws without saying how many it used', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const groq = unreadableGroq(40)
    vi.stubGlobal('fetch', groq)
    const budget = createBudget(10_000)
    const restore = installGroqGate(budget)
    try {
      const input = { items: [ITEM], passages: [{ id: 'p1', pageId: 'pg', position: 1, kind: 'text' as const, text: 'Some text.' }], platform: 'Social', apiKey: 'gsk_test_key_123456', model: 'm' }
      await expect(meteredAssess(assessBatch, budget)(input as never)).rejects.toThrow('Groq returned invalid JSON twice')
    } finally {
      restore()
      vi.unstubAllGlobals()
    }
    expect(groq).toHaveBeenCalledTimes(2)
    expect(budget.spent()).toBe(80)
  })

  it('counts a real step call that failed twice once, not twice', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', unreadableGroq(30))
    const budget = createBudget(10_000)
    const restore = installGroqGate(budget)
    try {
      const prompt = { item: ITEM, platform: 'Social', accounts: [], currentAccount: null, view: null, history: [], leftChanged: [], stepsLeft: 5 }
      await expect(meteredDecideStep(decideStep, budget)({ prompt, apiKey: 'gsk_test_key_123456', model: 'm' })).rejects.toThrow(StepDecisionError)
    } finally {
      restore()
      vi.unstubAllGlobals()
    }
    expect(budget.spent()).toBe(60)
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
