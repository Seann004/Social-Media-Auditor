import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssessInput, AssessOutput } from './assess.js'
import { closeBrowser } from './browser.js'
import type { Passage } from './types.js'
import { createAppRunKit, judged, type AppRunKit } from './__fixtures__/appRunWorld.js'
import { startAppWorld, type AppWorld } from './__fixtures__/appWorld.js'
import { openPath, signIn } from './__fixtures__/checkWorld.js'
import { TEST_TIMEOUT_MS } from './__fixtures__/pages.js'
import { item } from './__fixtures__/runnerWorld.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS * 4 })

const PRIVATE = item('t1', 'Privacy', 'Are teen accounts private by default?')
const MESSAGING = item('t2', 'Messaging', 'Can an adult stranger message a teen account?')
const OTHER = item('t3', 'Reporting', 'Can users report abuse?')

let world: AppWorld
let kit: AppRunKit

beforeEach(async () => {
  world = await startAppWorld()
  kit = await createAppRunKit(world, [PRIVATE, MESSAGING, OTHER])
})

afterEach(async () => {
  await world.close()
})

afterAll(async () => {
  await closeBrowser()
})

/** The first page passage (not a step line) that contains the text. */
function passageWith(input: AssessInput, text: string): Passage {
  const found = input.passages.find((p) => p.position > 0 && p.text.includes(text))
  if (!found) throw new Error(`No passage with "${text}" was sent:\n${input.passages.map((p) => p.text).join('\n---\n')}`)
  return found
}

/** A judge that reads the sent passages as the AI would and quotes what it relies on. */
function readingJudge(input: AssessInput): AssessOutput {
  const [asked] = input.items
  if (asked.id === PRIVATE.id) {
    const settings = passageWith(input, 'Private account On')
    return {
      results: [judged(asked.id, { suggestedResult: 'yes', quotes: [{ passageId: settings.id, text: 'Private account On' }] })],
      missingItemIds: [],
      tokensUsed: 300,
    }
  }
  const profile = passageWith(input, 'This account is private')
  const settings = passageWith(input, 'Private account On')
  return {
    results: [
      judged(asked.id, {
        suggestedResult: 'no',
        quotes: [
          { passageId: profile.id, text: 'This account is private' },
          { passageId: settings.id, text: 'Private account On' },
        ],
      }),
    ],
    missingItemIds: [],
    tokensUsed: 300,
  }
}

describe('an app run against the social app', () => {
  it('the success picture: Teen private by default is Yes from the settings step; Adult can’t message Teen is No from two accounts’ steps', async () => {
    // Each check's first finish is refused as too early, and the same finish is then accepted.
    const privateFinish = { type: 'finish', observations: 'The switch is on.', evidenceSteps: [5] } as const
    const messagingFinish = { type: 'finish', observations: 'No Message link.', evidenceSteps: [2, 7] } as const
    kit.scripts.t1 = [...signIn('Teen 15'), openPath('/settings'), privateFinish, privateFinish]
    kit.scripts.t2 = [
      { type: 'switch_account', account: 'Teen 15' },
      openPath('/settings'),
      ...signIn('Adult 30'),
      openPath('/u/teen15'),
      messagingFinish,
      messagingFinish,
    ]
    kit.judge.current = readingJudge

    const run = await kit.run({ checkedItemIds: [PRIVATE.id, MESSAGING.id] })

    expect(run.status).toBe('completed')
    expect(run.error).toBeNull()
    expect(run.uncheckedItemIds).toEqual([])
    const [privateSuggestion, messagingSuggestion] = await kit.suggestions(run.id)

    const privateSteps = await kit.appRepo.listSteps(run.id, PRIVATE.id)
    const settingsStep = privateSteps.find((s) => s.position === 5)
    expect(settingsStep?.line).toContain('/settings')
    expect(privateSuggestion).toMatchObject({ itemId: PRIVATE.id, suggestedResult: 'yes', source: 'app', originSuggestionId: null })
    expect(privateSuggestion.quotes).toHaveLength(1)
    // The settings step shows this account's current setting, not the default: the auditor must confirm it.
    expect(privateSuggestion.flags.map((f) => f.type)).toEqual(['default_unverified'])
    expect(privateSuggestion.quotes[0]).toMatchObject({ verified: true, pageId: settingsStep?.pageId })
    expect(typeof privateSuggestion.quotes[0].highlightScreenshotPath).toBe('string')

    const messagingSteps = await kit.appRepo.listSteps(run.id, MESSAGING.id)
    const accountOfPage = new Map(messagingSteps.map((s) => [s.pageId, s.accountLabel]))
    expect(messagingSuggestion).toMatchObject({ itemId: MESSAGING.id, suggestedResult: 'no', source: 'app' })
    expect(messagingSuggestion.flags).toEqual([])
    expect(messagingSuggestion.quotes.map((q) => [q.verified, accountOfPage.get(q.pageId)])).toEqual([
      [true, 'Adult 30'],
      [true, 'Teen 15'],
    ])

    // Every step that recorded a page has its screenshot, for the replay. Only the two finishes of each check
    // (the refused early one and the accepted one) record no page.
    const withPage = [...privateSteps, ...messagingSteps].filter((s) => s.pageId !== null)
    expect(withPage.length).toBe(privateSteps.length - 2 + messagingSteps.length - 2)
    for (const step of withPage) {
      const stored = await kit.repo.getPage(step.pageId as string)
      expect(stored?.screenshotPath, step.line).toEqual(expect.any(String))
    }

    // Nothing was changed, nothing was sent, and no answer was written.
    expect(await kit.appRepo.listChanges(run.id)).toEqual([])
    const state = world.social.state()
    expect(state.privateAccount.teen15).toBe(true)
    expect(state.messages).toEqual([])
    expect(kit.audit.applyAnswer).not.toHaveBeenCalled()
    expect(kit.judged.map((j) => j.items.map((i) => i.id))).toEqual([[PRIVATE.id], [MESSAGING.id]])
  })
})
