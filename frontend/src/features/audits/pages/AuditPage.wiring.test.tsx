import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let evidenceMapValue: Record<string, { url: string; name: string }[]> = {}
const ITEMS = [
  { id: 'i1', guidelineId: 'g1', category: 'Cat', text: 'Item one', severity: 'major', itemCode: 'C1' },
  { id: 'i2', guidelineId: 'g1', category: 'Cat', text: 'Item two', severity: 'major', itemCode: 'C2' },
]
vi.mock('../../../hooks/useProjectData', () => ({
  useProjectData: () => ({ checklistItems: ITEMS, loading: false, error: null, reload: vi.fn(), evidenceMap: evidenceMapValue, responses: {} }),
}))
vi.mock('../../../lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  activateProject: vi.fn(),
  upsertAuditResult: vi.fn(),
  saveAuditFindings: vi.fn(),
  saveEvidenceImages: vi.fn(),
  // Photos are loaded per item and per auditor; the test map stands for what the server holds.
  fetchEvidenceForItems: vi.fn(async (_projectId: string, itemIds: string[]) =>
    itemIds.filter((itemId) => evidenceMapValue[itemId]).map((itemId) => ({ itemId, userId: 'u1', images: evidenceMapValue[itemId] }))),
  fetchAnswerSuggestions: vi.fn(async () => []),
  fetchSimilarItems: vi.fn(async () => []),
  fillInSameRequirementItems: vi.fn(async () => []),
  fetchProjectReliability: vi.fn(async () => ({ kappa: null, sharedItems: 0, raterPair: null })),
}))
vi.mock('../../evidence/api', async (orig) => ({
  ...(await orig<typeof import('../../evidence/api')>()),
  postDecision: vi.fn(),
  getScreenshotUrl: vi.fn(),
  getLatestRun: vi.fn(),
  getSuggestions: vi.fn(),
  getSources: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../store/useStore'
import * as db from '../../../lib/db'
import * as api from '../../evidence/api'
import { EvidenceApiError } from '../../evidence/api'
import { makeDecision, makeRun, makeSuggestion } from '../../evidence/testFixtures'
import AuditPage from './AuditPage'

const post = vi.mocked(api.postDecision)
const upsert = vi.mocked(db.upsertAuditResult)
const saveF = vi.mocked(db.saveAuditFindings)
const sugg = vi.mocked(api.getSuggestions)

function setup(opts: { role?: string; submissionStatus?: string; responses?: Record<string, unknown> } = {}) {
  useStore.setState({
    currentUserId: 'u1', authToken: 't', isAuthenticated: true, loading: false,
    users: [{ id: 'u1', name: 'A', email: 'a@x', role: opts.role ?? 'auditor' }],
    projects: [{ id: 'p1', name: 'P', platform: 'X', description: '', status: 'in_progress', submissionStatus: opts.submissionStatus ?? 'not_submitted', guidelineIds: ['g1'], auditorIds: ['u1'], scope: [], createdAt: '2026-01-01', dueDate: '2026-12-01', createdBy: 'u1' }],
    guidelines: [{ id: 'g1', name: 'G', shortName: 'G', version: '1', description: '', source: '', categories: ['Cat'], itemCount: 2, lastUpdated: '' }],
    checklistItems: ITEMS,
    responses: opts.responses ?? {},
    // The page reads each auditor's own row from allResponses; these tests have one auditor.
    allResponses: Object.fromEntries(Object.entries(opts.responses ?? {}).map(([k, v]) => [k, [v]])),
    resolutions: {},
    projectItemCounts: {},
    complianceMap: {},
  } as never)
}
const resp = (status: string, findings?: string, notes = '') => ({ id: 'r', projectId: 'p1', checklistItemId: 'i1', status, notes, findings, auditorId: 'u1', updatedAt: '2026' })
const tree = () => <MemoryRouter initialEntries={['/audits/p1']}><Routes><Route path="/audits/:id" element={<AuditPage />} /></Routes></MemoryRouter>
const mount = () => render(tree())
const rowOf = (text: string) => screen.getByText(text).closest('[class*="px-6 py-5"]') as HTMLElement
const suggestionsReply = (suggestions: unknown[], decisions: unknown[] = []) => ({ run: makeRun(), suggestions, decisions }) as never
const reply = (status: string, findings: string | null, evidenceImages: unknown[], d: 'accepted' | 'overridden' = 'accepted') =>
  ({ decision: makeDecision({ decision: d, finalResult: status as never, itemId: 'i1' }), answer: { itemId: 'i1', status, findings, evidenceImages } }) as never
const S1 = makeSuggestion({ id: 's1', itemId: 'i1', suggestedResult: 'yes', reason: 'AI reason', quotes: [] })
const tick = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

beforeEach(() => {
  evidenceMapValue = {}
  for (const m of [post, upsert, saveF, sugg, vi.mocked(api.getLatestRun), vi.mocked(api.getSources), vi.mocked(db.fetchProjectComplianceSummary), vi.mocked(db.saveEvidenceImages)]) m.mockReset()
  upsert.mockResolvedValue(undefined as never)
  saveF.mockResolvedValue(undefined as never)
  vi.mocked(db.saveEvidenceImages).mockResolvedValue(undefined as never)
  vi.mocked(db.fetchProjectComplianceSummary).mockResolvedValue({ p1: { percentage: 0, answered: 0, total: 1 } } as never)
  vi.mocked(api.getLatestRun).mockResolvedValue({ run: makeRun(), pages: [] } as never)
  vi.mocked(api.getSources).mockResolvedValue({ source: null, permission: null } as never)
  sugg.mockResolvedValue(suggestionsReply([S1]))
})

describe('page wiring (should hold)', () => {
  it('W1 item without a suggestion: Yes saves through setResponse, no decision', async () => {
    setup(); sugg.mockResolvedValue(suggestionsReply([])); mount()
    await waitFor(() => expect(sugg).toHaveBeenCalled())
    await userEvent.click(within(rowOf('Item two')).getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('p1', 'i2', 'u1', 'g1', 'compliant', ''))
    expect(post).not.toHaveBeenCalled()
  })
  it('W2 AI result click: accepted, findings box + photo count update, refresh once more', async () => {
    setup({ responses: { p1__i1: resp('non_compliant') } }); mount()
    await within(rowOf('Item one')).findByRole('button', { name: 'Accept suggestion' })
    const before = sugg.mock.calls.length
    post.mockResolvedValue(reply('compliant', 'AI reason', [{ url: 'https://x/a.jpg', name: 'AI evidence a' }]))
    // What the server holds once the decision is saved: the page reads the item's photos back from it.
    evidenceMapValue = { i1: [{ url: 'https://x/a.jpg', name: 'AI evidence a' }] }
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('s1', { decision: 'accepted', origin: 'answer_button' }))
    await waitFor(() => expect(within(rowOf('Item one')).getByPlaceholderText(/Describe what you observed/)).toHaveValue('AI reason'))
    expect(within(rowOf('Item one')).getByRole('button', { name: /1 photo/ })).toBeInTheDocument()
    await waitFor(() => expect(sugg.mock.calls.length).toBe(before + 1))
    expect(upsert).not.toHaveBeenCalled()
  })
  it('W3 different answer: dialog, overridden, empty list keeps photos, findings kept', async () => {
    evidenceMapValue = { i1: [{ url: 'https://x/mine.jpg', name: 'mine' }] }
    setup({ responses: { p1__i1: resp('compliant', 'mine text') } })
    sugg.mockResolvedValue(suggestionsReply([S1], [makeDecision({ suggestionId: 's1', itemId: 'i1' })]))
    mount()
    await within(rowOf('Item one')).findByText('Accepted')
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: /^No$/ }))
    const dlg = await screen.findByRole('dialog')
    expect(post).not.toHaveBeenCalled()
    post.mockResolvedValue(reply('non_compliant', null, [], 'overridden'))
    await userEvent.type(within(dlg).getByLabelText('Reason'), 'because')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Confirm override' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('s1', { decision: 'overridden', origin: 'answer_button', finalResult: 'non_compliant', overrideReason: 'because' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(rowOf('Item one')).getByPlaceholderText(/Describe what you observed/)).toHaveValue('mine text')
    expect(within(rowOf('Item one')).getByRole('button', { name: /1 photo/ })).toBeInTheDocument()
  })
  it('W4 typed findings travel with the decision (real box, real blur)', async () => {
    setup({ responses: { p1__i1: resp('non_compliant') } }); mount()
    const row = () => within(rowOf('Item one'))
    await row().findByRole('button', { name: 'Accept suggestion' })
    post.mockResolvedValue(reply('compliant', 'typed', []))
    await userEvent.type(row().getByPlaceholderText(/Describe what you observed/), 'typed')
    await userEvent.click(row().getByRole('button', { name: 'Accept suggestion' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('s1', { decision: 'accepted', origin: 'card', findings: 'typed' }))
    await waitFor(() => expect(row().getByPlaceholderText(/Describe what you observed/)).toHaveValue('typed'))
  })
  it('W4b the decision waits for a blur save that is still in flight', async () => {
    setup({ responses: { p1__i1: resp('non_compliant') } }); mount()
    const row = () => within(rowOf('Item one'))
    await row().findByRole('button', { name: 'Accept suggestion' })
    let releaseSave: () => void = () => {}
    saveF.mockReturnValue(new Promise<void>((r) => { releaseSave = r }) as never)
    post.mockResolvedValue(reply('compliant', 'typed', []))
    await userEvent.type(row().getByPlaceholderText(/Describe what you observed/), 'typed')
    await userEvent.click(row().getByRole('button', { name: 'Accept suggestion' }))
    await waitFor(() => expect(saveF).toHaveBeenCalled())
    await tick(30)
    expect(post).not.toHaveBeenCalled()
    await act(async () => { releaseSave(); await new Promise((r) => setTimeout(r, 20)) })
    await waitFor(() => expect(post).toHaveBeenCalled())
  })
  it('W5 blur: untouched box saves stored; clear saves empty', async () => {
    setup({ responses: { p1__i1: resp('compliant', 'stored') } }); sugg.mockResolvedValue(suggestionsReply([])); mount()
    const box = within(rowOf('Item one')).getByPlaceholderText(/Describe what you observed/)
    fireEvent.focus(box); fireEvent.blur(box)
    await waitFor(() => expect(saveF).toHaveBeenLastCalledWith('p1', 'i1', 'u1', 'stored'))
    fireEvent.change(box, { target: { value: '' } }); fireEvent.blur(box)
    await waitFor(() => expect(saveF).toHaveBeenLastCalledWith('p1', 'i1', 'u1', ''))
    await waitFor(() => expect(box).toHaveValue(''))
  })
  it('W5c blur: an untouched notes box saves the stored notes, not an empty string', async () => {
    setup({ responses: { p1__i1: resp('compliant', undefined, 'stored note') } }); sugg.mockResolvedValue(suggestionsReply([])); mount()
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: /Notes/ }))
    const box = await within(rowOf('Item one')).findByPlaceholderText(/Record evidence/)
    fireEvent.focus(box); fireEvent.blur(box)
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('p1', 'i1', 'u1', 'g1', 'compliant', 'stored note'))
  })
  it('W5b blur after a decision saves the decision text, not stale typing', async () => {
    setup({ responses: { p1__i1: resp('non_compliant') } }); mount()
    const row = () => within(rowOf('Item one'))
    await row().findByRole('button', { name: 'Accept suggestion' })
    post.mockResolvedValue(reply('compliant', 'AI reason', []))
    await userEvent.click(row().getByRole('button', { name: 'Accept suggestion' }))
    await waitFor(() => expect(row().getByPlaceholderText(/Describe what you observed/)).toHaveValue('AI reason'))
    const box = row().getByPlaceholderText(/Describe what you observed/)
    fireEvent.focus(box); fireEvent.blur(box)
    await waitFor(() => expect(saveF).toHaveBeenLastCalledWith('p1', 'i1', 'u1', 'AI reason'))
  })
  it('W6 after accept, a later evidenceMap change does not undo or duplicate', async () => {
    evidenceMapValue = { i1: [{ url: 'https://x/mine.jpg', name: 'mine' }] }
    setup({ responses: { p1__i1: resp('non_compliant') } })
    const r = mount()
    await within(rowOf('Item one')).findByRole('button', { name: 'Accept suggestion' })
    post.mockResolvedValue(reply('compliant', 'AI reason', [{ url: 'https://x/mine.jpg', name: 'mine' }, { url: 'https://x/a.jpg', name: 'AI a' }]))
    evidenceMapValue = { i1: [{ url: 'https://x/mine.jpg', name: 'mine' }, { url: 'https://x/a.jpg', name: 'AI a' }] }
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: 'Accept suggestion' }))
    await within(rowOf('Item one')).findByRole('button', { name: /2 photos/ })
    evidenceMapValue = { i1: [{ url: 'https://x/mine.jpg', name: 'mine' }, { url: 'https://x/a.jpg', name: 'AI a' }], i2: [] }
    r.rerender(tree())
    expect(within(rowOf('Item one')).getByRole('button', { name: /2 photos/ })).toBeInTheDocument()
  })
  it('W7 Head Auditor sees a read-only card and no answer buttons, no decision', async () => {
    setup({ role: 'head_auditor', responses: { p1__i1: resp('non_compliant') } }); mount()
    await within(rowOf('Item one')).findByRole('region', { name: 'AI suggestion' })
    expect(within(rowOf('Item one')).queryByRole('button', { name: /Accept|Override|Keep/ })).toBeNull()
    expect(within(rowOf('Item one')).queryByRole('button', { name: /^Yes$/ })).toBeNull()
  })
  it('W8 Flag saves through setResponse', async () => {
    setup({ responses: { p1__i1: resp('compliant') } })
    sugg.mockResolvedValue(suggestionsReply([S1], [makeDecision({ suggestionId: 's1', itemId: 'i1' })])); mount()
    await within(rowOf('Item one')).findByText('Accepted')
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: /Flag/ }))
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('p1', 'i1', 'u1', 'g1', 'needs_review', ''))
    expect(post).not.toHaveBeenCalled()
    expect(within(rowOf('Item one')).queryByText('Accepted')).toBeNull()
  })
})

