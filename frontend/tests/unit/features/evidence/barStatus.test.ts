import { describe, expect, it } from 'vitest'
import type { PickItem } from '../../../../src/features/evidence/appState'
import { SOURCE_LABEL, barStatus, runningText } from '../../../../src/features/evidence/barStatus'
import type { BarInput } from '../../../../src/features/evidence/barStatus'
import { makeRun } from '../../../../src/features/evidence/testFixtures'

const items: PickItem[] = [
  { id: 'i1', guidelineId: 'g1', category: 'Privacy', label: 'Item 1' },
  { id: 'i2', guidelineId: 'g1', category: 'Privacy', label: 'Item 2' },
]

const base: BarInput = {
  locked: false,
  run: null,
  resultRun: null,
  suggestionCount: 0,
  flaggedCount: 0,
  items,
  setup: 'ready',
}

const active = (over = {}) =>
  makeRun({ source: 'app', status: 'assessing', finishedAt: null, currentItemId: 'i2', categoriesDone: 1, categoriesTotal: 3, ...over })

describe('barStatus', () => {
  it('says "Needs setup" in amber when the source is not set up and nothing ran yet', () => {
    expect(barStatus({ ...base, setup: 'needed' })).toEqual({ tone: 'amber', text: 'Needs setup', running: false })
  })

  it('says "Ready" when set up and no run exists', () => {
    expect(barStatus(base)).toEqual({ tone: 'emerald', text: 'Ready', running: false })
  })

  it('says "Loading…" while the set-up is loading', () => {
    expect(barStatus({ ...base, setup: 'loading' }).text).toBe('Loading…')
  })

  it('gives the last result once a run finished', () => {
    const status = barStatus({ ...base, resultRun: makeRun(), suggestionCount: 2, flaggedCount: 1 })
    expect(status).toEqual({ tone: 'neutral', text: 'Last run: 2 suggestions · 1 flagged', running: false })
    expect(barStatus({ ...base, resultRun: makeRun(), suggestionCount: 1 }).text).toBe('Last run: 1 suggestion · 0 flagged')
  })

  it('shows the running progress before anything else', () => {
    const status = barStatus({ ...base, locked: true, run: active(), resultRun: makeRun() })
    expect(status).toEqual({ tone: 'blue', text: 'Checking Item 2 · 2 of 3', running: true })
  })

  it('says the audit is locked, with the last result when there is one', () => {
    expect(barStatus({ ...base, locked: true, setup: 'needed' })).toEqual({ tone: 'neutral', text: 'Audit locked · no new runs', running: false })
    expect(barStatus({ ...base, locked: true, resultRun: makeRun(), suggestionCount: 3 }).text).toBe('Audit locked · Last run: 3 suggestions · 0 flagged')
  })

  it('says the last run failed when the latest run failed after the result run', () => {
    const failed = makeRun({ id: 'run-2', status: 'failed', error: 'Boom' })
    expect(barStatus({ ...base, run: failed, resultRun: makeRun() })).toEqual({ tone: 'rose', text: 'Last run failed', running: false })
  })
})

describe('runningText', () => {
  it('names the item and its position for app and repo runs', () => {
    expect(runningText(active(), items)).toBe('Checking Item 2 · 2 of 3')
    expect(runningText(active({ source: 'repo', categoriesDone: 0, currentItemId: 'i1' }), items)).toBe('Checking Item 1 · 1 of 3')
  })

  it('drops the closing full stop of an item text before the position', () => {
    const sentence: PickItem[] = [{ id: 'i1', guidelineId: 'g1', category: 'Privacy', label: 'Parents can link to a teen account.' }]
    expect(runningText(active({ currentItemId: 'i1', categoriesDone: 0 }), sentence)).toBe('Checking Parents can link to a teen account · 1 of 3')
  })

  it('falls back to the position when the item is unknown, and never passes the total', () => {
    expect(runningText(active({ currentItemId: 'gone', categoriesDone: 3 }), items)).toBe('Checking item 3 of 3')
    expect(runningText(active({ categoriesTotal: 0, categoriesDone: 0, currentItemId: null }), items)).toBe('Starting')
  })

  it('has its own words for queued, reading the code and page runs', () => {
    expect(runningText(active({ status: 'queued' }), items)).toBe('Waiting to start')
    expect(runningText(active({ source: 'repo', status: 'capturing' }), items)).toBe('Reading the repository')
    expect(runningText(makeRun({ status: 'capturing', pagesDone: 2, pagesTotal: 5 }), items)).toBe('Reading pages · 2 of 5')
    expect(runningText(makeRun({ status: 'assessing', categoriesDone: 1, categoriesTotal: 4 }), items)).toBe('Assessing categories · 1 of 4')
  })
})

describe('SOURCE_LABEL', () => {
  it('names each source for the bar', () => {
    expect(SOURCE_LABEL).toEqual({ app: 'App', repo: 'Code repository', pages: 'Public pages' })
  })
})
