import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { EvidenceApiError } from '../api'
import { useStore } from '../../../store/useStore'
import { makePage, makeRun, makeSuggestion } from '../testFixtures'
import type { LatestRunResponse, SourcesResponse, SuggestionsResponse } from '../types'
import { useEvidence } from '../useEvidence'
import EvidencePanel from './EvidencePanel'
import type { UserRole } from '../../../types'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getSources: vi.fn(),
    saveSources: vi.fn(),
    setPermission: vi.fn(),
    startRun: vi.fn(),
    reassess: vi.fn(),
    getLatestRun: vi.fn(),
    getSuggestions: vi.fn(),
  }
})

const m = {
  getSources: vi.mocked(api.getSources),
  saveSources: vi.mocked(api.saveSources),
  setPermission: vi.mocked(api.setPermission),
  startRun: vi.mocked(api.startRun),
  reassess: vi.mocked(api.reassess),
  getLatestRun: vi.mocked(api.getLatestRun),
  getSuggestions: vi.mocked(api.getSuggestions),
}

function Harness({ role = 'auditor', locked = false, projectId = 'p1' }: { role?: UserRole; locked?: boolean; projectId?: string }) {
  const evidence = useEvidence(projectId, { enabled: role !== 'admin' })
  return <EvidencePanel projectId={projectId} role={role} evidence={evidence} locked={locked} publicPagesEnabled />
}

const sources = (urls: string[] = ['https://a.example/'], granted = false): SourcesResponse => ({
  source: { id: 'src', projectId: 'p1', startUrls: urls, createdBy: 'u1', createdAt: '2026-11-04T09:00:00.000Z' },
  permission: granted
    ? { id: 'perm', projectId: 'p1', granted: true, note: 'Emailed', recordedBy: 'u1', recordedAt: '2026-11-04T09:00:00.000Z' }
    : null,
})
const latest = (run: ReturnType<typeof makeRun> | null, pages = run ? [makePage()] : []): LatestRunResponse => ({ run, pages })
const results = (over: Partial<SuggestionsResponse> = {}): SuggestionsResponse => ({ run: null, suggestions: [], decisions: [], ...over })
const running = (over = {}) => makeRun({ id: 'run-2', status: 'capturing', finishedAt: null, pagesDone: 2, pagesTotal: 5, categoriesDone: 0, categoriesTotal: 4, ...over })

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  useStore.setState({ authToken: null })
  Object.values(m).forEach((fn) => fn.mockReset())
  m.getSources.mockResolvedValue(sources())
  m.getLatestRun.mockResolvedValue(latest(null))
  m.getSuggestions.mockResolvedValue(results())
})

afterEach(() => {
  vi.useRealTimers()
})

const runButton = () => screen.getByRole('button', { name: /^run/i })

