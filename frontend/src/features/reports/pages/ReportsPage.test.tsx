import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../lib/db')>()),
  fetchAuditReports: vi.fn(),
  fetchComplianceScores: vi.fn(),
  fetchAuditResults: vi.fn(),
  fetchProjectChecklistItems: vi.fn(),
}))
vi.mock('../../evidence/api', async (orig) => ({
  ...(await orig<typeof import('../../evidence/api')>()),
  getSuggestions: vi.fn(),
}))

import * as db from '../../../lib/db'
import * as api from '../../evidence/api'
import { makeDecision, makeRun } from '../../evidence/testFixtures'
import { useStore } from '../../../store/useStore'
import ReportsPage from './ReportsPage'

const getSuggestions = vi.mocked(api.getSuggestions)
const REPORT = {
  projectId: 'p1', projectTitle: 'Proj', smPlatform: 'TikTok', projectStatus: 'in_progress', submissionStatus: 'pending_review',
  submissionRemarks: null, headAuditorId: 'u1', headAuditorName: 'H', timeCreated: '2026-01-01', updatedAt: '2026-01-01', dueDate: null,
  scorePercentage: 50, guidelineIds: ['g1'],
}
const result = (itemId: string, result: string) => ({
  resultId: `r-${itemId}`, projectId: 'p1', itemId, userId: 'u1', guidelineId: 'g1', result, notes: null, findings: null, evidenceImages: null, timeSubmitted: '2026',
})
const item = (itemId: string, itemName: string) => ({ itemId, guidelineId: 'g1', category: 'Cat', itemDescription: itemName, itemName })
const reply = (decisions: unknown[]) => ({ run: makeRun(), suggestions: [], decisions }) as never

