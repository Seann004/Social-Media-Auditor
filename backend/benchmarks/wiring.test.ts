import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { AppAction } from '../src/features/evidence/appTypes.js'
import type { AssessInput, AssessOutput } from '../src/features/evidence/assess.js'
import { closeBrowser } from '../src/features/evidence/browser.js'
import { openPath, signIn } from '../src/features/evidence/__fixtures__/checkWorld.js'
import { scriptedAgent } from '../src/features/evidence/__fixtures__/fakeAgent.js'
import { TEST_TIMEOUT_MS } from '../src/features/evidence/__fixtures__/pages.js'
import { runAppRepeat } from './appRepeat.js'
import { CASES } from './cases.js'
import { BudgetReachedError, createBudget, type Budget } from './execute.js'
import { runRepoRepeat } from './repoRepeat.js'
import type { BenchmarkCase } from './types.js'
import type { AiDeps } from './world.js'

/**
 * The benchmark's wiring through the real pipeline, with the AI faked: the practice app, the test
 * accounts, the faked GitHub and the record a repeat produces. No call leaves the machine.
 */

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS * 2 })

const caseOf = (id: string): BenchmarkCase => CASES.find((c) => c.id === id) as BenchmarkCase
const neverStep: AiDeps['decideStep'] = async () => {
  throw new Error('a code repeat never asks for a step')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await closeBrowser()
})

describe('a code repeat', () => {
  it('reads the synthetic repository from the faked GitHub and records the answer, quotes, pieces and tokens', async () => {
    const groq = vi.fn(async () => {
      const content = { items: [{ itemId: 'repo-block', words: ['blockUser', 'hasBlocked'], pathHints: ['safety'] }] }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 50 } }))
    })
    vi.stubGlobal('fetch', groq)
    const judged: AssessInput[] = []
    const assessBatch = async (input: AssessInput): Promise<AssessOutput> => {
      judged.push(input)
      const passage = input.passages.find((p) => p.text.includes('export function blockUser')) ?? input.passages[0]
      return {
        results: [{ itemId: 'repo-block', suggestedResult: 'yes', reason: 'blockUser exists.', quotes: [{ passageId: passage.id, text: 'export function blockUser(blockerId: string, blockedId: string): void {' }], evidenceSufficient: true, conflicting: false, webAssessable: true, confidence: 'high' }],
        missingItemIds: [],
        tokensUsed: 100,
      }
    }
    const budget = createBudget(10_000)

    const record = await runRepoRepeat(caseOf('repo-block'), 2, { apiKey: 'gsk_test_key_123456', model: 'test-model', ai: { decideStep: neverStep, assessBatch }, budget })

    expect(record).toMatchObject({ caseId: 'repo-block', source: 'repo', repeat: 2, answer: 'yes', runStatus: 'completed', runError: null, tokens: 150, steps: null })
    expect(record.quotes).toEqual([{ text: 'export function blockUser(blockerId: string, blockedId: string): void {', verified: true }])
    expect(record.lines.some((l) => l.startsWith('File src/safety/block.ts, lines '))).toBe(true)
    expect(judged[0].items[0]).toMatchObject({ id: 'repo-block', text: 'Can a user block another account so that it can no longer message them?' })
    // Only the search-words call went out through fetch, and only to Groq.
    expect(groq).toHaveBeenCalledTimes(1)
    expect(String((groq.mock.calls[0] as unknown[])[0])).toContain('api.groq.com')
    // The judge call went through the budget.
    expect(budget.spent()).toBe(100)
  })

  it('starts no run, and so no AI call, once the budget is spent', async () => {
    const groq = vi.fn()
    vi.stubGlobal('fetch', groq)
    const assessBatch = vi.fn()
    const budget = createBudget(1)
    budget.charge(5)
    await expect(runRepoRepeat(caseOf('repo-block'), 1, { apiKey: 'gsk_test_key_123456', model: 'test-model', ai: { decideStep: neverStep, assessBatch }, budget })).rejects.toThrow(BudgetReachedError)
    expect(groq).not.toHaveBeenCalled()
    expect(assessBatch).not.toHaveBeenCalled()
  })

  it('leaves the item without a suggestion when the cap is reached between the search words and the judge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }], usage: { total_tokens: 10 } }))))
    const assessBatch = vi.fn()
    // The check before the run passes; the one before the judge call finds the cap reached.
    const real = createBudget(1_000)
    let checks = 0
    const budget: Budget = {
      ...real,
      assertOpen: () => {
        checks += 1
        if (checks > 1) throw new BudgetReachedError(1_000)
      },
    }
    const record = await runRepoRepeat(caseOf('repo-block'), 1, { apiKey: 'gsk_test_key_123456', model: 'test-model', ai: { decideStep: neverStep, assessBatch }, budget })
    expect(checks).toBe(2)
    expect(assessBatch).not.toHaveBeenCalled()
    expect(record.answer).toBeNull()
    expect(record.runStatus).toBe('partial')
  })
})

describe('an app repeat', () => {
  it('starts the practice app in the case state, signs in with the test accounts and records the steps', async () => {
    const finish: AppAction = { type: 'finish', observations: 'The switch is off.', evidenceSteps: [6] }
    const agent = scriptedAgent([...signIn('Teen 15'), openPath('/home'), openPath('/settings'), finish, finish])
    let judgedInput: AssessInput | null = null
    const assessBatch = async (input: AssessInput): Promise<AssessOutput> => {
      judgedInput = input
      // A page passage (not a step line), as the real judge is asked to quote.
      const passage = input.passages.find((p) => p.position > 0 && p.text.includes('Private account Off'))
      if (passage === undefined) throw new Error(`No page passage with "Private account Off":\n${input.passages.map((p) => `[${p.position}] ${p.text}`).join('\n---\n')}`)
      return {
        results: [{ itemId: 'app-private-off', suggestedResult: 'no', reason: 'The switch is off.', quotes: [{ passageId: passage.id, text: 'Private account Off' }], evidenceSufficient: true, conflicting: false, webAssessable: true, confidence: 'high' }],
        missingItemIds: [],
        tokensUsed: 300,
      }
    }
    const budget = createBudget(100_000)

    const record = await runAppRepeat(caseOf('app-private-off'), 1, { apiKey: 'gsk_test_key_123456', model: 'test-model', ai: { decideStep: agent, assessBatch }, budget })

    expect(record).toMatchObject({ caseId: 'app-private-off', source: 'app', answer: 'no', runStatus: 'completed', runError: null })
    expect(record.quotes[0]).toEqual({ text: 'Private account Off', verified: true })
    expect(record.steps).toBe(record.lines.length)
    expect(record.lines[3]).toMatch(/^Step 4 · Teen 15 · clicked/)
    // The case's state: the switch is off for Teen 15, and the settings menu every app case gets is there.
    const settings = agent.prompts.find((p) => p.view?.url.endsWith('/settings'))
    const toggle = settings?.view?.elements.find((el) => el.role === 'switch')
    expect(toggle?.state.checked).toBe(false)
    expect(settings?.view?.elements.some((el) => el.role === 'link' && el.name === 'Notifications')).toBe(true)
    expect(judgedInput).not.toBeNull()
    // Six step calls of 100 tokens (one finish refused as too early) and the judge's 300.
    expect(record.tokens).toBe(agent.prompts.length * 100 + 300)
    expect(budget.spent()).toBe(record.tokens)
  })
})
