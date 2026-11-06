import { describe, expect, it } from 'vitest'
import type { ChecklistItem } from '../../types'
import { APP_STEPS_PER_CHECK, OUTCOME_LABEL, appRunBlocker, currentItemLabel, groupPickItems, toPickItems } from './appState'
import { makeRun } from './testFixtures'

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'i1',
  guidelineId: 'g1',
  category: 'Privacy',
  text: 'Profiles are private by default',
  severity: 'high',
  ...over,
})

const ready = { hasApp: true, accountCount: 1, picked: 1, secretKeyConfigured: true, locked: false, running: false }

describe('pick items', () => {
  it('toPickItems uses itemName, falling back to text', () => {
    const picks = toPickItems([item({ id: 'a', itemName: 'Private profiles' }), item({ id: 'b' })])
    expect(picks).toEqual([
      { id: 'a', guidelineId: 'g1', category: 'Privacy', label: 'Private profiles' },
      { id: 'b', guidelineId: 'g1', category: 'Privacy', label: 'Profiles are private by default' },
    ])
  })

  it('groups the same category name in two guidelines separately', () => {
    const groups = groupPickItems(
      toPickItems([item({ id: 'a' }), item({ id: 'b', guidelineId: 'g2' }), item({ id: 'c', category: 'Safety' }), item({ id: 'd' })]),
    )
    expect(groups.map((g) => [g.key, g.category, g.items.map((i) => i.id)])).toEqual([
      ['g1__Privacy', 'Privacy', ['a', 'd']],
      ['g2__Privacy', 'Privacy', ['b']],
      ['g1__Safety', 'Safety', ['c']],
    ])
  })
})

describe('appRunBlocker', () => {
  it.each([
    [{ locked: true }, 'This audit is locked, so no runs can start.'],
    [{ running: true }, 'A run is already in progress.'],
    [{ secretKeyConfigured: false }, "Checking inside the app isn't set up on the server yet."],
    [{ hasApp: false }, 'Save the app address first.'],
    [{ accountCount: 0 }, 'Add at least one test account.'],
    [{ picked: 0 }, 'Pick at least one item.'],
    [{ picked: 11 }, 'Pick at most 10 items.'],
    [{}, null],
    [{ picked: 10 }, null],
  ])('appRunBlocker %j is %s', (over, expected) => {
    expect(appRunBlocker({ ...ready, ...over })).toBe(expected)
  })

  it('gives the earliest sentence when several apply (locked before running before the rest)', () => {
    const all = { hasApp: false, accountCount: 0, picked: 0, secretKeyConfigured: false, locked: true, running: true }
    expect(appRunBlocker(all)).toBe('This audit is locked, so no runs can start.')
    expect(appRunBlocker({ ...all, locked: false })).toBe('A run is already in progress.')
    expect(appRunBlocker({ ...all, locked: false, running: false })).toBe("Checking inside the app isn't set up on the server yet.")
    expect(appRunBlocker({ ...all, locked: false, running: false, secretKeyConfigured: true })).toBe('Save the app address first.')
  })
})

describe('constants', () => {
  it('mirrors the backend step limit and outcome labels', () => {
    expect(APP_STEPS_PER_CHECK).toBe(15)
    expect(OUTCOME_LABEL).toEqual({ done: 'Done', refused: 'Refused', failed: 'Failed', blocked: 'Stopped' })
  })
})

describe('currentItemLabel', () => {
  const picks = toPickItems([item({ id: 'a', itemName: 'Private profiles' })])
  it('names the item being checked, null when none', () => {
    expect(currentItemLabel(makeRun({ currentItemId: 'a' }), picks)).toBe('Private profiles')
    expect(currentItemLabel(makeRun({ currentItemId: null }), picks)).toBeNull()
    expect(currentItemLabel(makeRun({ currentItemId: 'gone' }), picks)).toBeNull()
  })
})
