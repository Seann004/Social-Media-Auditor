import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProvenanceBadge from './ProvenanceBadge'
import { makeDecision } from '../testFixtures'
import type { AnswerStatus, SuggestedResult } from '../types'

const accepted = (s: SuggestedResult, f: AnswerStatus) => makeDecision({ decision: 'accepted', suggestedResult: s, finalResult: f })

describe('ProvenanceBadge', () => {
  it.each([
    ['yes', 'compliant', 'AI suggested Yes · accepted'],
    ['no', 'non_compliant', 'AI suggested No · accepted'],
    ['partially', 'partially', 'AI suggested Partially · accepted'],
    ['not_applicable', 'not_applicable', 'AI suggested N/A · accepted'],
  ] as const)('renders accepted %s as "%s"', (s, f, text) => {
    render(<ProvenanceBadge decision={accepted(s, f)} currentStatus={f} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it.each([
    ['yes', 'partially', 'AI suggested Yes · overridden to Partially: Too weak'],
    ['no', 'not_applicable', 'AI suggested No · overridden to N/A: Too weak'],
    ['partially', 'compliant', 'AI suggested Partially · overridden to Yes: Too weak'],
    ['not_applicable', 'non_compliant', 'AI suggested N/A · overridden to No: Too weak'],
  ] as const)('renders overridden %s -> %s as "%s"', (s, f, text) => {
    const d = makeDecision({ decision: 'overridden', suggestedResult: s, finalResult: f, overrideReason: 'Too weak' })
    render(<ProvenanceBadge decision={d} currentStatus={f} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('renders Manual for an answered item with no decision', () => {
    render(<ProvenanceBadge decision={null} currentStatus="compliant" />)
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('falls back to Manual when the answer no longer matches the decision', () => {
    render(<ProvenanceBadge decision={accepted('yes', 'compliant')} currentStatus="non_compliant" />)
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.queryByText(/AI suggested/)).toBeNull()
  })

  it.each([undefined, 'not_started', 'needs_review'] as const)('shows nothing for an unanswered item (%s)', (status) => {
    const { container } = render(<ProvenanceBadge decision={null} currentStatus={status} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing for an unanswered item even with a stale decision', () => {
    const { container } = render(<ProvenanceBadge decision={accepted('yes', 'compliant')} currentStatus="not_started" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a script in an override reason as text, not markup', () => {
    const reason = '<script>alert(1)</script>'
    const d = makeDecision({ decision: 'overridden', suggestedResult: 'yes', finalResult: 'partially', overrideReason: reason })
    const { container } = render(<ProvenanceBadge decision={d} currentStatus="partially" />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain(reason)
  })
})
