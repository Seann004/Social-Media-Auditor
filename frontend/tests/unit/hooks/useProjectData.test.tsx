import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/db')>()),
  fetchProjectChecklistItems: vi.fn(),
  fetchAuditResults: vi.fn(),
  fetchProjectDetails: vi.fn(),
  fetchResolutions: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../src/store/useStore'
import * as db from '../../../src/lib/db'
import { useProjectData } from '../../../src/hooks/useProjectData'

const item = (itemId: string, over: Record<string, unknown> = {}) => ({
  itemId, guidelineId: 'pg1', category: 'Cat', itemDescription: `Text ${itemId}`, severity: 'major', reference: null,
  itemName: null, itemCode: null, rowType: null, helpText: null, verbatimClauseText: null, answerOptions: null, ...over,
})
const result = (itemId: string, userId: string, value: string, time = '2026-03-01T10:00:00Z', over: Record<string, unknown> = {}) => ({
  resultId: `r-${itemId}-${userId}`, projectId: 'p1', itemId, userId, guidelineId: 'pg1', result: value,
  notes: null, findings: null, evidenceImages: null, timeSubmitted: time, ...over,
})
const DETAILS = {
  guidelines: [{ guidelineId: 'pg1', guidelineName: 'EDPB (project copy)', shortName: null, originalGuidelineId: 'g1', itemCount: 2 }],
  scope: ['Sign-up'],
  members: [{ userId: 'u1' }, { userId: 'u2' }],
}

const items = vi.mocked(db.fetchProjectChecklistItems)
const results = vi.mocked(db.fetchAuditResults)
const details = vi.mocked(db.fetchProjectDetails)
const resolutions = vi.mocked(db.fetchResolutions)

beforeEach(() => {
  localStorage.clear()
  items.mockReset().mockResolvedValue([
    item('i1', { reference: 'Art. 8', itemName: 'Age', itemCode: 'A1', rowType: 'ITEM', helpText: 'Help', verbatimClauseText: 'Clause', answerOptions: 'Yes/No' }),
    item('i2', { category: null }),
  ] as never)
  results.mockReset().mockResolvedValue([
    result('i1', 'u1', 'compliant', '2026-03-01T10:00:00Z', { notes: 'ok', findings: 'Seen it' }),
    result('i1', 'u2', 'non_compliant', '2026-03-02T10:00:00Z'),
    result('i2', 'u1', 'partially', null as never),
  ] as never)
  details.mockReset().mockResolvedValue(DETAILS as never)
  resolutions.mockReset().mockResolvedValue([])
  useStore.setState({
    currentUserId: 'u1',
    checklistItems: [{ id: 'other', guidelineId: 'g2', category: 'X', text: 'Other project item', severity: 'minor' }],
    guidelines: [{ id: 'g1', name: 'EDPB', shortName: 'EDPB', version: '1', description: '', source: '', categories: [], itemCount: 2, lastUpdated: '' }],
    projects: [
      { id: 'p1', name: 'P', platform: 'X', guidelineIds: ['g1'], status: 'in_progress', submissionStatus: 'not_submitted', headAuditorId: 'u1', auditorIds: [], createdAt: '', updatedAt: '', scope: [] },
      { id: 'p2', name: 'Q', platform: 'X', guidelineIds: ['g1'], status: 'in_progress', submissionStatus: 'not_submitted', headAuditorId: 'u1', auditorIds: [], createdAt: '', updatedAt: '', scope: [] },
    ],
    responses: {}, allResponses: {}, resolutions: {},
  } as never)
})