function setup(role = 'head_auditor') {
  useStore.setState({ currentUserId: 'u1', sessionToken: 't', users: [{ id: 'u1', name: 'A', email: 'a@x', role }], guidelines: [] } as never)
}
/** The on-screen pane; the print view is always in the DOM, so it cannot show what the screen shows. */
const screenPane = (container: HTMLElement) => within(container.querySelector('.print\\:hidden') as HTMLElement)
async function openReport() {
  const { container } = render(<MemoryRouter><ReportsPage /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button', { name: /Proj/ }))
  await screen.findAllByText('Needs a policy')
  return container
}

beforeEach(() => {
  vi.mocked(db.fetchAuditReports).mockReset().mockResolvedValue([REPORT] as never)
  vi.mocked(db.fetchComplianceScores).mockReset().mockResolvedValue([])
  vi.mocked(db.fetchAuditResults).mockReset().mockResolvedValue([result('i1', 'non_compliant'), result('i2', 'partially')] as never)
  vi.mocked(db.fetchProjectChecklistItems).mockReset().mockResolvedValue([item('i1', 'Needs a policy'), item('i2', 'Needs a contact')] as never)
  getSuggestions.mockReset()
  setup()
})

describe('ReportsPage provenance badges', () => {
  it('shows each failing item\'s source, in the list and in the print view', async () => {
    getSuggestions.mockResolvedValue(reply([makeDecision({ itemId: 'i1', suggestedResult: 'no', finalResult: 'non_compliant' })]))
    await openReport()
    await waitFor(() => expect(screen.getAllByText('AI suggested No · accepted')).toHaveLength(2))
    expect(screen.getAllByText('Manual')).toHaveLength(2) // i2 has no decision: once in the list, once in print
    expect(getSuggestions).toHaveBeenCalledWith('p1')
  })

  it('renders the report before the badges arrive, then adds them', async () => {
    let resolve!: (v: never) => void
    getSuggestions.mockReturnValue(new Promise<never>((r) => { resolve = r }))
    const container = await openReport()
    expect(screenPane(container).getAllByText('Needs a policy').length).toBeGreaterThan(0)
    expect(screen.queryByText('Manual')).toBeNull()
    expect(screen.queryByText(/AI suggested/)).toBeNull()
    await act(async () => resolve(reply([makeDecision({ itemId: 'i1', suggestedResult: 'no', finalResult: 'non_compliant' })])))
    await waitFor(() => expect(screen.getAllByText('AI suggested No · accepted').length).toBeGreaterThan(0))
  })

  it.each([
    ['503', () => Promise.reject(new api.EvidenceApiError(503, 'down'))],
    ['network', () => Promise.reject(new api.EvidenceApiError(0, 'offline'))],
    ['unexpected', () => Promise.reject(new Error('boom'))],
  ])('a failed suggestions fetch (%s) leaves the report rendering with no badges', async (_name, fail) => {
    getSuggestions.mockImplementation(fail as never)
    const container = await openReport()
    await waitFor(() => expect(getSuggestions).toHaveBeenCalled())
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(screenPane(container).getAllByText('Needs a contact').length).toBeGreaterThan(0)
    expect(screenPane(container).getByRole('heading', { name: 'Proj' })).toBeInTheDocument()
    expect(screen.queryByText('Manual')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a missing session token leaves the report rendering with no badges', async () => {
    const real = await vi.importActual<typeof import('../../evidence/api')>('../../evidence/api')
    getSuggestions.mockImplementation(real.getSuggestions)
    useStore.setState({ sessionToken: null } as never)
    await openReport()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(screen.queryByText('Manual')).toBeNull()
    expect(screen.getAllByText('Needs a policy').length).toBeGreaterThan(0)
  })

  it('does not ask for suggestions as an admin', async () => {
    setup('admin')
    render(<MemoryRouter><ReportsPage /></MemoryRouter>)
    expect(screen.getByText('Access Restricted')).toBeInTheDocument()
    expect(getSuggestions).not.toHaveBeenCalled()
  })

  it('badges only the failing rows: a passing item is not listed, the failing one reads Manual', async () => {
    getSuggestions.mockResolvedValue(reply([]))
    vi.mocked(db.fetchAuditResults).mockResolvedValue([result('i1', 'compliant'), result('i2', 'non_compliant')] as never)
    render(<MemoryRouter><ReportsPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /Proj/ }))
    await screen.findAllByText('Needs a contact')
    await waitFor(() => expect(screen.getAllByText('Manual')).toHaveLength(2))
    const failing = screen.getAllByText('Needs a contact')[0].closest('li') as HTMLElement
    expect(within(failing).getByText('Manual')).toBeInTheDocument()
  })

  describe('switching reports', () => {
    const OTHER = { ...REPORT, projectId: 'p2', projectTitle: 'Other' }
    const pick = async (name: RegExp) => { await userEvent.click(screen.getByRole('button', { name })); await screen.findAllByText('Needs a policy') }
    beforeEach(() => vi.mocked(db.fetchAuditReports).mockResolvedValue([REPORT, OTHER] as never))

    it('does not show the previous reports badges while the next one loads', async () => {
      getSuggestions.mockImplementation((id) =>
        id === 'p1' ? Promise.resolve(reply([makeDecision({ itemId: 'i1', suggestedResult: 'no', finalResult: 'non_compliant' })])) : new Promise<never>(() => undefined))
      render(<MemoryRouter><ReportsPage /></MemoryRouter>)
      await userEvent.click(await screen.findByRole('button', { name: /Proj/ }))
      await waitFor(() => expect(screen.getAllByText('AI suggested No · accepted').length).toBeGreaterThan(0))
      await pick(/Other/)
      expect(screen.queryByText(/AI suggested/)).toBeNull()
      expect(screen.queryByText('Manual')).toBeNull()
    })

    it('ignores a late answer for the report that is no longer selected', async () => {
      let lateA!: (v: never) => void
      getSuggestions.mockImplementation((id) =>
        id === 'p1' ? new Promise<never>((r) => { lateA = r }) : Promise.resolve(reply([])))
      render(<MemoryRouter><ReportsPage /></MemoryRouter>)
      await userEvent.click(await screen.findByRole('button', { name: /Proj/ }))
      await screen.findAllByText('Needs a policy')
      await pick(/Other/)
      await waitFor(() => expect(screen.getAllByText('Manual').length).toBeGreaterThan(0))
      await act(async () => lateA(reply([makeDecision({ itemId: 'i1', suggestedResult: 'no', finalResult: 'non_compliant' })])))
      expect(screen.queryByText(/AI suggested/)).toBeNull()
      expect(screen.getAllByText('Manual').length).toBeGreaterThan(0)
    })
  })
})
