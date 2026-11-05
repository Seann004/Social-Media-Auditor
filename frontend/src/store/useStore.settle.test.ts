import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  updateProject: vi.fn(),
  upsertAuditResult: vi.fn(),
}))

import * as db from '../lib/db'
import { useStore } from './useStore'
import type { Project } from '../types'

const summary = { p1: { total: 4, compliant: 1 } } as unknown as Awaited<ReturnType<typeof db.fetchProjectComplianceSummary>>
const project = (status: Project['status']) => ({ id: 'p1', status }) as unknown as Project

beforeEach(() => {
  vi.mocked(db.fetchProjectComplianceSummary).mockReset().mockResolvedValue(summary)
  vi.mocked(db.updateProject).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(db.upsertAuditResult).mockReset().mockResolvedValue(undefined as never)
  useStore.setState({ currentUserId: 'u1', complianceMap: {}, projects: [project('draft')], responses: {} })
})

describe('refreshAfterAnswer', () => {
  it('refreshes the compliance map and advances a draft project to in_progress', async () => {
    await useStore.getState().refreshAfterAnswer('p1')
    expect(useStore.getState().complianceMap['p1']).toEqual(summary['p1'])
    expect(db.updateProject).toHaveBeenCalledWith('p1', { projectStatus: 'in_progress' })
    expect(useStore.getState().projects[0].status).toBe('in_progress')
  })

  it('leaves a project that is already in progress alone', async () => {
    useStore.setState({ projects: [project('in_progress')] })
    await useStore.getState().refreshAfterAnswer('p1')
    expect(db.updateProject).not.toHaveBeenCalled()
  })

  it('setResponse still saves, then does the same refresh', async () => {
    await useStore.getState().setResponse('p1', 'i1', 'g1', 'compliant', 'n')
    expect(db.upsertAuditResult).toHaveBeenCalledOnce()
    expect(useStore.getState().complianceMap['p1']).toEqual(summary['p1'])
    expect(useStore.getState().projects[0].status).toBe('in_progress')
  })

  it('setResponse still rethrows a failed save', async () => {
    vi.mocked(db.upsertAuditResult).mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(useStore.getState().setResponse('p1', 'i1', 'g1', 'compliant')).rejects.toThrow('down')
  })
})
