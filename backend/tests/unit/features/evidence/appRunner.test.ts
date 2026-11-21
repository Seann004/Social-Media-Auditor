import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqLimitError } from '../../../../src/lib/groq.js'
import { StepDecisionError } from '../../../../src/features/evidence/appAgent.js'
import { leftChangedLine } from '../../../../src/features/evidence/appCheck.js'
import { appPartialSummary, itemIdsOfLostCategories } from '../../../../src/features/evidence/appRunner.js'
import type { AppAction } from '../../../../src/features/evidence/appTypes.js'
import { closeBrowser } from '../../../../src/features/evidence/browser.js'
import { APP_MAX_TOKENS_PER_RUN, APP_RUN_TIMEOUT_MS, RUN_TIMEOUT_MS, STALE_RUN_MARGIN_MS } from '../../../../src/features/evidence/config.js'
import type { RunPatch } from '../../../../src/features/evidence/repository.js'
import { runEvidenceJob } from '../../../../src/features/evidence/runner.js'
import { categoryKey } from '../../../../src/features/evidence/runnerShared.js'
import { runTimeoutMsOf, sweepStaleRuns } from '../../../../src/features/evidence/runStart.js'
import { APP_ITEMS, createAppRunKit, judged, type AppRunKit } from '../../../fixtures/appRunWorld.js'
import { PROJECT_ID, startAppWorld, type AppWorld } from '../../../fixtures/appWorld.js'
import { on, openPath, signIn } from '../../../fixtures/checkWorld.js'
import { TEST_TIMEOUT_MS } from '../../../fixtures/pages.js'
import { page } from '../../../fixtures/runnerWorld.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS * 3 })

let world: AppWorld
let kit: AppRunKit

beforeEach(async () => {
  world = await startAppWorld()
  kit = await createAppRunKit(world)
})

afterEach(async () => {
  await world.close()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeBrowser()
})

const OPEN_TEEN: AppAction = { type: 'switch_account', account: 'Teen 15' }
const OPEN_ADULT: AppAction = { type: 'switch_account', account: 'Adult 30' }
const TOGGLE_PRIVATE = [...signIn('Teen 15'), openPath('/settings'), on('switch', 'Private account', 'toggle')]
const ids = (list: { itemId: string }[]) => list.map((s) => s.itemId)
const sorted = (list: string[]) => [...list].sort()

function recordPatches(): RunPatch[] {
  const patches: RunPatch[] = []
  const original = kit.repo.updateRun.bind(kit.repo)
  vi.spyOn(kit.repo, 'updateRun').mockImplementation(async (id, patch) => {
    patches.push(patch)
    return original(id, patch)
  })
  return patches
}

describe('appPartialSummary', () => {
  it.each([
    ['limit', 2, 'AI daily limit reached; 2 items not checked'],
    ['tokens', 1, 'The AI budget for one run was used up; 1 item not checked'],
    ['timeout', 3, 'The run ran out of time; 3 items not checked'],
    [null, 1, '1 item could not be checked'],
    [null, 4, '4 items could not be checked'],
  ] as const)('stop %s with %i unchecked', (stop, n, sentence) => {
    expect(appPartialSummary(stop, n)).toBe(sentence)
  })
})

describe('itemIdsOfLostCategories', () => {
  it('lists the items not assessed by this run in the lost categories', () => {
    const lost = [categoryKey(APP_ITEMS[0])]
    expect(itemIdsOfLostCategories(APP_ITEMS, lost, new Set(['i1']))).toEqual(['i2'])
    expect(itemIdsOfLostCategories(APP_ITEMS, [], new Set())).toEqual([])
  })
})

