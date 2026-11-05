import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  fetchProjectComplianceSummary: vi.fn(),
  updateProject: vi.fn(),
  upsertAuditResult: vi.fn(),
  saveAuditFindings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  postDecision: vi.fn(),
  getScreenshotUrl: vi.fn(),
}))

import * as db from '../../lib/db'
import { useStore } from '../../store/useStore'
import type { ChecklistItemStatus, Project } from '../../types'
import * as api from './api'
import { EvidenceApiError } from './api'
import ItemSuggestion from './components/ItemSuggestion'
import OverrideDialog from './components/OverrideDialog'
import { makeDecision, makeSuggestion } from './testFixtures'
import type { AppliedAnswer, DecisionView, SuggestionView } from './types'
import { useResponseFlow } from './useResponseFlow'

const postDecision = vi.mocked(api.postDecision)
const ITEM = 'item-1'
const KEY = `p1__${ITEM}`

interface HarnessProps {
  canDecide?: boolean
  suggestion?: SuggestionView
  decision?: DecisionView | null
  unsaved?: string
  onDecided?: (itemId: string, answer: AppliedAnswer, decision: 'accepted' | 'overridden') => void
  refresh?: () => Promise<void>
  onSave?: (status: ChecklistItemStatus) => void
}

function Harness({ canDecide = true, suggestion, decision = null, unsaved, onDecided = () => {}, refresh = () => Promise.resolve(), onSave }: HarnessProps) {
  const status = useStore((s) => s.responses[KEY]?.status)
  const suggestionsByItem = new Map(suggestion ? [[ITEM, suggestion]] : [])
  const decisionsByItem = new Map(decision ? [[ITEM, decision]] : [])
  const flow = useResponseFlow({
    projectId: 'p1',
    canDecide,
    evidence: { suggestionsByItem, decisionsByItem, refresh },
    getUnsavedFindings: () => unsaved,
    onDecided,
  })
  const answers: [ChecklistItemStatus, string][] = [
    ['compliant', 'Yes'],
    ['non_compliant', 'No'],
    ['partially', 'Partially'],
    ['not_applicable', 'N/A'],
    ['needs_review', 'Flag'],
  ]
  return (
    <>
      {answers.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={async () => {
            if (await flow.handleClick(ITEM, value)) return
            onSave?.(value)
            await useStore.getState().setResponse('p1', ITEM, 'g1', value, '')
          }}
        >
          {label}
        </button>
      ))}
      <output data-testid="status">{status ?? 'none'}</output>
      <ItemSuggestion itemId={ITEM} flow={flow} suggestion={suggestion} decision={decision} currentStatus={status} />
      {flow.dialogProps && <OverrideDialog {...flow.dialogProps} />}
    </>
  )
}

const answer = (over: Partial<AppliedAnswer> = {}): AppliedAnswer => ({ itemId: ITEM, status: 'compliant', findings: 'From the page.', evidenceImages: [], ...over })
const accepted = (over: Partial<AppliedAnswer> = {}) => ({ decision: makeDecision(), answer: answer(over) })
const overridden = (status: AppliedAnswer['status'], over: Partial<AppliedAnswer> = {}) => ({
  decision: makeDecision({ decision: 'overridden', finalResult: status, overrideReason: 'why' }),
  answer: answer({ status, ...over }),
})
const setStatus = (status: ChecklistItemStatus) =>
  useStore.setState({
    responses: {
      [KEY]: { id: 'r1', projectId: 'p1', checklistItemId: ITEM, status, notes: '', findings: 'mine', auditorId: 'u1', updatedAt: '2026-11-04' },
    },
  })
const status = () => screen.getByTestId('status').textContent

beforeEach(() => {
  postDecision.mockReset()
  vi.mocked(api.getScreenshotUrl).mockReset().mockResolvedValue('https://files.example/s.jpg')
  vi.mocked(db.fetchProjectComplianceSummary).mockReset().mockResolvedValue({ p1: { total: 1 } } as never)
  vi.mocked(db.updateProject).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(db.upsertAuditResult).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(db.saveAuditFindings).mockReset().mockResolvedValue(undefined as never)
  useStore.setState({
    currentUserId: 'u1',
    responses: {},
    complianceMap: {},
    projects: [{ id: 'p1', status: 'in_progress' } as unknown as Project],
  })
})

