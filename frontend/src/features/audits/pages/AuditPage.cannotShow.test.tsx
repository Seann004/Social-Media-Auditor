import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const POLICY = 'The privacy policy for younger users is easy to find.'
const APP = 'Accounts of users under 16 are private by default.'
const ITEMS = [
  { id: 'i1', guidelineId: 'g1', category: 'Alpha', text: POLICY, severity: 'major', itemCode: 'C1' },
  { id: 'i2', guidelineId: 'g1', category: 'Alpha', text: APP, severity: 'major', itemCode: 'C2' },
]
vi.mock('../../../hooks/useProjectData', () => ({
  useProjectData: () => ({ checklistItems: ITEMS, loading: false, error: null, reload: vi.fn(), evidenceMap: {}, responses: {} }),
}))
vi.mock('../../../lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  activateProject: vi.fn(),
  upsertAuditResult: vi.fn(),
  saveAuditFindings: vi.fn(),
  saveEvidenceImages: vi.fn(),
  fetchEvidenceForItems: vi.fn(async () => []),
  fetchAnswerSuggestions: vi.fn(async () => []),
  fetchSimilarItems: vi.fn(async () => []),
  fetchProjectReliability: vi.fn(async () => ({ kappa: null, sharedItems: 0, raterPair: null })),
}))
vi.mock('../../evidence/api', async (orig) => ({
  ...(await orig<typeof import('../../evidence/api')>()),
  postDecision: vi.fn(),
  getLatestRun: vi.fn(),
  getSuggestions: vi.fn(),
  getSources: vi.fn(),
  getAppSetup: vi.fn(),
  getItemKinds: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../store/useStore'
import * as db from '../../../lib/db'
import * as api from '../../evidence/api'
import { makeRun, makeSuggestion } from '../../evidence/testFixtures'
import { forgetItemKinds } from '../../evidence/useItemKinds'
import AuditPage from './AuditPage'

const NOTE = "This source can't show this item."
const AI_REASON = 'No step of the check showed this.'
const FLAG = { type: 'missing_evidence', reason: AI_REASON } as const
const noResult = (id: string, itemId: string) => makeSuggestion({ id, itemId, source: 'app', suggestedResult: null, reason: AI_REASON, flags: [FLAG] })

function setup() {
  useStore.setState({
    currentUserId: 'u1', authToken: 't', isAuthenticated: true, loading: false,
    users: [{ id: 'u1', name: 'A', email: 'a@x', role: 'auditor' }],
    projects: [{ id: 'p1', name: 'P', platform: 'X', description: '', status: 'in_progress', submissionStatus: 'not_submitted', guidelineIds: ['g1'], auditorIds: ['u1'], scope: [], createdAt: '2026-01-01', dueDate: '2026-12-01', createdBy: 'u1' }],
    guidelines: [{ id: 'g1', name: 'G', shortName: 'G', version: '1', description: '', source: '', categories: ['Alpha'], itemCount: 2, lastUpdated: '' }],
    checklistItems: ITEMS,
    responses: {},
    allResponses: {},
    resolutions: {},
    projectItemCounts: {},
    complianceMap: {},
  } as never)
}
const mount = () => render(<MemoryRouter initialEntries={['/audits/p1']}><Routes><Route path="/audits/:id" element={<AuditPage />} /></Routes></MemoryRouter>)

function answer(run = makeRun({ source: 'app', checkedItemIds: ['i1', 'i2'] })) {
  vi.mocked(api.getLatestRun).mockResolvedValue({ run, pages: [] } as never)
  vi.mocked(api.getSuggestions).mockResolvedValue({ run, suggestions: [noResult('s1', 'i1'), noResult('s2', 'i2')], decisions: [] } as never)
}

beforeEach(() => {
  for (const m of [vi.mocked(api.getSuggestions), vi.mocked(api.getLatestRun), vi.mocked(api.getSources), vi.mocked(api.getAppSetup), vi.mocked(api.getItemKinds), vi.mocked(db.fetchProjectComplianceSummary)]) m.mockReset()
  forgetItemKinds()
  // The AI's high-confidence kinds: i1 is a policy item, i2 an app item.
  vi.mocked(api.getItemKinds).mockResolvedValue({ kinds: { i1: { kind: 'neither', reason: 'A company policy, not a screen or code.' }, i2: { kind: 'app', reason: 'A setting a user can see.' } } })
  vi.mocked(db.fetchProjectComplianceSummary).mockResolvedValue({ p1: { percentage: 0, answered: 0, total: 2 } } as never)
  vi.mocked(api.getSources).mockResolvedValue({ source: null, permission: null } as never)
  vi.mocked(api.getAppSetup).mockResolvedValue({ app: null, accounts: [], secretKeyConfigured: true } as never)
})

/** The kinds are asked for when the drawer first opens; the cards read the same answer. */
async function openDrawerOnce() {
  await userEvent.click(await screen.findByRole('button', { name: 'Open AI evidence' }))
  await userEvent.keyboard('{Escape}')
}

describe("the audit page says when an app check can't show an item", () => {
  it('notes it on the policy item only, keeping its reason, its review label and the flagged counts', async () => {
    setup(); answer(); mount()
    await openDrawerOnce()
    const note = await screen.findByText(NOTE)
    expect(screen.getAllByText(NOTE)).toHaveLength(1)
    expect(note.closest('[data-tone="hint"]')).toHaveTextContent(`${NOTE} A company policy, not a screen or code.`)
    const cards = screen.getAllByRole('region', { name: 'AI suggestion' })
    expect(cards).toHaveLength(2)
    const withNote = cards.find((card) => within(card).queryByText(NOTE) !== null)!
    expect(within(withNote).getByText(AI_REASON)).toBeInTheDocument()
    expect(within(withNote).getByText('Needs human review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Flagged by AI only/ })).toBeInTheDocument()
    expect(screen.getByLabelText('2 flagged by AI')).toBeInTheDocument()
  })

  it('says nothing before the kinds are known: the page itself asks for none', async () => {
    setup(); answer(); mount()
    expect(await screen.findAllByRole('region', { name: 'AI suggestion' })).toHaveLength(2)
    expect(api.getItemKinds).not.toHaveBeenCalled()
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it('says nothing for an item the run left unchecked', async () => {
    setup(); answer(makeRun({ source: 'app', status: 'partial', checkedItemIds: ['i1', 'i2'], uncheckedItemIds: ['i1'] })); mount()
    await openDrawerOnce()
    await waitFor(() => expect(api.getItemKinds).toHaveBeenCalled())
    expect(await screen.findAllByRole('region', { name: 'AI suggestion' })).toHaveLength(2)
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
