import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const ITEMS = [
  { id: 'i1', guidelineId: 'g1', category: 'Alpha', text: 'Item one', severity: 'high' },
  { id: 'i2', guidelineId: 'g1', category: 'Alpha', text: 'Item two', severity: 'high' },
  { id: 'i3', guidelineId: 'g1', category: 'Beta', text: 'Item three', severity: 'high' },
]
vi.mock('../../../hooks/useProjectData', () => ({
  useProjectData: () => ({ checklistItems: ITEMS, loading: false, error: null, reload: vi.fn(), evidenceMap: {}, responses: {} }),
}))
vi.mock('../../../lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  updateProject: vi.fn(),
  upsertAuditResult: vi.fn(),
  saveAuditFindings: vi.fn(),
  saveEvidenceImages: vi.fn(),
}))
vi.mock('../../evidence/api', async (orig) => ({
  ...(await orig<typeof import('../../evidence/api')>()),
  postDecision: vi.fn(),
  getLatestRun: vi.fn(),
  getSuggestions: vi.fn(),
  getSources: vi.fn(),
}))

import * as db from '../../../lib/db'
import * as api from '../../evidence/api'
import { makeDecision, makeRun, makeSuggestion } from '../../evidence/testFixtures'
import { useStore } from '../../../store/useStore'
import AuditPage from './AuditPage'

const sugg = vi.mocked(api.getSuggestions)
const FLAG = { type: 'missing_evidence', reason: 'No page mentions it' } as const

function setup(opts: { role?: string; responses?: Record<string, unknown> } = {}) {
  useStore.setState({
    currentUserId: 'u1', sessionToken: 't', isAuthenticated: true, loading: false,
    users: [{ id: 'u1', name: 'A', email: 'a@x', role: opts.role ?? 'auditor' }],
    projects: [{ id: 'p1', name: 'P', platform: 'X', description: '', status: 'in_progress', submissionStatus: 'not_submitted', guidelineIds: ['g1'], auditorIds: ['u1'], scope: [], createdAt: '2026-01-01', dueDate: '2026-12-01', createdBy: 'u1' }],
    guidelines: [{ id: 'g1', name: 'G', shortName: 'G', version: '1', description: '', source: '', categories: ['Alpha', 'Beta'], itemCount: 3, lastUpdated: '' }],
    checklistItems: ITEMS,
    responses: opts.responses ?? {},
    complianceMap: {},
  } as never)
}
const resp = (itemId: string, status: string) => ({ id: 'r', projectId: 'p1', checklistItemId: itemId, status, notes: '', auditorId: 'u1', updatedAt: '2026' })
const reply = (suggestions: unknown[], decisions: unknown[] = []) => ({ run: makeRun(), suggestions, decisions }) as never
const FLAGGED_I1 = makeSuggestion({ id: 's1', itemId: 'i1', flags: [FLAG] })
const PLAIN_I2 = makeSuggestion({ id: 's2', itemId: 'i2', flags: [] })
const FLAGGED_I3 = makeSuggestion({ id: 's3', itemId: 'i3', flags: [FLAG] })
const mount = () => render(<MemoryRouter initialEntries={['/audits/p1']}><Routes><Route path="/audits/:id" element={<AuditPage />} /></Routes></MemoryRouter>)
const toggle = () => screen.findByRole('button', { name: /Flagged by AI only/ })

beforeEach(() => {
  for (const m of [sugg, vi.mocked(api.getLatestRun), vi.mocked(api.getSources), vi.mocked(db.fetchProjectComplianceSummary), vi.mocked(api.postDecision), vi.mocked(db.upsertAuditResult)]) m.mockReset()
  vi.mocked(db.fetchProjectComplianceSummary).mockResolvedValue({ p1: { total: 3 } } as never)
  vi.mocked(api.getLatestRun).mockResolvedValue({ run: makeRun(), pages: [] } as never)
  vi.mocked(api.getSources).mockResolvedValue({ source: null, permission: null } as never)
  sugg.mockResolvedValue(reply([FLAGGED_I1, PLAIN_I2, FLAGGED_I3]))
})

