import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { makeDecision, makeSuggestion } from '../testFixtures'
import type { ItemKindView, QuoteView, SuggestionView } from '../types'
import OverrideDialog from './OverrideDialog'
import SuggestionCard from './SuggestionCard'

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), getScreenshotUrl: vi.fn(), getCode: vi.fn() }))
const getScreenshotUrl = vi.mocked(api.getScreenshotUrl)
const getCode = vi.mocked(api.getCode)

const quote = (over: Partial<QuoteView> = {}): QuoteView => ({
  id: 'q1',
  pageId: 'pg-1',
  quoteText: 'We verify age at sign-up.',
  verified: true,
  pageUrl: 'https://example.com/privacy',
  pageTitle: 'Privacy',
  hasHighlight: true,
  pageHasScreenshot: true,
  ...over,
})

type CardProps = React.ComponentProps<typeof SuggestionCard>
function renderCard(over: Partial<CardProps> = {}) {
  const props: CardProps = {
    suggestion: makeSuggestion({ quotes: [quote()] }),
    decision: null,
    currentStatus: undefined,
    canDecide: true,
    onAccept: vi.fn(),
    onOverride: vi.fn(),
    onKeepMine: vi.fn(),
    ...over,
  }
  render(<SuggestionCard {...props} />)
  return props
}

