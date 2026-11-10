import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const ITEMS = [
  { id: 'i1', guidelineId: 'g1', category: 'Cat', text: 'Item one', severity: 'major', itemCode: 'C1' },
  { id: 'i2', guidelineId: 'g1', category: 'Cat', text: 'Item two', severity: 'major', itemCode: 'C2' },
]
vi.mock('../../../hooks/useProjectData', () => ({
  useProjectData: () => ({ checklistItems: ITEMS, loading: false, error: null, reload: vi.fn(), evidenceMap: {}, responses: {} }),
}))
vi.mock('../../../lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  activateProject: vi.fn(),
  fetchEvidenceForItems: vi.fn(async () => []),
  fetchAnswerSuggestions: vi.fn(),
  acceptAnswerSuggestions: vi.fn(),
  fetchProjectReliability: vi.fn(async () => ({ kappa: null, sharedItems: 0, raterPair: null })),
}))
vi.mock('../../evidence/api', async (orig) => ({
  ...(await orig<typeof import('../../evidence/api')>()),
  getLatestRun: vi.fn(),
  getSuggestions: vi.fn(),
  getSources: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../store/useStore'
import * as db from '../../../lib/db'
import * as api from '../../evidence/api'
import { makeRun } from '../../evidence/testFixtures'
import AuditPage from './AuditPage'

const SUGGESTION: db.AnswerSuggestion = {
  itemId: 'i1', guidelineId: 'g1', suggestedStatus: 'compliant', relation: 'equivalent',
  sourceProjectId: 'p1', sourceProjectTitle: 'Same audit', sourceGuideline: 'UKCC', sourceItemId: 'x1',
  sourceItemCode: '7.3', findings: 'Seen at sign-up', evidenceCount: 0, answeredAt: '2026-03-01T00:00:00Z', otherSources: 0,
}

function setup(status: 'draft' | 'in_progress') {
  useStore.setState({
    currentUserId: 'u1', authToken: 't', isAuthenticated: true, loading: false,
    users: [{ id: 'u1', name: 'A', email: 'a@x', role: 'auditor' }],
    projects: [{ id: 'p1', name: 'P', platform: 'X', description: '', status, submissionStatus: 'not_submitted', guidelineIds: ['g1'], auditorIds: ['u1'], scope: [], createdAt: '2026-01-01', dueDate: '2026-12-01', createdBy: 'u1' }],
    guidelines: [{ id: 'g1', name: 'G', shortName: 'G', version: '1', description: '', source: '', categories: ['Cat'], itemCount: 2, lastUpdated: '' }],
    checklistItems: ITEMS,
    responses: {}, allResponses: {}, resolutions: {}, projectItemCounts: {}, complianceMap: {},
  } as never)
}

const tree = () => (
  <MemoryRouter initialEntries={['/audits/p1']}>
    <Routes><Route path="/audits/:id" element={<AuditPage />} /></Routes>
  </MemoryRouter>
)
const rowOf = (text: string) => screen.getByText(text).closest('[class*="px-6 py-5"]') as HTMLElement

beforeEach(() => {
  vi.mocked(db.fetchAnswerSuggestions).mockReset().mockResolvedValue([SUGGESTION])
  vi.mocked(db.acceptAnswerSuggestions).mockReset().mockResolvedValue([
    { itemId: 'i1', result: 'compliant', notes: 'Reused from "Same audit"', findings: 'Seen at sign-up', timeSubmitted: '2026-11-11T00:00:00Z' },
  ])
  vi.mocked(db.fetchProjectComplianceSummary).mockReset().mockResolvedValue({ p1: { percentage: 100, answered: 1, total: 2 } } as never)
  vi.mocked(db.activateProject).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(api.getLatestRun).mockReset().mockResolvedValue({ run: makeRun(), pages: [] } as never)
  vi.mocked(api.getSources).mockReset().mockResolvedValue({ source: null, permission: null } as never)
  vi.mocked(api.getSuggestions).mockReset().mockResolvedValue({ run: makeRun(), suggestions: [], decisions: [] } as never)
})

describe('reusing an answer from earlier audits', () => {
  it('refreshes the project figures, like any other saved answer', async () => {
    setup('in_progress')
    render(tree())
    await userEvent.click(await within(rowOf('Item one')).findByRole('button', { name: 'Use answer' }))
    await waitFor(() => expect(db.acceptAnswerSuggestions).toHaveBeenCalledWith('p1', ['i1']))
    await waitFor(() => expect(db.fetchProjectComplianceSummary).toHaveBeenCalledWith(['p1']))
    expect(useStore.getState().complianceMap.p1).toBe(100)
  })

  it('moves a draft project to in progress once its first answer is reused', async () => {
    setup('draft')
    render(tree())
    await userEvent.click(await within(rowOf('Item one')).findByRole('button', { name: 'Use answer' }))
    await waitFor(() => expect(db.activateProject).toHaveBeenCalledWith('p1'))
  })

  it('does not refresh anything when nothing was reused', async () => {
    setup('in_progress')
    vi.mocked(db.acceptAnswerSuggestions).mockResolvedValue([])
    render(tree())
    await userEvent.click(await within(rowOf('Item one')).findByRole('button', { name: 'Use answer' }))
    await screen.findByText(/Nothing was reused/)
    expect(db.fetchProjectComplianceSummary).not.toHaveBeenCalled()
  })

  it('still shows the reused answer when the refresh fails', async () => {
    setup('in_progress')
    vi.mocked(db.fetchProjectComplianceSummary).mockRejectedValue(new Error('offline'))
    render(tree())
    await userEvent.click(await within(rowOf('Item one')).findByRole('button', { name: 'Use answer' }))
    await waitFor(() => expect(db.fetchProjectComplianceSummary).toHaveBeenCalled())
    expect(useStore.getState().allResponses['p1__i1']?.[0]).toMatchObject({ status: 'compliant' })
    expect(screen.queryByText(/Couldn't reuse that answer/)).not.toBeInTheDocument()
  })
})