describe('executeAppRun, a capture run', () => {
  it('checks only the picked items, in checklist order, and writes NO answers', async () => {
    kit.scripts.i1 = [OPEN_TEEN]
    kit.scripts.i3 = [OPEN_ADULT]
    const run = await kit.run({ checkedItemIds: ['i3', 'i1'] })
    expect(run.status).toBe('completed')
    expect([...new Set(kit.prompts.map((p) => p.item.id))]).toEqual(['i1', 'i3'])
    expect(kit.judged.map((j) => j.items.map((i) => i.id))).toEqual([['i1'], ['i3']])
    expect(ids(await kit.suggestions(run.id))).toEqual(['i1', 'i3'])
    expect(run.categoriesTotal).toBe(2)
    expect(run.categoriesDone).toBe(2)
    expect(run.uncheckedItemIds).toEqual([])
    expect(kit.audit.applyAnswer).not.toHaveBeenCalled()
  })

  it('items not picked keep their earlier pages suggestion, carried with source pages', async () => {
    const earlier = await kit.seedPagesResult(['i1', 'i2', 'i3'])
    const before = await kit.suggestions(earlier.id)
    kit.scripts.i1 = [OPEN_TEEN]
    const run = await kit.run({ checkedItemIds: ['i1'] })
    expect(run.status).toBe('completed')
    const after = await kit.suggestions(run.id)
    const carried = after.filter((s) => s.itemId !== 'i1')
    expect(sorted(ids(carried))).toEqual(['i2', 'i3'])
    for (const copy of carried) {
      expect(copy.source).toBe('pages')
      expect(copy.originSuggestionId).toBe(before.find((s) => s.itemId === copy.itemId)?.id)
    }
    expect((await kit.repo.latestResultRun(PROJECT_ID))?.id).toBe(run.id)
  })

  it('an app suggestion replaces the earlier pages suggestion for a picked item', async () => {
    await kit.seedPagesResult(['i1'])
    kit.scripts.i1 = [OPEN_TEEN]
    const run = await kit.run({ checkedItemIds: ['i1'] })
    const [own] = await kit.suggestions(run.id)
    expect(own).toMatchObject({ itemId: 'i1', source: 'app', originSuggestionId: null, suggestedResult: 'yes' })
  })

  it('updates currentItemId and currentStep as it goes, and clears currentItemId at the end', async () => {
    const patches = recordPatches()
    kit.scripts.i1 = [OPEN_TEEN]
    kit.scripts.i3 = [OPEN_ADULT]
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    const progress = patches.filter((p) => 'currentItemId' in p || 'currentStep' in p)
    expect(progress).toEqual([
      // Each check's first finish is refused as too early (step 2) and the second is accepted (step 3).
      { currentItemId: 'i1', currentStep: 0 },
      { currentStep: 1 },
      { currentStep: 2 },
      { currentStep: 3 },
      { currentItemId: 'i3', currentStep: 0 },
      { currentStep: 1 },
      { currentStep: 2 },
      { currentStep: 3 },
      expect.objectContaining({ currentItemId: null }),
    ])
    expect(run.currentItemId).toBeNull()
  })

  it('at the token cap ends partial: checked items keep suggestions, the rest are uncheckedItemIds', async () => {
    kit.scripts.i1 = [OPEN_TEEN]
    kit.judgeTokens.current = APP_MAX_TOKENS_PER_RUN
    const run = await kit.run({ checkedItemIds: ['i1', 'i2', 'i3'] })
    expect(run.status).toBe('partial')
    expect(ids(await kit.suggestions(run.id))).toEqual(['i1'])
    expect(run.uncheckedItemIds).toEqual(['i2', 'i3'])
    expect(run.error).toBe('The AI budget for one run was used up; 2 items not checked')
    expect(kit.prompts.some((p) => p.item.id !== 'i1')).toBe(false)
  })

  it('never spends more than one AI call past the cap, counting step and judge calls on the meter', async () => {
    kit.stepTokens.current = 50_000
    kit.judgeTokens.current = 50_000
    kit.scripts.i1 = [OPEN_TEEN]
    kit.scripts.i2 = [OPEN_TEEN]
    kit.scripts.i3 = [OPEN_ADULT]
    const run = await kit.run({ checkedItemIds: ['i1', 'i2', 'i3'] })
    let spent = 0
    for (const call of kit.aiCalls) {
      expect(spent).toBeLessThan(APP_MAX_TOKENS_PER_RUN)
      spent += call.tokens
    }
    // i1: step, a finish refused as too early, finish, judge: the cap is reached, so i2 gets no call.
    expect(kit.aiCalls.map((c) => [c.kind, c.itemId])).toEqual([
      ['step', 'i1'],
      ['step', 'i1'],
      ['step', 'i1'],
      ['judge', 'i1'],
    ])
    expect(run.tokensUsed).toBe(200_000)
    expect(run.status).toBe('partial')
    expect(run.uncheckedItemIds).toEqual(['i2', 'i3'])
  })

  it('the cap reached before a judge call ends partial with that item unchecked and no judge call', async () => {
    kit.stepTokens.current = APP_MAX_TOKENS_PER_RUN / 2
    kit.scripts.i1 = [OPEN_TEEN]
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    expect(kit.judged).toHaveLength(0)
    expect(run.status).toBe('partial')
    expect(run.uncheckedItemIds).toEqual(['i1', 'i3'])
    expect(run.error).toBe('The AI budget for one run was used up; 2 items not checked')
    expect(await kit.appRepo.listSteps(run.id, 'i1')).toHaveLength(2)
  })

  it('a Groq limit from the judge ends partial with that item unchecked', async () => {
    kit.scripts.i1 = [OPEN_TEEN]
    kit.judge.current = () => {
      throw new GroqLimitError(3_600)
    }
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    expect(run.status).toBe('partial')
    expect(await kit.suggestions(run.id)).toEqual([])
    expect(run.uncheckedItemIds).toEqual(['i1', 'i3'])
    expect(run.error).toBe('AI daily limit reached; 2 items not checked')
    expect(kit.prompts.some((p) => p.item.id === 'i3')).toBe(false)
  })

  it('on GroqLimitError mid-check, still restores that check’s changes and ends partial', async () => {
    kit.scripts.i1 = [
      ...TOGGLE_PRIVATE,
      () => {
        throw new GroqLimitError(3_600)
      },
    ]
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    expect(world.social.state().privateAccount.teen15).toBe(true)
    const changes = await kit.appRepo.listChanges(run.id)
    expect(changes.map((c) => [c.control, c.restored, c.restoreDetail])).toEqual([['Private account', true, 'Put back.']])
    expect(run.status).toBe('partial')
    expect(run.uncheckedItemIds).toEqual(['i1', 'i3'])
    expect(run.error).toBe('AI daily limit reached; 2 items not checked')
    // Its steps are kept for a re-assess.
    expect((await kit.appRepo.listSteps(run.id, 'i1')).length).toBe(6)
    expect(kit.judged).toHaveLength(0)
  })

  it('a throw inside runCheck still restores the changes it recorded', async () => {
    kit.scripts.i1 = TOGGLE_PRIVATE
    const addStep = kit.appRepo.addStep.bind(kit.appRepo)
    let count = 0
    vi.spyOn(kit.appRepo, 'addStep').mockImplementation(async (input) => {
      count += 1
      if (count === 7) throw new Error('the database did not answer')
      return addStep(input)
    })
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    expect(world.social.state().privateAccount.teen15).toBe(true)
    expect((await kit.appRepo.listChanges(run.id)).map((c) => c.restored)).toEqual([true])
    expect(run.status).toBe('failed')
    expect(run.finishedAt).not.toBeNull()
    // The session pool was closed on the way out: no browser context of the run is left open.
    expect(world.browser.contexts()).toHaveLength(0)
  })

  it('a check that ends unfinished (three unreadable replies) is still judged from its steps', async () => {
    const unreadable = () => {
      throw new StepDecisionError('The reply could not be read.', 5)
    }
    kit.scripts.i1 = [OPEN_TEEN, unreadable, unreadable, unreadable]
    const run = await kit.run({ checkedItemIds: ['i1'] })
    expect((await kit.appRepo.listSteps(run.id, 'i1')).map((s) => s.outcome)).toEqual(['done', 'failed', 'failed', 'failed'])
    expect(kit.judged.map((j) => j.items[0].id)).toEqual(['i1'])
    expect(ids(await kit.suggestions(run.id))).toEqual(['i1'])
    expect(run.status).toBe('completed')
  })

  describe('after the run timeout (ruling A22)', () => {
    const RUN_TIMEOUT_SENTINEL = 987_654
    const GRACE_SENTINEL = 876_543
    const OUT_OF_TIME = 'The run ran out of time before this could be put back.'

    /** Lets each test fire the run's timeout and the restore's grace when it chooses: both timers are captured by their delay. */
    function captureTimers(): Map<number, () => void> {
      const fired = new Map<number, () => void>()
      const real = globalThis.setTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
        if (ms === RUN_TIMEOUT_SENTINEL || ms === GRACE_SENTINEL) fired.set(ms, fn)
        return real(fn, ms, ...rest)
      }) as typeof setTimeout)
      kit.deps.runTimeoutMs = RUN_TIMEOUT_SENTINEL
      kit.deps.app = { ...kit.deps.app!, restoreGraceMs: GRACE_SENTINEL }
      return fired
    }

    it('a run that times out mid-check still puts its toggled switch back', async () => {
      const fired = captureTimers()
      kit.scripts.i1 = [
        ...TOGGLE_PRIVATE,
        () => {
          fired.get(RUN_TIMEOUT_SENTINEL)?.()
          return { type: 'finish', observations: '', evidenceSteps: [] }
        },
      ]
      const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
      expect(world.social.state().privateAccount.teen15).toBe(true)
      expect((await kit.appRepo.listChanges(run.id)).map((c) => [c.control, c.restored, c.restoreDetail])).toEqual([['Private account', true, 'Put back.']])
      expect(run.status).toBe('partial')
      expect(run.error).toBe('The run ran out of time; 2 items not checked')
      expect(kit.prompts.some((p) => p.item.id === 'i3')).toBe(false)
    })

    it('a restore that exceeds the grace records that the run ran out of time', async () => {
      const fired = captureTimers()
      kit.scripts.i1 = [
        ...TOGGLE_PRIVATE,
        () => {
          fired.get(RUN_TIMEOUT_SENTINEL)?.()
          return { type: 'finish', observations: '', evidenceSteps: [] }
        },
      ]
      const listChanges = kit.appRepo.listChanges.bind(kit.appRepo)
      vi.spyOn(kit.appRepo, 'listChanges').mockImplementation(async (runId, opts) => {
        // The grace runs out while the restore is reading what to put back.
        if (opts?.unrestoredOnly) fired.get(GRACE_SENTINEL)?.()
        return listChanges(runId, opts)
      })
      const run = await kit.run({ checkedItemIds: ['i1'] })
      expect(fired.has(GRACE_SENTINEL)).toBe(true)
      expect(world.social.state().privateAccount.teen15).toBe(false)
      expect((await kit.appRepo.listChanges(run.id)).map((c) => [c.restored, c.restoreDetail])).toEqual([[false, OUT_OF_TIME]])
      expect(run.status).toBe('partial')
    })
  })

  it('a check that ended with error gets no suggestion, is listed unchecked, and the run goes on', async () => {
    kit.scripts.i1 = [
      () => {
        throw new Error('Groq request failed with status 500')
      },
    ]
    kit.scripts.i3 = [OPEN_ADULT]
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    expect(ids(await kit.suggestions(run.id))).toEqual(['i3'])
    expect(run.status).toBe('partial')
    expect(run.uncheckedItemIds).toEqual(['i1'])
    expect(run.unassessedCategories).toEqual([categoryKey(APP_ITEMS[0])])
    expect(run.error).toBe('1 item could not be checked')
    expect(run.categoriesDone).toBe(2)
  })

  it('a carried copy that fails puts its items into uncheckedItemIds', async () => {
    await kit.seedPagesResult(['i1', 'i2', 'i3'])
    kit.scripts.i1 = [OPEN_TEEN]
    const add = kit.repo.addSuggestion.bind(kit.repo)
    vi.spyOn(kit.repo, 'addSuggestion').mockImplementation(async (input) => {
      if (input.itemId === 'i3' && input.originSuggestionId) throw new Error('the database did not answer')
      return add(input)
    })
    const run = await kit.run({ checkedItemIds: ['i1'] })
    expect(sorted(ids(await kit.suggestions(run.id)))).toEqual(['i1', 'i2'])
    expect(run.status).toBe('partial')
    expect(run.uncheckedItemIds).toEqual(['i3'])
    expect(run.error).toBe('1 item could not be checked')
  })

  it('an unrestored change is listed and passed to the next check', async () => {
    kit.scripts.i1 = [
      ...TOGGLE_PRIVATE,
      () => {
        world.social.setMode({ hidePrivacySwitch: true })
        return { type: 'finish', observations: '', evidenceSteps: [] }
      },
    ]
    kit.scripts.i3 = [OPEN_ADULT]
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    const left = await kit.appRepo.listChanges(run.id, { unrestoredOnly: true })
    expect(left.map((c) => [c.control, c.restoreDetail])).toEqual([['Private account', 'The control "Private account" was not found on /settings.']])
    const i3Prompts = kit.prompts.filter((p) => p.item.id === 'i3')
    expect(i3Prompts.length).toBeGreaterThan(0)
    for (const p of i3Prompts) expect(p.leftChanged).toEqual([leftChangedLine(left[0])])
    expect(run.status).toBe('completed')
  })

  it('a blocked check still gets a suggestion with an inaccessible flag, and the run goes on', async () => {
    world.social.setMode({ captchaOnLogin: true })
    kit.scripts.i1 = signIn('Teen 15')
    kit.scripts.i3 = [OPEN_ADULT]
    const run = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    const suggestions = await kit.suggestions(run.id)
    expect(ids(suggestions)).toEqual(['i1', 'i3'])
    expect(suggestions[0].flags.map((f) => f.type)).toContain('inaccessible')
    expect(run.status).toBe('completed')
  })

  it('ignores robots.txt and the permission tickbox: getPermission is never called', async () => {
    const getPermission = vi.spyOn(kit.repo, 'getPermission')
    kit.scripts.i1 = [OPEN_TEEN]
    const run = await kit.run({ checkedItemIds: ['i1'] })
    expect(run.status).toBe('completed')
    expect(getPermission).not.toHaveBeenCalled()
  })

  it('sets startedAt and model like a pages run', async () => {
    const patches = recordPatches()
    const run = await kit.run({ checkedItemIds: ['i1'] })
    expect(patches[0]).toMatchObject({ status: 'capturing', model: 'test-model' })
    expect(run.startedAt).not.toBeNull()
    expect(run.model).toBe('test-model')
  })

  it('fails with a plain sentence when the app source or secret key is missing', async () => {
    const removed = 'The app address or test accounts were removed before the run started.'
    const notConfigured = "Checking inside the app isn't configured on this server."

    kit.deps.app = { ...kit.deps.app!, secretKey: null }
    expect(await kit.run({ checkedItemIds: ['i1'] })).toMatchObject({ status: 'failed', error: notConfigured })
    kit.deps.app = null
    expect(await kit.run({ checkedItemIds: ['i1'] })).toMatchObject({ status: 'failed', error: notConfigured })
    expect(kit.browserProvider).not.toHaveBeenCalled()

    const restoreKit = await createAppRunKit(world)
    for (const account of await restoreKit.appRepo.listTestAccounts(PROJECT_ID)) await restoreKit.appRepo.deleteTestAccount(account.id)
    expect(await restoreKit.run({ checkedItemIds: ['i1'] })).toMatchObject({ status: 'failed', error: removed })

    const noSource = await createAppRunKit(world)
    vi.spyOn(noSource.appRepo, 'getAppSource').mockResolvedValue(null)
    expect(await noSource.run({ checkedItemIds: ['i1'] })).toMatchObject({ status: 'failed', error: removed })
    expect(noSource.browserProvider).not.toHaveBeenCalled()
  })

  it('a pages run after an app run replaces every suggestion it assesses', async () => {
    kit.scripts.i1 = [OPEN_TEEN]
    const app = await kit.run({ checkedItemIds: ['i1', 'i2', 'i3'] })
    expect(app.status).toBe('completed')
    await kit.repo.saveSource(PROJECT_ID, ['https://p.test/privacy'], 'u1')
    const text = 'Teen accounts are private by default. Teens can hide their activity status. Adults cannot message teens.'
    const deps = {
      ...kit.deps,
      capture: async (opts: { onPage: (p: ReturnType<typeof page>) => Promise<void> }) => opts.onPage(page('https://p.test/privacy', text)),
    }
    const created = await kit.repo.createRun({ projectId: PROJECT_ID, startedBy: 'u1', scope: 'all' })
    await runEvidenceJob(created.id, deps as typeof kit.deps)
    const pages = await kit.repo.getRun(created.id)
    expect(pages?.status).toBe('completed')
    const suggestions = await kit.suggestions(created.id)
    expect(sorted(ids(suggestions))).toEqual(['i1', 'i2', 'i3'])
    for (const s of suggestions) expect(s).toMatchObject({ source: 'pages', originSuggestionId: null })
    expect((await kit.repo.latestResultRun(PROJECT_ID))?.id).toBe(created.id)
  })
})

