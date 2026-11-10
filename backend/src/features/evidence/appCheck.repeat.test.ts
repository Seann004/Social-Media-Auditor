import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StepPrompt } from './appAgent.js'
import { REPEATED_ACTION } from './appCheck.js'
import { closeBrowser } from './browser.js'
import { TEST_TIMEOUT_MS } from './__fixtures__/pages.js'
import { makeAccount, startAppWorld, type AppWorld } from './__fixtures__/appWorld.js'
import { createCheckKit, on, openPath, signIn, type CheckKit } from './__fixtures__/checkWorld.js'
import { refOf } from './__fixtures__/fakeAgent.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS * 3 })

let world: AppWorld
let kit: CheckKit

beforeEach(async () => {
  world = await startAppWorld()
  kit = createCheckKit(world)
})

afterEach(async () => {
  await kit.pool.closeAll()
  await world.close()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeBrowser()
})

const FINISH = { type: 'finish', observations: 'Seen.', evidenceSteps: [] } as const
const fillLogin = (p: StepPrompt) => ({ type: 'fill_credential', ref: refOf(p, 'textbox', 'Username'), account: 'Teen 15', field: 'login' }) as const

describe('runCheck: the same action again on an unchanged page', () => {
  it('refuses an identical repeat that changed nothing, records it, and shows the AI why', async () => {
    const [switchTo] = signIn('Teen 15')
    const { outcome, agent } = await kit.check([switchTo, fillLogin, fillLogin, fillLogin, FINISH, FINISH])
    expect(outcome.steps.map((s) => s.outcome).slice(0, 4)).toEqual(['done', 'done', 'refused', 'refused'])
    expect(outcome.steps[2]).toMatchObject({ refusalReason: REPEATED_ACTION })
    // A hint to change tactics, like the early-finish nudge: not a safety refusal.
    expect(outcome.steps[2].line).toBe(`Step 3 · Teen 15 · Asked to look further: filled the login of Teen 15 into "Username". ${REPEATED_ACTION}`)
    expect(agent.prompts[3].history.at(-1)).toContain(REPEATED_ACTION)
    // Not the early-finish nudge: the first finish after it is still refused as too early.
    expect(outcome.steps[4]).toMatchObject({ outcome: 'refused', refusalReason: expect.stringMatching(/^Finished too early/) })
  })

  it('a refused repeat counts as a step, so a looping AI still stops at the step limit', async () => {
    const [switchTo] = signIn('Teen 15')
    const { outcome, agent } = await kit.check([switchTo, ...Array.from({ length: 10 }, () => fillLogin)], {}, { maxSteps: 5 })
    expect(outcome.steps).toHaveLength(5)
    expect(agent.prompts).toHaveLength(5)
    expect(outcome.steps.slice(2).every((s) => s.refusalReason === REPEATED_ACTION)).toBe(true)
  })

  it('allows the same click again when the last one changed the page', async () => {
    const wrongTeen = makeAccount(
      { id: 'acc-teen', label: 'Teen 15', ageGroup: 'under_18', age: 15, loginName: 'teen.login@example.test', handles: ['teen15'] },
      'Not-The-Password',
      world.secretKey,
    )
    await kit.pool.closeAll()
    kit = createCheckKit(world, [wrongTeen, world.adult])
    // The first click shows "Wrong password", so the second click is not a repeat on an unchanged page.
    const { outcome } = await kit.check([...signIn('Teen 15'), on('button', 'Sign in'), FINISH])
    expect(outcome.steps[3].line).toContain('now showing: "Wrong password"')
    expect(outcome.steps[4].outcome).toBe('done')
  })

  it('allows the same kind of action on a different field', async () => {
    const { outcome } = await kit.check([...signIn('Teen 15'), FINISH])
    expect(outcome.steps.slice(0, 4).map((s) => s.outcome)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('allows the same action again once something else happened in between', async () => {
    const [switchTo] = signIn('Teen 15')
    const fillPassword = (p: StepPrompt) => ({ type: 'fill_credential', ref: refOf(p, 'textbox', 'Password'), account: 'Teen 15', field: 'password' }) as const
    const { outcome } = await kit.check([switchTo, fillLogin, fillPassword, fillLogin, FINISH])
    expect(outcome.steps.slice(0, 4).map((s) => s.outcome)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('allows toggling the same switch again: its state changed, though the page text did not', async () => {
    const toggle = on('switch', 'Private account', 'toggle')
    const { outcome } = await kit.check([...signIn('Teen 15'), openPath('/settings'), toggle, toggle, FINISH])
    expect(outcome.steps.slice(5, 7).map((s) => s.outcome)).toEqual(['done', 'done'])
  })

  it('allows the same action again when the last one ended with the page still loading', async () => {
    const [switchTo] = signIn('Teen 15')
    const loading = (p: StepPrompt) => {
      // The app was busy: the action is reported done, but the page had not settled.
      vi.spyOn(kit.pool.get('acc-teen')!, 'execute').mockResolvedValue({ ok: true, detail: 'Filled. The page was still loading.' })
      return fillLogin(p)
    }
    const { outcome } = await kit.check([switchTo, loading, fillLogin, FINISH])
    expect(outcome.steps.slice(0, 3).map((s) => s.outcome)).toEqual(['done', 'done', 'done'])
  })

  it('refused repeats and the early-finish nudge each apply: repeats, then a finish refused once, then accepted', async () => {
    const [switchTo] = signIn('Teen 15')
    const { outcome } = await kit.check([switchTo, fillLogin, fillLogin, fillLogin, FINISH, FINISH])
    expect(outcome.steps.map((s) => [s.outcome, s.refusalReason?.slice(0, 20) ?? null])).toEqual([
      ['done', null],
      ['done', null],
      ['refused', REPEATED_ACTION.slice(0, 20)],
      ['refused', REPEATED_ACTION.slice(0, 20)],
      ['refused', 'Finished too early: '],
      ['done', null],
    ])
    expect(outcome.finished).toBe(true)
  })
})