beforeEach(() => {
  getScreenshotUrl.mockReset().mockResolvedValue('https://files.example/shot.jpg')
  getCode.mockReset().mockRejectedValue(new Error('no code'))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SuggestionCard', () => {
  it('shows result, reason, each quote with page link, thumbnail and flag reasons', async () => {
    renderCard({
      suggestion: makeSuggestion({
        suggestedResult: 'partially',
        reason: 'Age checks exist for some flows.',
        flags: [{ type: 'conflicting', reason: 'Help centre says otherwise.' }],
        quotes: [quote(), quote({ id: 'q2', quoteText: 'Second quote', pageUrl: 'https://example.com/help', pageTitle: 'Help' })],
      }),
    })
    expect(screen.getByText(/AI suggestion/i)).toBeInTheDocument()
    expect(screen.getByText('Partially')).toBeInTheDocument()
    expect(screen.getByText('Age checks exist for some flows.')).toBeInTheDocument()
    expect(screen.getByText(/We verify age at sign-up\./)).toBeInTheDocument()
    expect(screen.getByText(/Second quote/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Privacy/ })).toHaveAttribute('href', 'https://example.com/privacy')
    expect(screen.getByRole('link', { name: /Help/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Help centre says otherwise.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    expect(getScreenshotUrl).toHaveBeenCalledWith('quote', 'q1')
  })

  it('shows "Needs human review" on a flagged suggestion, and Accept still works', async () => {
    const props = renderCard({ suggestion: makeSuggestion({ flags: [{ type: 'low_confidence', reason: 'Low.' }] }) })
    expect(screen.getByText('Needs human review')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^accept/i }))
    expect(props.onAccept).toHaveBeenCalledOnce()
  })

  it('does not show the review chip on an unflagged suggestion', () => {
    renderCard()
    expect(screen.queryByText('Needs human review')).not.toBeInTheDocument()
  })

  it('marks an unverified quote, and falls back to the page screenshot without a highlight', async () => {
    renderCard({
      suggestion: makeSuggestion({
        quotes: [quote({ id: 'q-bad', verified: false }), quote({ id: 'q-full', hasHighlight: false })],
      }),
    })
    expect(screen.getByText(/not found in the page/i)).toBeInTheDocument()
    expect(screen.getByText(/full page/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
    expect(getScreenshotUrl).toHaveBeenCalledTimes(1)
    expect(getScreenshotUrl).toHaveBeenCalledWith('quote', 'q-full')
  })

  it('shows no picture for a quote with no page', () => {
    renderCard({ suggestion: makeSuggestion({ quotes: [quote({ pageId: null, pageUrl: null, pageTitle: null })] }) })
    expect(getScreenshotUrl).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('no_suggestion shows the reason and flags, with no Accept', () => {
    renderCard({
      suggestion: makeSuggestion({ suggestedResult: null, reason: 'Needs internal records.', flags: [{ type: 'not_web_assessable', reason: 'Server side.' }] }),
    })
    expect(screen.getByText('Needs internal records.')).toBeInTheDocument()
    expect(screen.getByText('Server side.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument()
  })

  it('disagrees shows Accept suggestion and Keep my answer', async () => {
    const props = renderCard({ currentStatus: 'non_compliant' })
    expect(screen.getByText(/disagrees with your answer/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep my answer' }))
    expect(props.onKeepMine).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }))
    expect(props.onAccept).toHaveBeenCalledOnce()
  })

  it('pending shows Accept and Override', async () => {
    const props = renderCard()
    await userEvent.click(screen.getByRole('button', { name: /^override/i }))
    expect(props.onOverride).toHaveBeenCalledOnce()
  })

  it('new_differs shows "New suggestion differs from current answer"', () => {
    renderCard({
      suggestion: makeSuggestion({ id: 's-2', suggestedResult: 'no' }),
      decision: makeDecision({ suggestionId: 's-1' }),
      currentStatus: 'compliant',
    })
    expect(screen.getByText('New suggestion differs from current answer')).toBeInTheDocument()
  })

  it('shows accepted decisions without action buttons', () => {
    renderCard({ decision: makeDecision(), currentStatus: 'compliant' })
    expect(screen.getByText(/accepted/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept|override/i })).not.toBeInTheDocument()
  })

  it('shows the reason of an overridden decision', () => {
    renderCard({
      decision: makeDecision({ decision: 'overridden', finalResult: 'partially', overrideReason: 'Policy is in a PDF' }),
      currentStatus: 'partially',
    })
    expect(screen.getByText(/overridden/i)).toBeInTheDocument()
    expect(screen.getByText(/Policy is in a PDF/)).toBeInTheDocument()
  })

  it('after the auditor flags an accepted item the card is no longer "Accepted"', () => {
    renderCard({ decision: makeDecision(), currentStatus: 'needs_review' })
    expect(screen.queryByText(/^accepted/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^accept/i })).toBeInTheDocument()
  })

  it('Head Auditor and locked audits see the card with no action buttons', () => {
    renderCard({ canDecide: false, currentStatus: 'non_compliant' })
    expect(screen.getByText('Because.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept|override|keep/i })).not.toBeInTheDocument()
  })

  it('disables the buttons while busy and shows a failure with the server sentence', () => {
    renderCard({ busy: true, error: 'This audit was locked while you were working.' })
    expect(screen.getByRole('button', { name: /^accept/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^override/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('This audit was locked while you were working.')
  })

  it('renders page text in quotes as text, never as HTML', () => {
    renderCard({
      suggestion: makeSuggestion({
        reason: '<img src=x onerror=alert(1)>',
        flags: [{ type: 'conflicting', reason: '<b>bold</b>' }],
        quotes: [quote({ quoteText: '<script>alert(1)</script>', pageTitle: '<i>t</i>' })],
      }),
    })
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('script, b, i')).toBeNull()
  })

  it('only renders http(s) page links', () => {
    renderCard({
      suggestion: makeSuggestion({
        quotes: [
          quote({ id: 'q1', pageUrl: 'javascript:alert(1)', pageTitle: 'Evil' }),
          quote({ id: 'q2', pageUrl: 'data:text/html,hi', pageTitle: 'Data' }),
        ],
      }),
    })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/Evil/)).toBeInTheDocument()
  })

  it('does not load thumbnails until the card is near the viewport', async () => {
    let notify: (visible: boolean) => void = () => {}
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) {
        notify = (isIntersecting) => cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    renderCard()
    expect(getScreenshotUrl).not.toHaveBeenCalled()
    act(() => notify(true))
    await waitFor(() => expect(getScreenshotUrl).toHaveBeenCalledOnce())
  })

  it('shows a plain placeholder when a thumbnail cannot load, and the card still works', async () => {
    getScreenshotUrl.mockRejectedValue(new api.EvidenceApiError(429, 'Too many requests. Wait a moment and try again.'))
    const props = renderCard()
    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^accept/i }))
    expect(props.onAccept).toHaveBeenCalled()
  })

  it('never loads a javascript: or data: screenshot link as a picture', async () => {
    getScreenshotUrl.mockResolvedValue('javascript:alert(1)')
    renderCard()
    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows the placeholder when the picture itself fails to load', async () => {
    renderCard()
    const img = await screen.findByRole('img')
    fireEvent.error(img)
    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('the viewer refuses a javascript: link and shows a failure instead of a picture', async () => {
    getScreenshotUrl.mockResolvedValueOnce('https://files.example/thumb.jpg').mockResolvedValueOnce('javascript:alert(1)')
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: /enlarge/i }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
  })

  it('the viewer shows a failure when its picture fails to load', async () => {
    getScreenshotUrl.mockResolvedValue('https://files.example/x.jpg')
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: /enlarge/i }))
    const dialog = await screen.findByRole('dialog')
    const img = await within(dialog).findByRole('img')
    fireEvent.error(img)
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
  })

  it('opens the viewer with a fresh link, closes it on Escape and returns focus', async () => {
    getScreenshotUrl.mockResolvedValueOnce('https://files.example/thumb.jpg').mockResolvedValueOnce('https://files.example/fresh.jpg')
    renderCard()
    const opener = await screen.findByRole('button', { name: /enlarge/i })
    await userEvent.click(opener)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://files.example/fresh.jpg'))
    expect(getScreenshotUrl).toHaveBeenCalledTimes(2)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})

describe('OverrideDialog', () => {
  function renderDialog(over: Partial<React.ComponentProps<typeof OverrideDialog>> = {}) {
    const props = { suggestedLabel: 'Yes', onConfirm: vi.fn(), onCancel: vi.fn(), ...over }
    render(<OverrideDialog {...props} />)
    return props
  }

  it('Override cannot be confirmed without a result and a reason', async () => {
    const props = renderDialog()
    const confirm = screen.getByRole('button', { name: /confirm/i })
    expect(confirm).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'No' }))
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/reason/i), '  a ')
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/reason/i), 'bc')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(props.onConfirm).toHaveBeenCalledWith('non_compliant', 'a bc')
  })

  it('a reason of 2 characters is refused, 3 is enough, padding does not count', async () => {
    renderDialog({ presetResult: 'partially' })
    const confirm = screen.getByRole('button', { name: /confirm/i })
    const box = screen.getByLabelText(/reason/i)
    await userEvent.type(box, '  ab  ')
    expect(confirm).toBeDisabled()
    await userEvent.clear(box)
    await userEvent.type(box, 'abc')
    expect(confirm).toBeEnabled()
  })

  it('a click on the backdrop keeps focus inside, so Escape still closes', async () => {
    const props = renderDialog()
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement
    await userEvent.click(overlay)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('is labelled, starts with the preset chosen, and omits the AI result', () => {
    renderDialog({ presetResult: 'partially', excludeResult: 'compliant' })
    expect(screen.getByRole('dialog', { name: /override/i })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('radio', { name: 'Partially' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument()
  })

  it('caps the reason at 2000 characters', () => {
    renderDialog()
    expect(screen.getByLabelText(/reason/i)).toHaveAttribute('maxlength', '2000')
  })

  it('closes on Escape and returns focus to the opener', async () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <OverrideDialog suggestedLabel="Yes" onConfirm={() => {}} onCancel={() => setOpen(false)} />}
        </>
      )
    }
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'open' })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps focus inside while tabbing', async () => {
    renderDialog()
    for (let i = 0; i < 12; i++) {
      await userEvent.tab()
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 12; i++) {
      await userEvent.tab({ shift: true })
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    }
  })

  it('shows a failure and keeps the typed reason; Confirm is disabled while busy', async () => {
    const { rerender } = render(<OverrideDialog suggestedLabel="Yes" onConfirm={() => {}} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText(/reason/i), 'my reason')
    rerender(<OverrideDialog suggestedLabel="Yes" error="Locked." onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Locked.')
    expect(screen.getByLabelText(/reason/i)).toHaveValue('my reason')
    rerender(<OverrideDialog suggestedLabel="Yes" busy onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })
})

