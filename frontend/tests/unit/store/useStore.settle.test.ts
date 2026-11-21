import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  activateProject: vi.fn(),
  upsertAuditResult: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../src/store/useStore'
import * as db from '../../../src/lib/db'
import type { Project } from '../../../src/types'

const summary = { p1: { percentage: 25, answered: 2, total: 4 } } as unknown as Awaited<ReturnType<typeof db.fetchProjectComplianceSummary>>
const project = (status: Project['status']) => ({ id: 'p1', status }) as unknown as Project

beforeEach(() => {
  vi.mocked(db.fetchProjectComplianceSummary).mockReset().mockResolvedValue(summary)
  vi.mocked(db.activateProject).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(db.upsertAuditResult).mockReset().mockResolvedValue(undefined as never)
  useStore.setState({ currentUserId: 'u1', complianceMap: {}, projectItemCounts: {}, projects: [project('draft')], responses: {}, allResponses: {}, resolutions: {} })
})

describe('refreshAfterAnswer', () => {
  it('refreshes the compliance map and advances a draft project to in_progress', async () => {
    await useStore.getState().refreshAfterAnswer('p1')
    expect(useStore.getState().complianceMap['p1']).toBe(25)
    expect(useStore.getState().projectItemCounts['p1']).toEqual({ answered: 2, total: 4 })
    expect(db.activateProject).toHaveBeenCalledWith('p1')
    expect(useStore.getState().projects[0].status).toBe('in_progress')
  })

  it('leaves a project that is already in progress alone', async () => {
    useStore.setState({ projects: [project('in_progress')] })
    await useStore.getState().refreshAfterAnswer('p1')
    expect(db.activateProject).not.toHaveBeenCalled()
  })

  it('setResponse still saves, then does the same refresh', async () => {
    await useStore.getState().setResponse('p1', 'i1', 'g1', 'compliant', 'n')
    expect(db.upsertAuditResult).toHaveBeenCalledOnce()
    expect(useStore.getState().complianceMap['p1']).toBe(25)
    expect(useStore.getState().allResponses['p1__i1']).toHaveLength(1)
    expect(useStore.getState().projects[0].status).toBe('in_progress')
  })

  it('setResponse still rethrows a failed save', async () => {
    vi.mocked(db.upsertAuditResult).mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(useStore.getState().setResponse('p1', 'i1', 'g1', 'compliant')).rejects.toThrow('down')
  })

  it('setResponse puts the old rows back when the save fails', async () => {
    vi.mocked(db.upsertAuditResult).mockRejectedValue(new Error('down'))
    await expect(useStore.getState().setResponse('p1', 'i1', 'g1', 'compliant')).rejects.toThrow('down')
    expect(useStore.getState().allResponses['p1__i1']).toBeUndefined()
    expect(useStore.getState().responses['p1__i1']).toBeUndefined()
  })

  it('setResponse keeps the saved answer when only the refresh fails', async () => {
    vi.mocked(db.fetchProjectComplianceSummary).mockRejectedValue(new Error('summary down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(useStore.getState().setResponse('p1', 'i1', 'g1', 'compliant')).resolves.toBeUndefined()
    expect(useStore.getState().responses['p1__i1'].status).toBe('compliant')
  })
})