describe('executeAppRun, a re-assess', () => {
  it('re-assess re-judges stored steps and never calls browserProvider', async () => {
    kit.scripts.i1 = [OPEN_TEEN]
    kit.scripts.i3 = [OPEN_ADULT]
    const first = await kit.run({ checkedItemIds: ['i1', 'i3'] })
    kit.browserProvider.mockClear()
    const stepPrompts = kit.prompts.length
    kit.judge.current = (input) => ({ results: input.items.map((i) => judged(i.id, { suggestedResult: 'no' })), missingItemIds: [], tokensUsed: 10 })
    const again = await kit.run({ checkedItemIds: ['i1', 'i3'], capturedInRunId: first.id })
    expect(kit.browserProvider).not.toHaveBeenCalled()
    expect(kit.prompts.length).toBe(stepPrompts)
    expect(again.status).toBe('completed')
    expect(again.startedAt).not.toBeNull()
    const own = (await kit.suggestions(again.id)).filter((s) => s.originSuggestionId === null)
    expect(own.map((s) => [s.itemId, s.source, s.suggestedResult])).toEqual([
      ['i1', 'app', 'no'],
      ['i3', 'app', 'no'],
    ])
  })

  it('re-assess unfinished only judges checked items with steps and no suggestion', async () => {
    kit.scripts.i1 = [OPEN_TEEN]
    kit.scripts.i2 = [OPEN_TEEN]
    kit.judge.current = (input) => {
      if (input.items[0].id === 'i2') throw new GroqLimitError(3_600)
      return { results: input.items.map((i) => judged(i.id)), missingItemIds: [], tokensUsed: 10 }
    }
    const first = await kit.run({ checkedItemIds: ['i1', 'i2', 'i3'] })
    expect(first.uncheckedItemIds).toEqual(['i2', 'i3'])
    kit.judged.length = 0
    kit.judge.current = (input) => ({ results: input.items.map((i) => judged(i.id)), missingItemIds: [], tokensUsed: 10 })
    const again = await kit.run({ checkedItemIds: ['i1', 'i2', 'i3'], capturedInRunId: first.id, scope: 'unfinished' })
    expect(kit.judged.map((j) => j.items[0].id)).toEqual(['i2'])
    const suggestions = await kit.suggestions(again.id)
    expect(suggestions.find((s) => s.itemId === 'i2')?.originSuggestionId).toBeNull()
    expect(suggestions.find((s) => s.itemId === 'i1')?.originSuggestionId).not.toBeNull()
    // i3 was never opened in the app.
    expect(again.uncheckedItemIds).toEqual(['i3'])
    expect(again.status).toBe('partial')
  })
})

