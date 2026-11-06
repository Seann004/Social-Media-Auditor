import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreChanges } from './appRestore.js'
import { closeBrowser } from './browser.js'
import { TEST_TIMEOUT_MS } from './__fixtures__/pages.js'
import { startAppWorld, type AppWorld } from './__fixtures__/appWorld.js'
import { createCheckKit, nthRef, on, openPath, RUN, signIn, type CheckKit } from './__fixtures__/checkWorld.js'
import type { ActionResult, AppSession } from './appSession.js'

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

const FINISH = { type: 'finish', observations: '', evidenceSteps: [] } as const
const restore = (signal: AbortSignal = world.abort.signal) =>
  kit.appRepo.listChanges(RUN.id).then((changes) => restoreChanges(kit.pool, changes, kit.appRepo, signal, kit.safety))

describe('restoreChanges', () => {
  it('puts a toggled switch back and records Put back.', async () => {
    await kit.check([...signIn('Teen 15'), openPath('/settings'), on('switch', 'Private account', 'toggle'), FINISH])
    expect(world.social.state().privateAccount.teen15).toBe(false)
    const restored = await restore()
    expect(restored.map((c) => [c.control, c.restored, c.restoreDetail])).toEqual([['Private account', true, 'Put back.']])
    expect(world.social.state().privateAccount.teen15).toBe(true)
    expect(await kit.appRepo.listChanges(RUN.id)).toEqual(restored)
  })

  it('puts a checkbox back and clicks its Save control, verified after reload', async () => {
    await kit.check([...signIn('Teen 15'), openPath('/settings'), on('checkbox', 'Show activity status'), on('button', 'Save'), FINISH])
    expect(world.social.state().activityStatus.teen15).toBe(false)
    const restored = await restore()
    expect(restored.map((c) => [c.control, c.saveControl, c.restored, c.restoreDetail])).toEqual([['Show activity status', 'Save', true, 'Put back.']])
    expect(world.social.state().activityStatus.teen15).toBe(true)
  })

  it('records "Already as before." when the setting is back already', async () => {
    await kit.check([...signIn('Teen 15'), openPath('/settings'), on('checkbox', 'Show activity status'), FINISH])
    // Never saved: the reload shows the stored value, which is the one from before.
    const restored = await restore()
    expect(restored.map((c) => [c.restored, c.restoreDetail])).toEqual([[true, 'Already as before.']])
  })

  it('records "not found" when hidePrivacySwitch is on, and never throws', async () => {
    await kit.check([...signIn('Teen 15'), openPath('/settings'), on('switch', 'Private account', 'toggle'), FINISH])
    world.social.setMode({ hidePrivacySwitch: true })
    const restored = await restore()
    expect(restored.map((c) => [c.restored, c.restoreDetail])).toEqual([[false, 'The control "Private account" was not found on /settings.']])
    expect(world.social.state().privateAccount.teen15).toBe(false)
  })

  it('records "ran out of time" when the signal is aborted', async () => {
    await kit.check([...signIn('Teen 15'), openPath('/settings'), on('switch', 'Private account', 'toggle'), FINISH])
    const restored = await restore(AbortSignal.abort())
    expect(restored.map((c) => [c.restored, c.restoreDetail])).toEqual([[false, 'The run ran out of time before this could be put back.']])
    expect((await kit.appRepo.listChanges(RUN.id))[0].restoreDetail).toBe('The run ran out of time before this could be put back.')
  })

  it('records that the session was not available when it is gone', async () => {
    await kit.check([...signIn('Teen 15'), openPath('/settings'), on('switch', 'Private account', 'toggle'), FINISH])
    await kit.pool.closeAll()
    const restored = await restore()
    expect(restored.map((c) => [c.restored, c.restoreDetail])).toEqual([[false, 'The session of Teen 15 was not available.']])
  })

  it('restores in reverse order when the same control changed twice', async () => {
    await kit.check([
      ...signIn('Teen 15'),
      openPath('/settings'),
      on('switch', 'Private account', 'toggle'),
      on('switch', 'Private account', 'toggle'),
      FINISH,
    ])
    const changes = await kit.appRepo.listChanges(RUN.id)
    expect(changes.map((c) => [c.before, c.after])).toEqual([
      ['on', 'off'],
      ['off', 'on'],
    ])
    const restored = await restore()
    expect(restored.map((c) => c.restoreDetail)).toEqual(['Put back.', 'Put back.'])
    expect(world.social.state().privateAccount.teen15).toBe(true)
  })
})