describe('answer buttons with a suggestion', () => {
  it('clicking a different answer on an accepted item opens the dialog and saves only after a reason', async () => {
    setStatus('compliant')
    postDecision.mockResolvedValue(overridden('non_compliant'))
    render(<Harness suggestion={makeSuggestion()} decision={makeDecision()} />)
    await userEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(postDecision).not.toHaveBeenCalled()
    expect(status()).toBe('compliant')
    await userEvent.type(screen.getByLabelText(/reason/i), 'Policy missing')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(status()).toBe('non_compliant'))
    expect(postDecision).toHaveBeenCalledWith('s-1', {
      decision: 'overridden',
      origin: 'answer_button',
      finalResult: 'non_compliant',
      overrideReason: 'Policy missing',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(db.upsertAuditResult).not.toHaveBeenCalled()
  })

  it('cancelling the dialog leaves the answer unchanged', async () => {
    setStatus('compliant')
    render(<Harness suggestion={makeSuggestion()} decision={makeDecision()} />)
    await userEvent.click(screen.getByRole('button', { name: 'No' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(status()).toBe('compliant')
    expect(postDecision).not.toHaveBeenCalled()
  })

  it('clicking the AI result posts accepted with origin answer_button', async () => {
    postDecision.mockResolvedValue(accepted())
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(status()).toBe('compliant'))
    expect(postDecision).toHaveBeenCalledWith('s-1', { decision: 'accepted', origin: 'answer_button' })
    expect(db.upsertAuditResult).not.toHaveBeenCalled()
  })

  it('the card Accept posts accepted with origin card, then refreshes the evidence once', async () => {
    postDecision.mockResolvedValue(accepted())
    const refresh = vi.fn().mockResolvedValue(undefined)
    const onDecided = vi.fn()
    render(<Harness suggestion={makeSuggestion()} refresh={refresh} onDecided={onDecided} />)
    await userEvent.click(screen.getByRole('button', { name: /^accept/i }))
    await waitFor(() => expect(status()).toBe('compliant'))
    expect(postDecision).toHaveBeenCalledWith('s-1', { decision: 'accepted', origin: 'card' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onDecided).toHaveBeenCalledWith(ITEM, answer(), 'accepted')
    expect(useStore.getState().responses[KEY].findings).toBe('From the page.')
  })

  it('Keep my answer posts overridden with the current answer, origin card', async () => {
    setStatus('non_compliant')
    postDecision.mockResolvedValue(overridden('non_compliant'))
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Keep my answer' }))
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/reason/i), 'My own checks')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(postDecision).toHaveBeenCalledWith('s-1', {
      decision: 'overridden',
      origin: 'card',
      finalResult: 'non_compliant',
      overrideReason: 'My own checks',
    })
  })

  it('the card Override posts overridden with the chosen result, origin card', async () => {
    postDecision.mockResolvedValue(overridden('partially'))
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: /^override/i }))
    await userEvent.click(screen.getByRole('radio', { name: 'Partially' }))
    await userEvent.type(screen.getByLabelText(/reason/i), 'Only some pages')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(status()).toBe('partially'))
    expect(postDecision).toHaveBeenCalledWith('s-1', {
      decision: 'overridden',
      origin: 'card',
      finalResult: 'partially',
      overrideReason: 'Only some pages',
    })
  })

  it('Flag still saves normally', async () => {
    setStatus('compliant')
    const onSave = vi.fn()
    render(<Harness suggestion={makeSuggestion()} decision={makeDecision()} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Flag' }))
    await waitFor(() => expect(status()).toBe('needs_review'))
    expect(onSave).toHaveBeenCalledWith('needs_review')
    expect(postDecision).not.toHaveBeenCalled()
  })

  it('after Flag the card is no longer "Accepted"', async () => {
    setStatus('compliant')
    render(<Harness suggestion={makeSuggestion()} decision={makeDecision()} />)
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Flag' }))
    await waitFor(() => expect(status()).toBe('needs_review'))
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument()
  })

  it('without a suggestion, buttons save exactly as before', async () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Partially' }))
    await waitFor(() => expect(status()).toBe('partially'))
    expect(onSave).toHaveBeenCalledWith('partially')
    expect(db.upsertAuditResult).toHaveBeenCalledOnce()
    expect(postDecision).not.toHaveBeenCalled()
  })

  it('a Head Auditor click makes no decision request', async () => {
    const onSave = vi.fn()
    render(<Harness canDecide={false} suggestion={makeSuggestion()} onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('compliant'))
    expect(postDecision).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a null-result newest suggestion with an older decision posts to the older id', async () => {
    setStatus('partially')
    postDecision.mockResolvedValue(accepted())
    const older = makeDecision({ suggestionId: 's-0', decision: 'overridden', finalResult: 'partially', overrideReason: 'r', suggestedResult: 'yes' })
    render(<Harness suggestion={makeSuggestion({ id: 's-2', suggestedResult: null })} decision={older} />)
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(postDecision).toHaveBeenCalledWith('s-0', { decision: 'accepted', origin: 'answer_button' }))
  })
})

