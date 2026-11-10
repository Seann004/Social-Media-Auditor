import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../lib/db'
import ProjectLinksPanel from './ProjectLinksPanel'

vi.mock('../../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/db')>()
  return {
    ...actual,
    fetchProjectMappings: vi.fn(),
    generateProjectMappings: vi.fn(),
    reviewProjectMapping: vi.fn(),
  }
})

const m = {
  fetch: vi.mocked(db.fetchProjectMappings),
  generate: vi.mocked(db.generateProjectMappings),
  review: vi.mocked(db.reviewProjectMapping),
}

function link(overrides: Partial<db.ItemMapping> = {}): db.ItemMapping {
  return {
    mappingId: 'm1',
    relation: 'equivalent',
    confidence: 0.9,
    rationale: 'Both restrict minors from adult content.',
    status: 'suggested',
    createdAt: '2026-10-20T00:00:00Z',
    reviewedAt: null,
    itemA: { itemId: 'a', guidelineId: 'G1', guidelineName: 'ONSA', category: 'Age', itemCode: 'O-1', text: 'Age verification restricts minors', reference: null, clause: null },
    itemB: { itemId: 'b', guidelineId: 'G2', guidelineName: 'UKCC', category: 'Age', itemCode: 'U-1', text: 'Age assurance restricts children', reference: null, clause: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  m.fetch.mockResolvedValue([link()])
  m.review.mockResolvedValue(undefined)
  m.generate.mockResolvedValue({ checked: 2, suggested: 1, failedBatches: 0 })
})

describe('ProjectLinksPanel', () => {
  it('loads nothing until the head auditor opens it', () => {
    render(<ProjectLinksPanel projectId="p1" />)
    expect(screen.getByRole('button', { name: /review linked requirements/i })).toBeInTheDocument()
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it('shows the links between this project\'s guidelines once opened', async () => {
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    expect(m.fetch).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('Age verification restricts minors')).toBeInTheDocument()
    expect(screen.getByText('Age assurance restricts children')).toBeInTheDocument()
    expect(screen.getByText(/Both restrict minors/)).toBeInTheDocument()
  })

  it('confirms a link as the same requirement and reloads the list', async () => {
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    await userEvent.click(await screen.findByRole('button', { name: /same requirement/i }))
    expect(m.review).toHaveBeenCalledWith('p1', 'm1', 'confirmed', 'equivalent')
    await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(2))
  })

  it('rejects a link as not related', async () => {
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    await userEvent.click(await screen.findByRole('button', { name: /not related/i }))
    expect(m.review).toHaveBeenCalledWith('p1', 'm1', 'rejected', undefined)
  })

  it('offers only the links still awaiting review by default', async () => {
    m.fetch.mockResolvedValue([link(), link({ mappingId: 'm2', status: 'confirmed', itemA: { ...link().itemA, text: 'Already confirmed item' } })])
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    await screen.findByText('Age verification restricts minors')
    expect(screen.queryByText('Already confirmed item')).not.toBeInTheDocument()
    expect(screen.getByText(/1 awaiting review/i)).toBeInTheDocument()
  })

  it('lists the links already decided and puts one back to awaiting review', async () => {
    m.fetch.mockResolvedValue([
      link(),
      link({ mappingId: 'm2', status: 'confirmed', relation: 'equivalent', itemA: { ...link().itemA, text: 'Decided item' } }),
      link({ mappingId: 'm3', status: 'rejected', itemA: { ...link().itemA, text: 'Rejected item' } }),
    ])
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    await screen.findByText('Age verification restricts minors')
    expect(screen.queryByText('Decided item')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /decided here \(2\)/i }))
    expect(screen.getByText('Decided item')).toBeInTheDocument()
    expect(screen.getByText('Rejected item')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /back to review/i })[0])
    expect(m.review).toHaveBeenCalledWith('p1', 'm2', 'suggested', undefined)
  })

  it('lets the head auditor ask the AI to find links when there are none', async () => {
    m.fetch.mockResolvedValueOnce([]).mockResolvedValue([link()])
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    expect(await screen.findByText(/no links to review/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /find links/i }))
    expect(m.generate).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('Age verification restricts minors')).toBeInTheDocument()
  })

  it('shows a readable message when loading fails', async () => {
    m.fetch.mockRejectedValue(new Error('network down'))
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i)
  })

  it('shows a readable message when a review fails', async () => {
    m.review.mockRejectedValue(new Error('Mapping not found.'))
    render(<ProjectLinksPanel projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /review linked requirements/i }))
    await userEvent.click(await screen.findByRole('button', { name: /same requirement/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Mapping not found/)
  })
})
