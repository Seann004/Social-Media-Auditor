import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../lib/db'
import LinkedItemsPanel from './LinkedItemsPanel'

vi.mock('../../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/db')>()
  return { ...actual, fetchMappings: vi.fn(), reviewMapping: vi.fn(), generateMappings: vi.fn() }
})

const m = {
  list: vi.mocked(db.fetchMappings),
  review: vi.mocked(db.reviewMapping),
  generate: vi.mocked(db.generateMappings),
}

const GUIDELINES = [{ id: 'G1', name: 'ONSA Code', shortName: 'ONSA' }]

function item(guidelineName: string, text: string): db.MappedItem {
  return { itemId: text, guidelineId: guidelineName, guidelineName, category: 'Age', itemCode: null, text, reference: null, clause: null }
}

function pair(id: string, confidence: number | null, status: db.MappingStatus = 'suggested'): db.ItemMapping {
  return {
    mappingId: id,
    relation: 'equivalent',
    confidence,
    rationale: `Reason ${id}`,
    status,
    createdAt: '2026-01-01T00:00:00Z',
    reviewedAt: null,
    itemA: item('ONSA', `A text ${id}`),
    itemB: item('UKCC', `B text ${id}`),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('LinkedItemsPanel', () => {
  it('says it is loading instead of showing zeros', () => {
    m.list.mockReturnValue(new Promise(() => {}))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('shows the error, not the loading text, when loading fails', async () => {
    m.list.mockRejectedValue(new Error('network down'))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading linked items/i)).not.toBeInTheDocument()
  })

  it('groups the pairs awaiting review into high, medium and low confidence sections', async () => {
    m.list.mockResolvedValue([pair('low', 0.3), pair('high', 0.92), pair('mid', 0.6), pair('none', null), pair('high2', 0.81)])
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)

    const high = await screen.findByRole('region', { name: 'High confidence' })
    const medium = screen.getByRole('region', { name: 'Medium confidence' })
    const low = screen.getByRole('region', { name: 'Low confidence' })
    expect(within(high).getAllByText(/^A text/).map((n) => n.textContent)).toEqual(['A text high', 'A text high2'])
    expect(within(medium).getAllByText(/^A text/).map((n) => n.textContent)).toEqual(['A text mid'])
    expect(within(low).getAllByText(/^A text/).map((n) => n.textContent)).toEqual(['A text low', 'A text none'])
    expect(within(high).getByText('92% sure')).toBeInTheDocument()
  })

  it('leaves out a section that has no pairs', async () => {
    m.list.mockResolvedValue([pair('high', 0.9)])
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByRole('region', { name: 'High confidence' })
    expect(screen.queryByRole('region', { name: 'Medium confidence' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Low confidence' })).not.toBeInTheDocument()
  })

  it('shows only the pairs of the chosen status tab, with counts', async () => {
    m.list.mockResolvedValue([pair('one', 0.9), pair('two', 0.9, 'confirmed'), pair('three', 0.4, 'rejected')])
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text one')
    expect(screen.queryByText('A text two')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /approved/i }))
    expect(screen.getByText('A text two')).toBeInTheDocument()
    expect(screen.queryByText('A text one')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /rejected/i }))
    expect(screen.getByText('A text three')).toBeInTheDocument()
  })

  it('approves a pair as the same requirement, and reloads the list', async () => {
    m.list.mockResolvedValueOnce([pair('p1', 0.9)]).mockResolvedValueOnce([pair('p1', 0.9, 'confirmed')])
    m.review.mockResolvedValue(undefined)
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /same requirement/i }))
    expect(m.review).toHaveBeenCalledWith('p1', 'confirmed', 'equivalent')
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('rejects a pair with Not related', async () => {
    m.list.mockResolvedValue([pair('p1', 0.4)])
    m.review.mockResolvedValue(undefined)
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /not related/i }))
    expect(m.review).toHaveBeenCalledWith('p1', 'rejected', undefined)
  })

  it('shows an error when a decision cannot be saved', async () => {
    m.list.mockResolvedValue([pair('p1', 0.4)])
    m.review.mockRejectedValue(new Error('could not save'))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /not related/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
  })

  it('runs Find links for the chosen framework', async () => {
    m.list.mockResolvedValue([])
    m.generate.mockResolvedValue({ checked: 12, suggested: 3, failedBatches: 0 })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.selectOptions(await screen.findByLabelText('Framework'), 'G1')
    await userEvent.click(screen.getByRole('button', { name: /find links/i }))
    expect(m.generate).toHaveBeenCalledWith('G1')
    expect(await screen.findByText(/found 3 possible links across 12 items/i)).toBeInTheDocument()
  })
})
