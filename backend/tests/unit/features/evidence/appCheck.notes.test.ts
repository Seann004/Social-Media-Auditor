import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeBrowser } from '../../../../src/features/evidence/browser.js'
import { TEST_TIMEOUT_MS } from '../../../fixtures/pages.js'
import { makeAccount, startAppWorld, type AppWorld } from '../../../fixtures/appWorld.js'
import { createCheckKit, openPath, signIn, type CheckKit } from '../../../fixtures/checkWorld.js'

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

const wrongTeenOf = (w: AppWorld) =>
  makeAccount(
    { id: 'acc-teen', label: 'Teen 15', ageGroup: 'under_18', age: 15, loginName: 'teen.login@example.test', handles: ['teen15'] },
    'Not-The-Password',
    w.secretKey,
  )
const FINISH = { type: 'finish', observations: 'Seen.', evidenceSteps: [] } as const

describe('runCheck: step lines say what the page said', () => {
  it('a failed sign-in says the message the page now shows', async () => {
    await kit.pool.closeAll()
    kit = createCheckKit(world, [wrongTeenOf(world), world.adult])
    const { outcome } = await kit.check([...signIn('Teen 15'), FINISH])
    expect(outcome.steps[3].line).toBe('Step 4 · Teen 15 · clicked button "Sign in" → page unchanged, now showing: "Wrong password"')
    // Filling the fields shows nothing new: the line stays as it was.
    expect(outcome.steps[1].line).toBe('Step 2 · Teen 15 · filled the login of Teen 15 into "Username" → page unchanged')
    for (const step of outcome.steps) {
      expect(step.line).not.toContain('Not-The-Password')
      expect(step.line).not.toContain('teen.login@example.test')
    }
  })

  it('a page that says "Not found" is flagged in the line', async () => {
    const { outcome } = await kit.check([...signIn('Teen 15'), openPath('/no-such-page'), openPath('/settings'), FINISH])
    expect(outcome.steps[4].line).toBe('Step 5 · Teen 15 · opened /no-such-page → page /no-such-page opened, but it said "Not found"')
    expect(outcome.steps[5].line).toBe('Step 6 · Teen 15 · opened /settings → page /settings opened')
  })

  it('a message that shows the login name is left out of the line', async () => {
    // This sign-in form repeats the typed login name in its error; the view shows it as [secret].
    await kit.pool.closeAll()
    kit = createCheckKit(world, [wrongTeenOf(world), world.adult], { ...world.app, appUrl: `${world.social.url}/login-echo` })
    const { outcome } = await kit.check([...signIn('Teen 15'), FINISH])
    expect(outcome.steps[3].line).toBe('Step 4 · Teen 15 · clicked button "Sign in" → page unchanged')
    const passages = await kit.repo.listPassagesOfPages([outcome.steps[3].pageId!])
    expect(passages.some((p) => p.text.includes('Wrong password for [secret]'))).toBe(true)
    for (const step of outcome.steps) expect(step.line).not.toContain('teen.login@example.test')
  })
})