describe('SuggestionCard replay', () => {
  it('shows Replay steps for app suggestions only, for a Head Auditor too', () => {
    const { unmount } = render(
      <SuggestionCard suggestion={makeSuggestion({ source: 'app' })} decision={null} currentStatus={undefined} canDecide={false} onAccept={vi.fn()} onOverride={vi.fn()} onKeepMine={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Replay steps' })).toBeInTheDocument()
    unmount()
    render(
      <SuggestionCard suggestion={makeSuggestion({ source: 'pages' })} decision={null} currentStatus={undefined} canDecide onAccept={vi.fn()} onOverride={vi.fn()} onKeepMine={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Replay steps' })).not.toBeInTheDocument()
  })

  it('shows no Replay steps for a repo suggestion', () => {
    render(
      <SuggestionCard suggestion={makeSuggestion({ source: 'repo' })} decision={null} currentStatus={undefined} canDecide onAccept={vi.fn()} onOverride={vi.fn()} onKeepMine={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: 'Replay steps' })).not.toBeInTheDocument()
  })
})

describe('SuggestionCard for an app suggestion about a default', () => {
  const REASON =
    "This item is about a default setting, but the check only saw this account's current setting. Confirm the default yourself, for example with a newly created account."

  it('shows the Check the default label with its reason', () => {
    renderCard({ suggestion: makeSuggestion({ source: 'app', flags: [{ type: 'default_unverified', reason: REASON }] }) })
    expect(screen.getByText('Check the default')).toBeInTheDocument()
    expect(screen.getByText(REASON)).toBeInTheDocument()
  })
})

describe('SuggestionCard for a code repository suggestion', () => {
  const repoCard = (over: Partial<SuggestionView> = {}) =>
    makeSuggestion({ source: 'repo', commitSha: 'abc1234def5678', hasCode: true, flags: [{ type: 'comments_only', reason: 'Only comments or documentation support this.' }], ...over })

  it('shows the short commit note at once, from the listing, without asking for the code', () => {
    renderCard({ suggestion: repoCard() })
    expect(screen.getByText('Based on the code at commit abc1234, not on the live app.')).toBeInTheDocument()
    expect(screen.getByText('Comments only')).toBeInTheDocument()
    expect(screen.getByText('Only comments or documentation support this.')).toBeInTheDocument()
    expect(getCode).not.toHaveBeenCalled()
  })

  it('keeps the generic note when the commit is not known', () => {
    renderCard({ suggestion: repoCard({ commitSha: null }) })
    expect(screen.getByText('Based on code, not on the live app.')).toBeInTheDocument()
    expect(getCode).not.toHaveBeenCalled()
  })

  it('offers Code found instead of Replay steps and loads the code on open', async () => {
    const user = userEvent.setup()
    getCode.mockResolvedValue({ commitSha: 'abc1234def', repoUrl: null, pieces: [] })
    renderCard({ suggestion: repoCard() })
    expect(screen.queryByRole('button', { name: 'Replay steps' })).toBeNull()
    expect(getCode).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Code found' }))
    expect(await screen.findByText('No code was kept for this suggestion.')).toBeInTheDocument()
  })

  it('offers no Code found when no code matched', () => {
    renderCard({ suggestion: repoCard({ hasCode: false }) })
    expect(screen.queryByRole('button', { name: 'Code found' })).toBeNull()
  })

  it('shows no page thumbnail for a code quote, and never asks for one', async () => {
    renderCard({ suggestion: repoCard({ quotes: [quote({ id: 'q-code', hasHighlight: false, pageHasScreenshot: false, pageUrl: 'https://github.com/acme/app/blob/abc/x.ts#L1-L9' })] }) })
    expect(screen.getByText(/We verify age at sign-up\./)).toBeInTheDocument()
    expect(screen.queryByText('Full page')).toBeNull()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('img')).toBeNull()
    expect(getScreenshotUrl).not.toHaveBeenCalled()
  })
})

describe('SuggestionCard: thumbnails only where a picture exists', () => {
  it('an app quote whose page has no screenshot and no highlight asks for no picture', async () => {
    renderCard({ suggestion: makeSuggestion({ source: 'app', quotes: [quote({ hasHighlight: false, pageHasScreenshot: false })] }) })
    expect(screen.queryByText('Full page')).toBeNull()
    await new Promise((r) => setTimeout(r, 20))
    expect(getScreenshotUrl).not.toHaveBeenCalled()
  })
})

describe('SuggestionCard: the reason is shown once', () => {
  const reason = 'The pages do not say whether teen accounts are private.'

  it('leaves out a flag reason that repeats the card reason, but keeps its label', () => {
    renderCard({ suggestion: makeSuggestion({ suggestedResult: null, reason, flags: [{ type: 'missing_evidence', reason }] }) })
    expect(screen.getAllByText(reason)).toHaveLength(1)
    expect(screen.getByText('Needs human review')).toBeInTheDocument()
  })

  it('compares without surrounding space', () => {
    renderCard({ suggestion: makeSuggestion({ suggestedResult: null, reason, flags: [{ type: 'low_confidence', reason: `  ${reason} ` }] }) })
    expect(screen.getAllByText(reason)).toHaveLength(1)
  })

  it('keeps a flag that adds something', () => {
    renderCard({ suggestion: makeSuggestion({ reason, flags: [{ type: 'missing_evidence', reason }, { type: 'conflicting', reason: 'Help centre says otherwise.' }] }) })
    expect(screen.getAllByText(reason)).toHaveLength(1)
    expect(screen.getByText('Help centre says otherwise.')).toBeInTheDocument()
  })
})

describe("SuggestionCard: the source can't show this item", () => {
  // The AI's high-confidence kinds: the only ones the server sends.
  const POLICY: ItemKindView = { kind: 'neither', reason: 'A company policy, not a screen or code.' }
  const APP: ItemKindView = { kind: 'app', reason: 'A setting a user can see.' }
  const aiReason = 'No step of the check showed the privacy policy.'
  const flags = [{ type: 'missing_evidence' as const, reason: aiReason }]
  const noResult = (over: Partial<SuggestionView> = {}) => makeSuggestion({ source: 'app', suggestedResult: null, reason: aiReason, flags, ...over })
  const NOTE = "This source can't show this item."

  it('says so calmly, with the reason, and keeps the reason, the flags and the review label', () => {
    renderCard({ suggestion: noResult(), kind: POLICY })
    const note = screen.getByText(NOTE).closest('[data-tone="hint"]')!
    expect(note).toHaveTextContent(`${NOTE} A company policy, not a screen or code.`)
    expect(note).toHaveClass('bg-sky-50', 'text-sky-700')
    expect(screen.getByText('The AI could not suggest an answer')).toBeInTheDocument()
    expect(screen.getByText(aiReason)).toBeInTheDocument()
    expect(screen.getByText('Needs human review')).toBeInTheDocument()
  })

  it('says so for a code repository suggestion on an app item', () => {
    renderCard({ suggestion: noResult({ source: 'repo' }), kind: APP })
    expect(screen.getByText(NOTE).closest('[data-tone="hint"]')).toHaveTextContent(`${NOTE} A setting a user can see.`)
  })

  it('is not shown for a result, an item the source suits, a failed check, an unchecked item or an item without an AI kind', () => {
    const cases: Partial<CardProps>[] = [
      { suggestion: noResult({ suggestedResult: 'no' }), kind: POLICY },
      { suggestion: noResult(), kind: APP },
      { suggestion: noResult({ flags: [...flags, { type: 'inaccessible', reason: 'The check stopped at https://app.example/: a captcha.' }] }), kind: POLICY },
      { suggestion: noResult(), kind: POLICY, unchecked: true },
      { suggestion: noResult() },
    ]
    for (const over of cases) {
      const { unmount } = render(<SuggestionCard decision={null} currentStatus={undefined} canDecide onAccept={vi.fn()} onOverride={vi.fn()} onKeepMine={vi.fn()} {...(over as CardProps)} />)
      expect(screen.queryByText(NOTE)).toBeNull()
      unmount()
    }
  })
})