describe('flagged filter, counts and provenance on the audit page', () => {
  it('narrows the list to flagged suggestions and back', async () => {
    setup(); mount()
    await userEvent.click(await toggle())
    expect(screen.getByText('Item one')).toBeInTheDocument()
    expect(screen.queryByText('Item two')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Flagged by AI only/ }))
    expect(screen.getByText('Item two')).toBeInTheDocument()
  })

  it('has no filter when there are no suggestions', async () => {
    setup(); sugg.mockResolvedValue(reply([])); mount()
    await waitFor(() => expect(sugg).toHaveBeenCalled())
    await screen.findByText('Item one')
    expect(screen.queryByRole('button', { name: /Flagged by AI only/ })).toBeNull()
  })

  it('shows the flagged count per category, only when above zero', async () => {
    setup({ role: 'head_auditor' }); mount()
    await toggle()
    expect(screen.getByRole('option', { name: /Alpha.*1 flagged by AI/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Beta.*1 flagged by AI/ })).toBeInTheDocument()
    expect(screen.getByLabelText('1 flagged by AI')).toBeInTheDocument() // Alpha is expanded in the side navigation; Beta is collapsed
  })

  it('shows no count for a category without flagged suggestions', async () => {
    setup(); sugg.mockResolvedValue(reply([FLAGGED_I1, PLAIN_I2])); mount()
    await toggle()
    expect(screen.getByRole('option', { name: /Alpha.*1 flagged by AI/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Beta/ }).textContent).not.toMatch(/flagged by AI/)
  })

  it('says so when the category has nothing flagged, and lets the auditor turn the filter off', async () => {
    setup(); sugg.mockResolvedValue(reply([FLAGGED_I1, PLAIN_I2])); mount()
    await userEvent.click(await toggle())
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Beta')
    expect(screen.getByText('No flagged suggestions in this category.')).toBeInTheDocument()
    expect(screen.queryByText('Item three')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show all items' }))
    expect(screen.getByText('Item three')).toBeInTheDocument()
  })

  it('leaves progress and Submit alone while it is on', async () => {
    // i2 is unflagged and unanswered: it is hidden by the filter but still blocks Submit
    setup({ responses: { p1__i1: resp('i1', 'compliant'), p1__i3: resp('i3', 'compliant') } }); mount()
    const submit = () => screen.getByRole('button', { name: /Submit for Review/ })
    await screen.findByText('Item two')
    expect(submit()).toBeDisabled()
    const progress = () => screen.getAllByText(/^\d+\/\d+$/).map((e) => e.textContent)
    const before = progress()
    expect(before.length).toBeGreaterThan(0)
    await userEvent.click(await toggle())
    expect(screen.queryByText('Item two')).toBeNull()
    expect(submit()).toBeDisabled()
    expect(progress()).toEqual(before)
  })

  it('enables Submit with the filter on once every item is answered', async () => {
    setup({ responses: { p1__i1: resp('i1', 'compliant'), p1__i2: resp('i2', 'compliant'), p1__i3: resp('i3', 'compliant') } }); mount()
    await userEvent.click(await toggle())
    expect(screen.getByRole('button', { name: /Submit for Review/ })).toBeEnabled()
  })

  it('keeps the header item count unfiltered', async () => {
    setup(); mount()
    await screen.findByText('2 items')
    await userEvent.click(await toggle())
    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('jumping to an unflagged needs_review item turns the filter off so the item shows', async () => {
    setup({ responses: { p1__i2: resp('i2', 'needs_review') } }); mount()
    await userEvent.click(await toggle())
    expect(screen.queryByText('Item two')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /1 Flagged/ }))
    await userEvent.click(screen.getByText('Item two'))
    expect(await screen.findByText('Item two')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Flagged by AI only/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('answers the flagged items through the same controls while filtering', async () => {
    setup(); vi.mocked(db.upsertAuditResult).mockResolvedValue(undefined as never)
    sugg.mockResolvedValue(reply([makeSuggestion({ id: 's1', itemId: 'i1', suggestedResult: null, flags: [FLAG] })]))
    mount()
    await userEvent.click(await toggle())
    const row = screen.getByText('Item one').closest('[class*="px-6 py-5"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(db.upsertAuditResult).toHaveBeenCalledWith('p1', 'i1', 'u1', 'g1', 'compliant', ''))
  })

  it('shows the source of the Head Auditor result: accepted, overridden and manual', async () => {
    setup({ role: 'head_auditor', responses: { p1__i1: resp('i1', 'compliant'), p1__i2: resp('i2', 'partially'), p1__i3: resp('i3', 'compliant') } })
    sugg.mockResolvedValue(reply(
      [FLAGGED_I1, PLAIN_I2],
      [
        makeDecision({ suggestionId: 's1', itemId: 'i1', decision: 'accepted', suggestedResult: 'yes', finalResult: 'compliant' }),
        makeDecision({ id: 'd2', suggestionId: 's2', itemId: 'i2', decision: 'overridden', suggestedResult: 'yes', finalResult: 'partially', overrideReason: '<script>x</script>' }),
      ],
    ))
    const { container } = mount()
    await screen.findByText('AI suggested Yes · accepted')
    expect(screen.getByText('AI suggested Yes · overridden to Partially: <script>x</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
  })

  it('shows Manual for an answer with no decision and nothing for an unanswered item', async () => {
    setup({ role: 'head_auditor', responses: { p1__i1: resp('i1', 'compliant') } })
    sugg.mockResolvedValue(reply([]))
    mount()
    await screen.findByText('Item one')
    await waitFor(() => expect(screen.getAllByText('Manual')).toHaveLength(1))
  })
})