describe('EvidencePanel', () => {
  it('saves changed links (trimmed, blanks dropped) then starts a run and shows it', async () => {
    const user = userEvent.setup()
    m.saveSources.mockResolvedValue({ source: sources().source! })
    m.startRun.mockResolvedValue({ run: running({ status: 'queued' }) })
    render(<Harness />)
    const box = await screen.findByLabelText(/website links/i)
    await waitFor(() => expect(box).toHaveValue('https://a.example/'))
    await user.clear(box)
    await user.type(box, '  https://a.example/  {Enter}{Enter}https://b.example/privacy ')
    m.getLatestRun.mockResolvedValue(latest(running({ status: 'queued' })))
    await user.click(runButton())
    expect(m.saveSources).toHaveBeenCalledWith('p1', ['https://a.example/', 'https://b.example/privacy'])
    expect(m.startRun).toHaveBeenCalledWith('p1')
    expect(m.saveSources.mock.invocationCallOrder[0]).toBeLessThan(m.startRun.mock.invocationCallOrder[0])
    expect(await screen.findByText(/queued/i)).toBeInTheDocument()
  })

  it('shows a validation message from the server and does not start a run', async () => {
    const user = userEvent.setup()
    m.saveSources.mockRejectedValue(new EvidenceApiError(400, 'Link 2 points to a private address.'))
    render(<Harness />)
    const box = await screen.findByLabelText(/website links/i)
    await waitFor(() => expect(box).toHaveValue('https://a.example/'))
    await user.type(box, '{Enter}http://10.0.0.1/')
    await user.click(runButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Link 2 points to a private address.')
    expect(m.startRun).not.toHaveBeenCalled()
  })

  it('does not save when the links are unchanged', async () => {
    const user = userEvent.setup()
    m.startRun.mockResolvedValue({ run: running() })
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    await user.click(runButton())
    expect(m.startRun).toHaveBeenCalledTimes(1)
    expect(m.saveSources).not.toHaveBeenCalled()
  })

  it('starts only one run on a double click', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ run: ReturnType<typeof makeRun> }>()
    m.startRun.mockReturnValue(pending.promise)
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    await user.dblClick(runButton())
    expect(m.startRun).toHaveBeenCalledTimes(1)
    expect(runButton()).toBeDisabled()
    await act(async () => { pending.resolve({ run: running() }) })
  })

  it('shows the run in progress when the server says one is already running (409)', async () => {
    const user = userEvent.setup()
    m.startRun.mockRejectedValue(new EvidenceApiError(409, 'A run is already in progress.'))
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    m.getLatestRun.mockResolvedValue(latest(running()))
    await user.click(runButton())
    expect(await screen.findByText(/pages captured/i)).toBeInTheDocument()
    expect(runButton()).toBeDisabled()
  })

  it('shows the server sentence on a 429', async () => {
    const user = userEvent.setup()
    m.startRun.mockRejectedValue(new EvidenceApiError(429, 'The daily limit of 5 runs was reached.'))
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    await user.click(runButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('The daily limit of 5 runs was reached.')
  })

  it('shows progress while running and disables Run', async () => {
    m.getLatestRun.mockResolvedValue(
      latest(running(), [makePage(), makePage({ id: 'pg-2', url: 'https://a.example/x', accessStatus: 'timeout', accessDetail: 'Timed out after 30 s' })]),
    )
    render(<Harness />)
    const progress = await screen.findByText(/pages captured/i)
    expect(progress.closest('[aria-live="polite"]')).not.toBeNull()
    expect(progress.closest('[aria-live="polite"]')).toHaveTextContent('2 of 5')
    expect(progress.closest('[aria-live="polite"]')).toHaveTextContent(/categories assessed/i)
    expect(screen.getByText('Timed out after 30 s')).toBeInTheDocument()
    expect(runButton()).toBeDisabled()
  })

  it('stops polling when the run finishes and when the panel unmounts', async () => {
    vi.useFakeTimers()
    m.getLatestRun.mockResolvedValueOnce(latest(running())).mockResolvedValue(latest(makeRun({ id: 'run-2' })))
    const { unmount } = render(<Harness />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(m.getLatestRun).toHaveBeenCalledTimes(2)

    m.getLatestRun.mockReset()
    m.getLatestRun.mockResolvedValue(latest(running()))
    const second = render(<Harness />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    second.unmount()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(m.getLatestRun).toHaveBeenCalledTimes(1)
  })

  it('summarises the last run: when, pages, suggestions, flagged count and problems', async () => {
    const result = makeRun({ pagesTotal: 3, pagesDone: 3 })
    m.getLatestRun.mockResolvedValue(latest(result, [makePage(), makePage({ id: 'pg-2', accessStatus: 'login_required', accessDetail: 'Needs a login', url: 'https://a.example/account' }), makePage({ id: 'pg-3' })]))
    m.getSuggestions.mockResolvedValue(
      results({
        run: result,
        suggestions: [
          makeSuggestion({ itemId: 'a' }),
          makeSuggestion({ id: 's2', itemId: 'b', flags: [{ type: 'low_confidence', reason: 'x' }] }),
          makeSuggestion({ id: 's3', itemId: 'c' }),
        ],
      }),
    )
    render(<Harness />)
    const summary = await screen.findByRole('region', { name: /last run/i })
    expect(summary).toHaveTextContent(/3 pages/i)
    expect(summary).toHaveTextContent(/3 suggestions/i)
    expect(summary).toHaveTextContent(/1 flagged/i)
    expect(summary).toHaveTextContent(/1 page.*(could not|problem)/i)
    expect(within(summary).getByText('Needs a login')).toBeInTheDocument()
    expect(within(summary).getByText(/2026/)).toBeInTheDocument()
  })

  it('shows "AI daily limit reached" and the unassessed categories for a partial run', async () => {
    const partial = makeRun({
      status: 'partial',
      error: 'AI daily limit reached; 2 categories not assessed.',
      unassessedCategories: ['Privacy', 'Content Moderation'],
    })
    m.getLatestRun.mockResolvedValue(latest(partial))
    m.getSuggestions.mockResolvedValue(results({ run: partial }))
    render(<Harness />)
    expect(await screen.findByText(/AI daily limit reached/)).toBeInTheDocument()
    expect(screen.getByText(/Privacy/)).toBeInTheDocument()
    expect(screen.getByText(/Content Moderation/)).toBeInTheDocument()
  })

  it('offers Re-assess unfinished and Re-assess all categories against the result run', async () => {
    const user = userEvent.setup()
    const result = makeRun({ id: 'run-9' })
    m.getLatestRun.mockResolvedValue(latest(result))
    m.getSuggestions.mockResolvedValue(results({ run: result }))
    m.reassess.mockResolvedValue({ run: running({ scope: 'unfinished' }) })
    render(<Harness />)
    const unfinished = await screen.findByRole('button', { name: 'Re-assess unfinished' })
    await user.click(unfinished)
    expect(m.reassess).toHaveBeenCalledWith('p1', 'run-9', 'unfinished')
    m.reassess.mockClear()
    m.getLatestRun.mockResolvedValue(latest(result))
    await user.click(await screen.findByRole('button', { name: 'Re-assess all categories' }))
    expect(m.reassess).toHaveBeenCalledWith('p1', 'run-9', 'all')
  })

  it('shows the sentence of the server when there is nothing unfinished, and keeps the button', async () => {
    const user = userEvent.setup()
    const result = makeRun({ id: 'run-9' })
    m.getLatestRun.mockResolvedValue(latest(result))
    m.getSuggestions.mockResolvedValue(results({ run: result }))
    m.reassess.mockRejectedValue(new EvidenceApiError(409, 'Nothing is unfinished.'))
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: /re-assess unfinished/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is unfinished.')
    expect(screen.getByRole('button', { name: /re-assess unfinished/i })).toBeInTheDocument()
  })

  it('has no Re-assess before a result run exists', async () => {
    render(<Harness />)
    await screen.findByLabelText(/website links/i)
    expect(screen.queryByRole('button', { name: /re-assess/i })).toBeNull()
  })

  it('shows the failure of the latest run above the older summary', async () => {
    const older = makeRun({ id: 'run-1' })
    m.getLatestRun.mockResolvedValue(latest(makeRun({ id: 'run-2', status: 'failed', error: 'Every page failed to load.', pagesDone: 0, pagesTotal: 0 }), []))
    m.getSuggestions.mockResolvedValue(results({ run: older, suggestions: [makeSuggestion()] }))
    render(<Harness />)
    const failure = await screen.findByText('Every page failed to load.')
    const summary = screen.getByRole('region', { name: /last run/i })
    expect(summary).toHaveTextContent(/1 suggestion/i)
    expect(failure.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('tolerates null dates, empty lists and zero pages', async () => {
    const odd = makeRun({ startedAt: null, finishedAt: null, pagesTotal: 0, pagesDone: 0, categoriesTotal: 0, categoriesDone: 0, status: 'partial', unassessedCategories: [] })
    m.getLatestRun.mockResolvedValue(latest(odd, []))
    m.getSuggestions.mockResolvedValue(results({ run: odd }))
    render(<Harness />)
    expect(await screen.findByRole('region', { name: /last run/i })).toBeInTheDocument()
  })

  it('shows the Permission checkbox and note to a Head Auditor only, and saves them', async () => {
    const user = userEvent.setup()
    m.setPermission.mockResolvedValue({ permission: sources(['x'], true).permission! })
    const head = render(<Harness role="head_auditor" />)
    const box = await screen.findByRole('checkbox', { name: /permission/i })
    expect(screen.getByText(/robots\.txt is no longer respected/i)).toBeInTheDocument()
    await user.click(box)
    await user.type(screen.getByLabelText(/note/i), 'Emailed on 3 Nov')
    await user.click(screen.getByRole('button', { name: /save permission/i }))
    expect(m.setPermission).toHaveBeenCalledWith('p1', true, 'Emailed on 3 Nov')
    head.unmount()

    render(<Harness role="auditor" />)
    await screen.findByLabelText(/website links/i)
    expect(screen.queryByRole('checkbox', { name: /permission/i })).toBeNull()
  })

  it('says to sign in again on a 401 and shows nothing else', async () => {
    m.getLatestRun.mockRejectedValue(new EvidenceApiError(401, 'x'))
    m.getSuggestions.mockRejectedValue(new EvidenceApiError(401, 'x'))
    m.getSources.mockRejectedValue(new EvidenceApiError(401, 'x'))
    render(<Harness />)
    expect(await screen.findByText('AI evidence assessment is not available in this session. Sign out and sign in again. If this message stays, the server is not set up for it yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run/i })).toBeNull()
  })

  it('recovers by itself when the auth token arrives after the panel opened', async () => {
    const noToken = new EvidenceApiError(401, 'x')
    m.getLatestRun.mockRejectedValue(noToken)
    m.getSuggestions.mockRejectedValue(noToken)
    m.getSources.mockRejectedValue(noToken)
    render(<Harness />)
    expect(await screen.findByText('AI evidence assessment is not available in this session. Sign out and sign in again. If this message stays, the server is not set up for it yet.')).toBeInTheDocument()
    m.getLatestRun.mockResolvedValue(latest(null))
    m.getSuggestions.mockResolvedValue(results())
    m.getSources.mockResolvedValue(sources())

    act(() => useStore.setState({ authToken: 'tok' }))

    expect(await screen.findByLabelText(/website links/i)).toBeInTheDocument()
    expect(screen.queryByText('AI evidence assessment is not available in this session. Sign out and sign in again. If this message stays, the server is not set up for it yet.')).toBeNull()
  })

  it('shows the not-configured sentence on a 503 and shows nothing else', async () => {
    const sentence = 'AI assessment is not configured on this server: GROQ_API_KEY is missing.'
    m.getLatestRun.mockRejectedValue(new EvidenceApiError(503, sentence))
    m.getSuggestions.mockRejectedValue(new EvidenceApiError(503, sentence))
    m.getSources.mockRejectedValue(new EvidenceApiError(503, sentence))
    render(<Harness />)
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run/i })).toBeNull()
  })

  it('hides Run and Re-assess when the audit is locked, keeping the summary', async () => {
    const result = makeRun()
    m.getLatestRun.mockResolvedValue(latest(result))
    m.getSuggestions.mockResolvedValue(results({ run: result }))
    render(<Harness role="head_auditor" locked />)
    expect(await screen.findByRole('region', { name: /last run/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /re-assess/i })).toBeNull()
  })

  it('renders nothing and sends nothing for an admin', async () => {
    const { container } = render(<Harness role="admin" />)
    await act(async () => { await Promise.resolve() })
    expect(container).toBeEmptyDOMElement()
    Object.values(m).forEach((fn) => expect(fn).not.toHaveBeenCalled())
  })

  it('renders only http and https page urls as links, opening safely', async () => {
    m.getLatestRun.mockResolvedValue(
      latest(makeRun(), [
        makePage({ id: 'bad', url: 'javascript:alert(1)', accessStatus: 'error', accessDetail: 'Bad <b>html</b>' }),
        makePage({ id: 'good', url: 'https://ok.example/page', accessStatus: 'error', accessDetail: 'HTTP 500' }),
      ]),
    )
    m.getSuggestions.mockResolvedValue(results({ run: makeRun() }))
    render(<Harness />)
    const link = await screen.findByRole('link', { name: /ok\.example\/page/ })
    expect(link).toHaveAttribute('href', 'https://ok.example/page')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(screen.getByText('Bad <b>html</b>')).toBeInTheDocument()
  })
  it('shows a failed sources load with a retry, and keeps Run unavailable until it loads', async () => {
    const user = userEvent.setup()
    m.getSources.mockRejectedValueOnce(new EvidenceApiError(500, 'Something went wrong on the server.'))
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on the server.')
    expect(runButton()).toBeDisabled()
    expect(screen.queryByLabelText(/website links/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    expect(runButton()).toBeEnabled()
  })

  it('shows a non-blocking load error in an alert', async () => {
    m.getLatestRun.mockRejectedValue(new EvidenceApiError(500, 'Something went wrong on the server.'))
    render(<Harness />)
    expect(await screen.findByText('Something went wrong on the server.')).toBeInTheDocument()
    expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes('Something went wrong'))).toBe(true)
  })

  it('shows one plain line and nothing else on a 403', async () => {
    const sentence = 'You do not have access to this project.'
    m.getLatestRun.mockRejectedValue(new EvidenceApiError(403, sentence))
    m.getSuggestions.mockRejectedValue(new EvidenceApiError(403, sentence))
    m.getSources.mockRejectedValue(new EvidenceApiError(403, sentence))
    render(<Harness />)
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/loading/i)).toBeNull()
  })

  it('puts the checkbox back and shows the error when saving the permission fails', async () => {
    const user = userEvent.setup()
    m.setPermission.mockRejectedValue(new EvidenceApiError(500, 'Could not record the permission.'))
    render(<Harness role="head_auditor" />)
    const box = await screen.findByRole('checkbox', { name: /permission/i })
    await user.click(box)
    expect(box).toBeChecked()
    await user.click(screen.getByRole('button', { name: /save permission/i }))
    expect(await screen.findByText('Could not record the permission.')).toBeInTheDocument()
    expect(box).not.toBeChecked()
    expect(screen.getByLabelText(/note/i)).toHaveAttribute('maxlength', '500')
  })

  it('does not let a pending save from one project land on the next', async () => {
    const user = userEvent.setup()
    const pendingSave = deferred<{ source: NonNullable<SourcesResponse['source']> }>()
    m.getSources.mockImplementation(async (id) => (id === 'pB' ? sources(['https://b.example/']) : sources(['https://a.example/'])))
    m.saveSources.mockReturnValue(pendingSave.promise)
    m.startRun.mockResolvedValue({ run: running() })
    const view = render(<Harness projectId="pA" />)
    const box = await screen.findByLabelText(/website links/i)
    await waitFor(() => expect(box).toHaveValue('https://a.example/'))
    await user.type(box, '{Enter}https://a2.example/')
    await user.click(runButton())
    view.rerender(<Harness projectId="pB" />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://b.example/'))
    await act(async () => { pendingSave.resolve({ source: sources().source! }) })
    m.getLatestRun.mockResolvedValue(latest(null))
    await user.click(runButton())
    expect(m.saveSources).toHaveBeenCalledTimes(1)
    expect(m.startRun).toHaveBeenCalledWith('pB')
  })

  it('recovers from a 503 on Run once the user tries again', async () => {
    const user = userEvent.setup()
    m.startRun.mockRejectedValue(new EvidenceApiError(503, 'The service is temporarily unavailable.'))
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    await user.click(runButton())
    expect(await screen.findByText('The service is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('button', { name: /^run/i })).toBeEnabled()
  })

  it('keeps the buttons disabled until the refresh after an action has finished', async () => {
    const user = userEvent.setup()
    m.startRun.mockResolvedValue({ run: makeRun({ id: 'run-3', status: 'completed' }) })
    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText(/website links/i)).toHaveValue('https://a.example/'))
    const slow = deferred<LatestRunResponse>()
    m.getLatestRun.mockReturnValue(slow.promise)
    await user.click(runButton())
    await waitFor(() => expect(m.startRun).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(runButton()).toBeDisabled()
    await act(async () => { slow.resolve(latest(makeRun({ id: 'run-3' }))) })
    await waitFor(() => expect(runButton()).toBeEnabled())
  })
})