describe('useProjectData', () => {
  it('loads the project items and answers, and reconciles disagreeing answers to needs_review', async () => {
    const { result: hook } = renderHook(() => useProjectData('p1'))
    expect(hook.current.loading).toBe(true)
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(hook.current.error).toBeNull()
    expect(items).toHaveBeenCalledWith('p1')
    expect(results).toHaveBeenCalledWith('p1')
    expect(details).toHaveBeenCalledWith('p1')
    expect(resolutions).toHaveBeenCalledWith('p1')

    expect(hook.current.checklistItems).toEqual([
      { id: 'i1', guidelineId: 'pg1', category: 'Cat', text: 'Text i1', severity: 'major', reference: 'Art. 8', itemName: 'Age', itemCode: 'A1', rowType: 'ITEM', helpText: 'Help', verbatimClauseText: 'Clause', answerOptions: 'Yes/No' },
      expect.objectContaining({ id: 'i2', category: 'General', reference: undefined, itemName: undefined }),
    ])
    expect(hook.current.allResponses.p1__i1).toHaveLength(2)
    expect(hook.current.allResponses.p1__i1[0]).toEqual({
      id: 'r-i1-u1', projectId: 'p1', checklistItemId: 'i1', status: 'compliant', notes: 'ok', findings: 'Seen it', auditorId: 'u1', updatedAt: '2026-03-01',
    })
    // Two auditors disagree: the item needs review and shows the latest row.
    expect(hook.current.responses.p1__i1).toMatchObject({ status: 'needs_review', auditorId: 'u2' })
    expect(hook.current.responses.p1__i2).toMatchObject({ status: 'partially', notes: '', findings: undefined, updatedAt: '' })
  })

  it('uses a resolution over the auditors\' answers', async () => {
    resolutions.mockResolvedValue([{ itemId: 'i1', resolvedBy: 'u1', resolvedStatus: 'non_compliant', notes: 'agreed', resolvedAt: '2026-03-03T09:00:00Z' }] as never)
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(hook.current.responses.p1__i1.status).toBe('non_compliant')
    expect(hook.current.resolutions.p1__i1).toEqual({ status: 'non_compliant', resolvedBy: 'u1', notes: 'agreed', resolvedAt: '2026-03-03' })
  })

  it('merges the project into the store: items, answers, project guideline copies, scope and members', async () => {
    resolutions.mockResolvedValue([{ itemId: 'i2', resolvedBy: 'u1', resolvedStatus: 'compliant', notes: null, resolvedAt: null }] as never)
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.loading).toBe(false))
    const state = useStore.getState()
    expect(state.checklistItems.map((i) => i.id)).toEqual(['other', 'i1', 'i2'])
    expect(state.responses.p1__i1.status).toBe('needs_review')
    expect(state.allResponses.p1__i2).toHaveLength(1)
    expect(state.resolutions.p1__i2).toEqual({ status: 'compliant', resolvedBy: 'u1', notes: undefined, resolvedAt: '' })
    expect(state.guidelines.map((g) => g.id)).toEqual(['g1', 'pg1'])
    expect(state.guidelines[1]).toMatchObject({ name: 'EDPB (project copy)', shortName: 'EDPB (project copy)', version: '1.0', projectId: 'p1', originalGuidelineId: 'g1', itemCount: 2 })
    expect(state.projects[0]).toMatchObject({ id: 'p1', guidelineIds: ['pg1'], scope: ['Sign-up'], auditorIds: ['u1', 'u2'] })
    expect(state.projects[1]).toMatchObject({ id: 'p2', guidelineIds: ['g1'] })
  })

  it('returns the saved scope even when the project list has not loaded yet (page opened by its address)', async () => {
    useStore.setState({ projects: [] } as never)
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(hook.current.scope).toEqual(['Sign-up'])
  })

  it('copes with a project that has no details', async () => {
    details.mockResolvedValue(null as never)
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(useStore.getState().projects[0]).toMatchObject({ guidelineIds: [], scope: [], auditorIds: [] })
  })

  it('reports a load error', async () => {
    results.mockRejectedValue(new Error('Server down'))
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(hook.current.error).toBe('Server down')
    expect(hook.current.checklistItems).toEqual([])
  })

  it('reports a non-Error failure as text', async () => {
    items.mockRejectedValue('boom')
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.error).toBe('boom'))
  })

  it('does nothing without a project id or a signed-in user', async () => {
    const { result: noId } = renderHook(() => useProjectData(undefined))
    useStore.setState({ currentUserId: '' })
    renderHook(() => useProjectData('p1'))
    await act(async () => {})
    expect(items).not.toHaveBeenCalled()
    expect(noId.current.loading).toBe(true)
  })

  it('reload fetches again and clears a previous error', async () => {
    items.mockRejectedValueOnce(new Error('flaky'))
    const { result: hook } = renderHook(() => useProjectData('p1'))
    await waitFor(() => expect(hook.current.error).toBe('flaky'))
    await act(async () => { hook.current.reload() })
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(hook.current.error).toBeNull()
    expect(hook.current.checklistItems).toHaveLength(2)
    expect(items).toHaveBeenCalledTimes(2)
  })

  it('drops a slow answer for a project that is no longer shown', async () => {
    let finishFirst!: (v: never) => void
    items.mockImplementationOnce(() => new Promise((r) => { finishFirst = r }))
    const { result: hook, rerender } = renderHook(({ id }) => useProjectData(id), { initialProps: { id: 'p1' } })
    items.mockResolvedValue([item('j1')] as never)
    results.mockResolvedValue([])
    rerender({ id: 'p2' })
    await waitFor(() => expect(hook.current.loading).toBe(false))
    expect(hook.current.checklistItems.map((i) => i.id)).toEqual(['j1'])
    await act(async () => finishFirst([item('i1')] as never))
    expect(hook.current.checklistItems.map((i) => i.id)).toEqual(['j1'])
    expect(hook.current.loading).toBe(false)
  })

  it('drops a slow failure for a project that is no longer shown', async () => {
    let failFirst!: (e: Error) => void
    items.mockImplementationOnce(() => new Promise((_r, reject) => { failFirst = reject }))
    const { result: hook, rerender } = renderHook(({ id }) => useProjectData(id), { initialProps: { id: 'p1' } })
    rerender({ id: 'p2' })
    await waitFor(() => expect(hook.current.loading).toBe(false))
    await act(async () => failFirst(new Error('late')))
    expect(hook.current.error).toBeNull()
  })
})
