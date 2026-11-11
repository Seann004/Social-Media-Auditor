import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildStepPrompt, decideStep, dropOwnTarget, type StepPrompt } from './appAgent.js'
import { checkAction } from './appSafety.js'
import type { AppAction } from './appTypes.js'
import { allowed, CLICK_TEEN, CTX, one, refused } from './appSafetyTestKit.js'

const PROFILE = { url: 'https://app.test/u/teen15' }

const prompt: StepPrompt = {
  item: { id: 'i1', guidelineId: 'g1', category: 'Privacy', name: 'Private accounts', text: 'Is the teen private?', helpText: null },
  platform: 'FixtureSocial',
  accounts: [
    { id: 'a1', label: 'Teen 15', ageGroup: 'under_18', age: 15, handles: ['teen15'], session: 'open' },
    { id: 'a2', label: 'Adult 30', ageGroup: 'adult', age: 30, handles: ['adult30'], session: 'not opened' },
  ],
  currentAccount: 'Adult 30',
  view: null,
  history: [],
  leftChanged: [],
  stepsLeft: 10,
}

function reply(action: unknown): Response {
  const text = JSON.stringify({ action, note: 'n' })
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: 5 } }))
}
async function decided(action: unknown, current: string | null = 'Adult 30'): Promise<AppAction> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(action)))
  return (await decideStep({ prompt: { ...prompt, currentAccount: current }, apiKey: 'KEY', model: 'm', runId: 'run-7' })).action
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the step prompt on targets', () => {
  it('says target is only for actions that reach another person, and names the other account', () => {
    const { system } = buildStepPrompt(prompt)
    expect(system).toMatch(/"target" is ONLY for an action that reaches another person/)
    expect(system).toContain('names another test account, never the one in use')
    expect(system).not.toMatch(/OTHER test account/)
    expect(system).toMatch(/Leave "target" out for ordinary clicks, navigation, settings and sign-in/)
    expect(system).toContain('{"type":"click","ref":"e3"}')
  })
})

describe('a target that names the account in use', () => {
  it('is dropped from a click', async () => {
    expect(await decided({ type: 'click', ref: 'e1', target: 'Adult 30' })).toEqual({ type: 'click', ref: 'e1' })
  })
  it('is dropped from a toggle, whatever its case and spaces', async () => {
    expect(await decided({ type: 'toggle', ref: 'e2', target: ' adult 30 ' })).toEqual({ type: 'toggle', ref: 'e2' })
  })
  it('logs one line with the run, item and label when it drops a target', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await decided({ type: 'click', ref: 'e1', target: 'Adult 30' })
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0][0])
    expect(line).toContain('run-7')
    expect(line).toContain('i1')
    expect(line).toContain('Adult 30')
  })
  it('logs nothing when the target stays', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await decided({ type: 'click', ref: 'e1', target: 'Teen 15' })
    expect(log).not.toHaveBeenCalled()
  })
  it('stays when it names the other test account', async () => {
    expect(await decided({ type: 'click', ref: 'e1', target: 'Teen 15' })).toEqual({ type: 'click', ref: 'e1', target: 'Teen 15' })
  })
  it('stays when no account is in use', async () => {
    expect(await decided({ type: 'click', ref: 'e1', target: 'Adult 30' }, null)).toEqual({ type: 'click', ref: 'e1', target: 'Adult 30' })
  })
})

describe('dropOwnTarget and the safety rules', () => {
  // In CTX the account in use is "Adult".
  const ownTarget: AppAction = { type: 'click', ref: 'e1', target: 'Adult' }

  it('lets a click on Settings through as a plain click', () => {
    const action = dropOwnTarget(ownTarget, 'Adult')
    expect(action).toEqual({ type: 'click', ref: 'e1' })
    allowed(action, one('Settings'))
  })
  it('still refuses a click on Message, for having no target', () => {
    const action = dropOwnTarget(ownTarget, 'Adult')
    refused(action, one('Message', { contextText: '@teen15' }, PROFILE), 'own_accounts')
    expect(checkAction(action, one('Message', { contextText: '@teen15' }, PROFILE), CTX)).toMatchObject({
      reason: expect.stringContaining('needs a target'),
    })
  })
  it('leaves a click on the other test account unchanged', () => {
    expect(dropOwnTarget(CLICK_TEEN, 'Adult')).toBe(CLICK_TEEN)
    allowed(CLICK_TEEN, one('Message', { contextText: '@teen15' }))
  })
  it('returns a new action and leaves the given one as it was', () => {
    dropOwnTarget(ownTarget, 'Adult')
    expect(ownTarget).toEqual({ type: 'click', ref: 'e1', target: 'Adult' })
  })
})