const teenSession = (): AppSession => kit.pool.get('acc-teen')!

describe('restoreChanges: fix round 1', () => {
  it('A16: a toggle whose execute reports failure after landing is recorded and put back', async () => {
    const { outcome } = await kit.check([
      ...signIn('Teen 15'),
      openPath('/settings'),
      (p) => {
        const session = teenSession()
        const original = session.execute.bind(session)
        vi.spyOn(session, 'execute').mockImplementationOnce(async (action): Promise<ActionResult> => {
          await original(action)
          return { ok: false, detail: 'The action could not be carried out.' }
        })
        return { type: 'toggle', ref: nthRef(p, 'switch', 'Private account', 1) }
      },
      FINISH,
    ])
    expect(outcome.steps[5].outcome).toBe('failed')
    expect(outcome.changes.map((c) => [c.control, c.before, c.after])).toEqual([['Private account', 'on', 'off']])
    expect(world.social.state().privateAccount.teen15).toBe(false)
    const restored = await restore()
    expect(restored.map((c) => c.restoreDetail)).toEqual(['Put back.'])
    expect(world.social.state().privateAccount.teen15).toBe(true)
  })

  it('A16: a failed read after a setting action records the change as "unknown", and restore puts it back', async () => {
    const { outcome } = await kit.check([
      ...signIn('Teen 15'),
      openPath('/settings'),
      (p) => {
        const session = teenSession()
        vi.spyOn(session, 'read').mockRejectedValueOnce(new Error('read failed')).mockRejectedValueOnce(new Error('read failed'))
        return { type: 'toggle', ref: nthRef(p, 'switch', 'Private account', 1) }
      },
      FINISH,
    ])
    expect(outcome.changes.map((c) => [c.control, c.before, c.after])).toEqual([['Private account', 'on', 'unknown']])
    const restored = await restore()
    expect(restored.map((c) => c.restoreDetail)).toEqual(['Put back.'])
    expect(world.social.state().privateAccount.teen15).toBe(true)
  })

  it('radios: choosing "Only me" over "Public" is recorded as Public on → off, and restore brings Public back', async () => {
    const { outcome } = await kit.check([
      ...signIn('Teen 15'),
      openPath('/settings/privacy'),
      on('radio', 'Only me'),
      on('button', 'Save'),
      FINISH,
    ])
    expect(outcome.steps[5].line).toBe('Step 6 · Teen 15 · clicked radio "Only me" → "Only me" is now on')
    expect(outcome.changes.map((c) => [c.role, c.control, c.before, c.after, c.saveControl])).toEqual([['radio', 'Public', 'on', 'off', 'Save']])
    expect(world.social.state().postVisibility.teen15).toBe('Only me')
    const restored = await restore()
    expect(restored.map((c) => [c.restored, c.restoreDetail])).toEqual([[true, 'Put back.']])
    expect(world.social.state().postVisibility.teen15).toBe('Public')
  })

  it('A17: two "Notifications" switches; changing the second is recorded and restored, the first untouched', async () => {
    const { outcome } = await kit.check([
      ...signIn('Teen 15'),
      openPath('/settings/notifications'),
      (p) => ({ type: 'toggle', ref: nthRef(p, 'switch', 'Notifications', 2) }),
      FINISH,
    ])
    expect(outcome.changes.map((c) => [c.control, c.before, c.after])).toEqual([['Notifications (2)', 'on', 'off']])
    expect(world.social.state().notifications.teen15).toEqual({ email: true, push: false })
    const restored = await restore()
    expect(restored.map((c) => c.restoreDetail)).toEqual(['Put back.'])
    expect(world.social.state().notifications.teen15).toEqual({ email: true, push: true })
  })

  it('A15: restore opens the page without the hidden parameters', async () => {
    const { outcome } = await kit.check([...signIn('Teen 15'), openPath('/settings?token=abc'), on('switch', 'Private account', 'toggle'), FINISH])
    expect(outcome.changes[0].pageUrl).toBe(`${world.social.url}/settings?token=redacted`)
    const goto = vi.spyOn(teenSession(), 'gotoInApp')
    const restored = await restore()
    expect(restored.map((c) => c.restoreDetail)).toEqual(['Put back.'])
    expect(goto.mock.calls.map(([url]) => url)).toEqual([`${world.social.url}/settings`, `${world.social.url}/settings`])
    expect(world.social.state().privateAccount.teen15).toBe(true)
  })
})