describe('after a decision', () => {
  it('accept on a draft project advances it and refreshes compliance', async () => {
    useStore.setState({ projects: [{ id: 'p1', status: 'draft' } as unknown as Project] })
    postDecision.mockResolvedValue(accepted())
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: /^accept/i }))
    await waitFor(() => expect(useStore.getState().projects[0].status).toBe('in_progress'))
    expect(db.updateProject).toHaveBeenCalledWith('p1', { projectStatus: 'in_progress' })
    expect(useStore.getState().complianceMap['p1']).toEqual({ total: 1 })
  })

  it('a failed compliance refresh does not undo or hide a decision that was saved', async () => {
    vi.mocked(db.fetchProjectComplianceSummary).mockRejectedValue(new Error('down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    postDecision.mockResolvedValue(accepted())
    const onDecided = vi.fn()
    render(<Harness suggestion={makeSuggestion()} onDecided={onDecided} />)
    await userEvent.click(screen.getByRole('button', { name: /^accept/i }))
    await waitFor(() => expect(onDecided).toHaveBeenCalled())
    expect(status()).toBe('compliant')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('accept keeps typed unsaved findings: they are saved first, then the decision is posted', async () => {
    const order: string[] = []
    vi.mocked(db.saveAuditFindings).mockImplementation(async () => {
      order.push('save')
    })
    postDecision.mockImplementation(async () => {
      order.push('post')
      return accepted({ findings: 'typed words' })
    })
    setStatus('non_compliant')
    render(<Harness suggestion={makeSuggestion()} unsaved="typed words" />)
    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
    await waitFor(() => expect(status()).toBe('compliant'))
    expect(db.saveAuditFindings).toHaveBeenCalledWith('p1', ITEM, 'u1', 'typed words')
    expect(order).toEqual(['save', 'post'])
    expect(useStore.getState().responses[KEY].findings).toBe('typed words')
  })

  it('does not save findings when none are unsaved', async () => {
    postDecision.mockResolvedValue(accepted())
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: /^accept/i }))
    await waitFor(() => expect(status()).toBe('compliant'))
    expect(db.saveAuditFindings).not.toHaveBeenCalled()
  })

  it('a failed findings save stops the decision and shows the error', async () => {
    vi.mocked(db.saveAuditFindings).mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setStatus('non_compliant')
    render(<Harness suggestion={makeSuggestion()} unsaved="typed words" />)
    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/findings/i)
    expect(postDecision).not.toHaveBeenCalled()
    expect(status()).toBe('non_compliant')
  })
})

describe('failures and double clicks', () => {
  it('a failed decision shows the server sentence and leaves the answer unchanged', async () => {
    setStatus('non_compliant')
    postDecision.mockRejectedValue(new EvidenceApiError(409, 'This audit is locked.'))
    const onDecided = vi.fn()
    render(<Harness suggestion={makeSuggestion()} onDecided={onDecided} />)
    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This audit is locked.')
    expect(status()).toBe('non_compliant')
    expect(onDecided).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeEnabled()
  })

  it('a failed button-accept also shows on the card', async () => {
    postDecision.mockRejectedValue(new EvidenceApiError(409, 'This audit is locked.'))
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This audit is locked.')
    expect(status()).toBe('none')
  })

  it('a failed dialog submit keeps the dialog and the reason, and a retry works', async () => {
    postDecision.mockRejectedValueOnce(new EvidenceApiError(409, 'This audit is locked.'))
    postDecision.mockResolvedValueOnce(overridden('partially'))
    render(<Harness suggestion={makeSuggestion()} />)
    await userEvent.click(screen.getByRole('button', { name: /^override/i }))
    await userEvent.click(screen.getByRole('radio', { name: 'Partially' }))
    await userEvent.type(screen.getByLabelText(/reason/i), 'Because I say so')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This audit is locked.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/reason/i)).toHaveValue('Because I say so')
    expect(status()).toBe('none')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(status()).toBe('partially'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a double click sends one request', async () => {
    let finish!: () => void
    postDecision.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(accepted())
        }),
    )
    render(<Harness suggestion={makeSuggestion()} />)
    const button = screen.getByRole('button', { name: 'Yes' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: /^accept/i }))
    await waitFor(() => expect(postDecision).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: /^accept/i })).toBeDisabled()
    await act(async () => finish())
    await waitFor(() => expect(status()).toBe('compliant'))
    expect(postDecision).toHaveBeenCalledTimes(1)
  })
})