describe('run timeouts', () => {
  it('the run timeout of an app run is APP_RUN_TIMEOUT_MS, and isStale uses it', async () => {
    expect(runTimeoutMsOf({ source: 'app' })).toBe(APP_RUN_TIMEOUT_MS)
    expect(runTimeoutMsOf({ source: 'pages' })).toBe(RUN_TIMEOUT_MS)

    const startedAt = new Date(Date.now() - RUN_TIMEOUT_MS - STALE_RUN_MARGIN_MS - 60_000).toISOString()
    const app = await kit.repo.createRun({ projectId: PROJECT_ID, startedBy: 'u1', scope: 'all', source: 'app', checkedItemIds: ['i1'] })
    await kit.repo.updateRun(app.id, { status: 'capturing', startedAt })
    expect((await sweepStaleRuns({ repo: kit.repo }, PROJECT_ID))?.id).toBe(app.id)

    await kit.repo.updateRun(app.id, { status: 'completed' })
    const pages = await kit.repo.createRun({ projectId: PROJECT_ID, startedBy: 'u1', scope: 'all' })
    await kit.repo.updateRun(pages.id, { status: 'capturing', startedAt })
    expect(await sweepStaleRuns({ repo: kit.repo }, PROJECT_ID)).toBeNull()
    expect((await kit.repo.getRun(pages.id))?.status).toBe('failed')
  })
})