describe('suspected problems (a failure here confirms the problem)', () => {
  it('P1 a note typed before the first answer travels with the decision', async () => {
    setup(); mount()
    const row = () => within(rowOf('Item one'))
    await row().findByRole('button', { name: 'Accept' })
    await userEvent.click(row().getByRole('button', { name: /Add note/ }))
    await userEvent.type(await row().findByPlaceholderText(/Record evidence/), 'my note')
    post.mockResolvedValue(reply('compliant', 'AI reason', []))
    await userEvent.click(row().getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('s1', { decision: 'accepted', origin: 'answer_button', notes: 'my note' }))
  })
  it('P1b control: the same note through the plain save path is saved', async () => {
    setup(); sugg.mockResolvedValue(suggestionsReply([])); mount()
    await waitFor(() => expect(sugg).toHaveBeenCalled()); await tick()
    const row = () => within(rowOf('Item one'))
    await userEvent.click(row().getByRole('button', { name: /Add note/ }))
    await userEvent.type(await row().findByPlaceholderText(/Record evidence/), 'my note')
    await userEvent.click(row().getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(upsert.mock.calls.some((c) => c[5] === 'my note')).toBe(true))
  })
  it('P2 the findings and notes boxes are read-only while a decision is in flight', async () => {
    setup({ responses: { p1__i1: resp('non_compliant', 'mine', 'a note') } }); mount()
    const row = () => within(rowOf('Item one'))
    await row().findByRole('button', { name: 'Accept suggestion' })
    await userEvent.click(row().getByRole('button', { name: /Notes/ }))
    let release: (v: never) => void = () => {}
    post.mockReturnValue(new Promise((r) => { release = r as never }))
    await userEvent.click(row().getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(row().getByPlaceholderText(/Describe what you observed/)).toHaveAttribute('readonly')
    expect(row().getByPlaceholderText(/Record evidence/)).toHaveAttribute('readonly')
    await act(async () => { release(reply('compliant', 'mine', [])); await new Promise((r) => setTimeout(r, 20)) })
    expect(row().getByPlaceholderText(/Describe what you observed/)).not.toHaveAttribute('readonly')
  })
  it('P3 a failed AI-result click on an item with no card tells the auditor', async () => {
    setup({ responses: { p1__i1: resp('non_compliant') } })
    sugg.mockResolvedValue(suggestionsReply([], [makeDecision({ suggestionId: 'old', itemId: 'i1', suggestedResult: 'yes', decision: 'overridden', finalResult: 'non_compliant' })]))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    mount()
    await waitFor(() => expect(sugg).toHaveBeenCalled()); await tick()
    post.mockRejectedValue(new EvidenceApiError(409, 'The audit has been submitted, so its answers can no longer change.'))
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    await tick()
    const shown = screen.queryByText(/can no longer change/) !== null || alertSpy.mock.calls.length > 0
    alertSpy.mockRestore()
    expect(shown).toBe(true)
  })
  it('P4 answer buttons do not write while a decision is posting', async () => {
    setup({ responses: { p1__i1: resp('non_compliant') } }); mount()
    const row = () => within(rowOf('Item one'))
    await row().findByRole('button', { name: 'Accept suggestion' })
    post.mockReturnValue(new Promise(() => {}))
    await userEvent.click(row().getByRole('button', { name: /^Yes$/ }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(row().getByRole('button', { name: /Flag/ })).toBeDisabled()
    expect(row().getByRole('button', { name: /^No$/ })).toBeDisabled()
    await userEvent.click(row().getByRole('button', { name: /Flag/ }))
    await tick()
    expect(upsert).not.toHaveBeenCalled()
  })
  it('P5 a second decision finishing during the first refresh shows up on its card', async () => {
    const S2 = makeSuggestion({ id: 's2', itemId: 'i2', suggestedResult: 'yes', reason: 'AI two', quotes: [] })
    setup({ responses: { p1__i1: resp('non_compliant'), p1__i2: { ...resp('non_compliant'), checklistItemId: 'i2' } } })
    sugg.mockResolvedValue(suggestionsReply([S1, S2])); mount()
    await within(rowOf('Item two')).findByRole('button', { name: 'Accept suggestion' })
    let releaseStale: (v: never) => void = () => {}
    const stale = new Promise((r) => { releaseStale = r as never })
    post.mockResolvedValueOnce(reply('compliant', 'AI reason', []))
    sugg.mockReturnValueOnce(stale as never)
    const callsBefore = sugg.mock.calls.length
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: 'Accept suggestion' }))
    await waitFor(() => expect(sugg.mock.calls.length).toBe(callsBefore + 1))
    const d2 = makeDecision({ id: 'd2', suggestionId: 's2', itemId: 'i2' })
    post.mockResolvedValueOnce({ decision: d2, answer: { itemId: 'i2', status: 'compliant', findings: 'AI two', evidenceImages: [] } } as never)
    sugg.mockResolvedValue(suggestionsReply([S1, S2], [makeDecision({ suggestionId: 's1', itemId: 'i1' }), d2]))
    await userEvent.click(within(rowOf('Item two')).getByRole('button', { name: 'Accept suggestion' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    await tick()
    await act(async () => { releaseStale(suggestionsReply([S1, S2], [makeDecision({ suggestionId: 's1', itemId: 'i1' })])); await new Promise((r) => setTimeout(r, 30)) })
    expect(within(rowOf('Item two')).queryByText('Accepted')).not.toBeNull()
  })
  it('P7 locked: the answer buttons are disabled and an auditor click writes nothing', async () => {
    setup({ submissionStatus: 'pending_review', responses: { p1__i1: resp('compliant') } })
    sugg.mockResolvedValue(suggestionsReply([S1], [makeDecision({ suggestionId: 's1', itemId: 'i1' })])); mount()
    await within(rowOf('Item one')).findByText('Accepted')
    for (const name of [/^Yes$/, /^No$/, /^Partially$/, /^N\/A$/, /Flag/]) {
      // (an item's reference link can also be named N/A, so look for the disabled answer button)
      expect(within(rowOf('Item one')).getAllByRole('button', { name }).some((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    }
    await userEvent.click(within(rowOf('Item one')).getByRole('button', { name: /^No$/ }))
    await tick()
    expect(post).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
  it('P7b approved is locked too, rejected is not', async () => {
    setup({ submissionStatus: 'approved', responses: { p1__i1: resp('compliant') } }); sugg.mockResolvedValue(suggestionsReply([])); const r = mount()
    expect(within(rowOf('Item one')).getByRole('button', { name: /^No$/ })).toBeDisabled()
    r.unmount()
    setup({ submissionStatus: 'rejected', responses: { p1__i1: resp('compliant') } }); sugg.mockResolvedValue(suggestionsReply([])); mount()
    expect(within(rowOf('Item one')).getByRole('button', { name: /^No$/ })).toBeEnabled()
  })
})
