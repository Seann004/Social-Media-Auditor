import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../lib/db'
import LinkedItemsPanel from './LinkedItemsPanel'

vi.mock('../../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/db')>()
  return {
    ...actual,
    fetchMappingsPage: vi.fn(),
    fetchMappingLearning: vi.fn(),
    reviewMapping: vi.fn(),
    bulkReviewMappings: vi.fn(),
    generateMappings: vi.fn(),
  }
})

const m = {
  page: vi.mocked(db.fetchMappingsPage),
  learning: vi.mocked(db.fetchMappingLearning),
  review: vi.mocked(db.reviewMapping),
  bulk: vi.mocked(db.bulkReviewMappings),
  generate: vi.mocked(db.generateMappings),
}

const GUIDELINES = [
  { id: 'ONSA', name: 'ONSA Code', shortName: 'ONSA' },
  { id: 'UKCC', name: 'UK Code', shortName: 'UKCC' },
]

function item(guidelineName: string, text: string): db.MappedItem {
  return { itemId: text, guidelineId: guidelineName, guidelineName, category: 'Age', itemCode: null, text, reference: null, clause: null }
}

function levelOf(score: number | null): db.ConfidenceLevel {
  return score === null || score < 0.5 ? 'low' : score < 0.8 ? 'medium' : 'high'
}

function pair(id: string, confidence: number | null, over: Partial<db.ItemMapping> = {}): db.ItemMapping {
  return {
    mappingId: id,
    relation: 'equivalent',
    confidence,
    learnedConfidence: confidence,
    learnedFrom: 0,
    score: confidence,
    level: levelOf(confidence),
    rationale: `Reason ${id}`,
    status: 'suggested',
    createdAt: '2026-01-01T00:00:00Z',
    reviewedAt: null,
    usage: { projectsA: 0, projectsB: 0, together: 0 },
    itemA: item('ONSA', `A text ${id}`),
    itemB: item('UKCC', `B text ${id}`),
    ...over,
  }
}

function pageOf(items: db.ItemMapping[], over: Partial<db.MappingPage> = {}): db.MappingPage {
  const levels = { high: 0, medium: 0, low: 0 }
  for (const i of items) levels[i.level]++
  const counts = { suggested: items.length, confirmed: 0, rejected: 0 }
  return { items, total: items.length, counts, totals: counts, levels, linkedGuidelineIds: ['ONSA', 'UKCC'], ...over }
}

const lastFilters = () => m.page.mock.calls[m.page.mock.calls.length - 1][0]

beforeEach(() => {
  vi.resetAllMocks()
  m.review.mockResolvedValue(undefined)
  m.bulk.mockResolvedValue({ updated: 0 })
})

describe('LinkedItemsPanel loading', () => {
  it('says it is loading instead of showing zeros', () => {
    m.page.mockReturnValue(new Promise(() => {}))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('shows the error, not the loading text, when loading fails', async () => {
    m.page.mockRejectedValue(new Error('network down'))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading linked items/i)).not.toBeInTheDocument()
  })

  it('asks for the pairs awaiting review first', async () => {
    m.page.mockResolvedValue(pageOf([]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('Nothing here yet.')
    expect(m.page).toHaveBeenCalledWith({ status: 'suggested' }, 0, 50)
  })
})

describe('LinkedItemsPanel sections', () => {
  it('shows the High, Medium and Low sections with the counts for the whole list', async () => {
    const items = [pair('h', 0.92), pair('m', 0.6), pair('l', 0.3)]
    m.page.mockResolvedValue(pageOf(items, { levels: { high: 120, medium: 40, low: 7 }, total: 167 }))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    const high = await screen.findByRole('button', { name: /high confidence/i })
    expect(within(high).getByText('120')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /medium confidence/i })).getByText('40')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /low confidence/i })).getByText('7')).toBeInTheDocument()
    expect(screen.getByText('A text h')).toBeInTheDocument()
  })

  it('leaves out a section that has no pairs', async () => {
    m.page.mockResolvedValue(pageOf([pair('h', 0.9)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByRole('button', { name: /high confidence/i })
    expect(screen.queryByRole('button', { name: /medium confidence/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /low confidence/i })).not.toBeInTheDocument()
  })

  it('collapses one section without touching the others, and opens it again', async () => {
    m.page.mockResolvedValue(pageOf([pair('h', 0.9), pair('m1', 0.6), pair('l', 0.2)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    const medium = await screen.findByRole('button', { name: /medium confidence/i })
    expect(medium).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(medium)
    expect(medium).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('A text m1')).not.toBeInTheDocument()
    expect(screen.getByText('A text h')).toBeInTheDocument()
    expect(within(medium).getByText('1')).toBeInTheDocument()

    await userEvent.click(medium)
    expect(screen.getByText('A text m1')).toBeInTheDocument()
  })

  it('says how much each pair matters', async () => {
    m.page.mockResolvedValue(pageOf([
      pair('a', 0.9, { usage: { projectsA: 3, projectsB: 2, together: 2 } }),
      pair('b', 0.9, { usage: { projectsA: 1, projectsB: 1, together: 0 } }),
      pair('c', 0.9, { usage: { projectsA: 1, projectsB: 0, together: 0 } }),
      pair('d', 0.9),
    ]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    expect(await screen.findByText('Used together in 2 projects')).toBeInTheDocument()
    expect(screen.getByText('Both items are in use, in different projects')).toBeInTheDocument()
    expect(screen.getByText('Only one of the items is in use')).toBeInTheDocument()
    expect(screen.getByText('Not used in any project yet')).toBeInTheDocument()
  })

  it('shows the learned score next to the AI score once enough decisions back it', async () => {
    m.page.mockResolvedValue(pageOf([
      pair('learned', 0.92, { learnedConfidence: 0.24, learnedFrom: 20 }),
      pair('few', 0.88, { learnedConfidence: 0.7, learnedFrom: 2 }),
      pair('same', 0.85, { learnedConfidence: 0.85, learnedFrom: 30 }),
    ]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    expect(await screen.findByText(/AI 92% · learned 24% \(from 20 past decisions\)/)).toBeInTheDocument()
    expect(screen.getByText('88% sure')).toBeInTheDocument()
    expect(screen.getByText('85% sure')).toBeInTheDocument()
  })
})

describe('LinkedItemsPanel tabs and filters', () => {
  it('shows the counts of every status and asks again when a tab is chosen', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)], { counts: { suggested: 1, confirmed: 4, rejected: 2 } }))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    const approved = await screen.findByRole('button', { name: /approved/i })
    expect(within(approved).getByText('4')).toBeInTheDocument()
    await userEvent.click(approved)
    await waitFor(() => expect(lastFilters()).toEqual({ status: 'confirmed' }))
  })

  it('filters by framework, by AI label and by pairs in use, and clears the filters', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p')

    await userEvent.selectOptions(screen.getByLabelText('Filter by framework'), 'UKCC')
    await waitFor(() => expect(lastFilters()).toEqual({ status: 'suggested', guidelineId: 'UKCC' }))
    await userEvent.selectOptions(screen.getByLabelText('Filter by AI label'), 'partial')
    await waitFor(() => expect(lastFilters()).toEqual({ status: 'suggested', guidelineId: 'UKCC', relation: 'partial' }))
    await userEvent.click(screen.getByLabelText('Only pairs that are in use'))
    await waitFor(() => expect(lastFilters()).toEqual({ status: 'suggested', guidelineId: 'UKCC', relation: 'partial', inUse: true }))

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(lastFilters()).toEqual({ status: 'suggested' }))
  })

  it('says when no pair matches the filters', async () => {
    m.page.mockResolvedValueOnce(pageOf([pair('p', 0.9)])).mockResolvedValue(pageOf([]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p')
    await userEvent.click(screen.getByLabelText('Only pairs that are in use'))
    expect(await screen.findByText('No pairs match these filters.')).toBeInTheDocument()
  })

  it('loads the next pages without repeating pairs', async () => {
    const first = Array.from({ length: 3 }, (_, i) => pair(`a${i}`, 0.9))
    const second = [pair('a2', 0.9), pair('b0', 0.9)]
    m.page.mockResolvedValueOnce(pageOf(first, { total: 5 })).mockResolvedValueOnce(pageOf(second, { total: 5 }))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /show 2 more \(3 of 5 shown\)/i }))
    expect(m.page).toHaveBeenLastCalledWith({ status: 'suggested' }, 3, 50)
    expect(await screen.findByText('A text b0')).toBeInTheDocument()
    expect(screen.getAllByText('A text a2')).toHaveLength(1)
  })

  it('has no Show more button when everything is loaded', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p')
    expect(screen.queryByRole('button', { name: /show .* more/i })).not.toBeInTheDocument()
  })
})

describe('LinkedItemsPanel decisions', () => {
  it('approves one pair as the same requirement, and reloads the list', async () => {
    m.page.mockResolvedValueOnce(pageOf([pair('p1', 0.9)])).mockResolvedValueOnce(pageOf([]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Same requirement' }))
    expect(m.review).toHaveBeenCalledWith('p1', 'confirmed', 'equivalent')
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('rejects a pair with Not related', async () => {
    m.page.mockResolvedValue(pageOf([pair('p1', 0.4)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Not related' }))
    expect(m.review).toHaveBeenCalledWith('p1', 'rejected', undefined)
  })

  it('shows an error when a decision cannot be saved', async () => {
    m.page.mockResolvedValue(pageOf([pair('p1', 0.4)]))
    m.review.mockRejectedValue(new Error('could not save'))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Not related' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
  })

  it('decides the selected pairs together', async () => {
    m.page.mockResolvedValue(pageOf([pair('p1', 0.9), pair('p2', 0.85), pair('p3', 0.6)]))
    m.bulk.mockResolvedValue({ updated: 2 })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p1')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText(/Select this pair: A text p1/))
    await userEvent.click(screen.getByLabelText(/Select this pair: A text p2/))
    const bar = screen.getByRole('toolbar')
    expect(bar).toHaveTextContent('2 selected')

    await userEvent.click(within(bar).getByRole('button', { name: 'Same requirement' }))
    expect(m.bulk).toHaveBeenCalledWith({ ids: ['p1', 'p2'], status: 'confirmed', relation: 'equivalent' })
    expect(await screen.findByText('Updated 2 pairs.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument())
  })

  it('selects every pair shown in a section', async () => {
    m.page.mockResolvedValue(pageOf([pair('h1', 0.9), pair('h2', 0.85), pair('m1', 0.6)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByLabelText('Select the 2 shown in this section'))
    expect(screen.getByRole('toolbar')).toHaveTextContent('2 selected')
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('asks to confirm before approving a whole section, and then covers every page', async () => {
    m.page.mockResolvedValue(pageOf([pair('h1', 0.9)], { levels: { high: 120, medium: 0, low: 0 }, total: 120 }))
    m.bulk.mockResolvedValue({ updated: 120 })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve all (120)' }))
    expect(m.bulk).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/approve all 120 pairs in this section \(every page/i)

    await userEvent.click(screen.getByRole('button', { name: 'Yes, approve 120' }))
    expect(m.bulk).toHaveBeenCalledWith({ filter: { status: 'suggested', level: 'high' }, expectedCount: 120, status: 'confirmed' })
    expect(await screen.findByText('Approved 120 pairs.')).toBeInTheDocument()
  })

  it('sends the active filters along with a section decision', async () => {
    m.page.mockResolvedValue(pageOf([pair('h1', 0.9)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text h1')
    await userEvent.selectOptions(screen.getByLabelText('Filter by framework'), 'UKCC')
    await userEvent.click(await screen.findByRole('button', { name: 'Reject all (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reject 1' }))
    expect(m.bulk).toHaveBeenCalledWith({ filter: { status: 'suggested', guidelineId: 'UKCC', level: 'high' }, expectedCount: 1, status: 'rejected' })
  })

  it('does nothing when the confirmation is cancelled', async () => {
    m.page.mockResolvedValue(pageOf([pair('h1', 0.9)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Reject all (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(m.bulk).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reject all (1)' })).toBeInTheDocument()
  })

  it('shows the message when the list changed since the admin looked', async () => {
    m.page.mockResolvedValue(pageOf([pair('h1', 0.9)]))
    m.bulk.mockRejectedValue(new Error('The list changed: 2 pairs match now. Reload the list and try again.'))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve all (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, approve 1' }))
    expect(await screen.findByText(/the list changed: 2 pairs match now/i)).toBeInTheDocument()
  })

  it('offers only the other decision on the tabs of decided pairs', async () => {
    m.page.mockResolvedValue(pageOf([pair('c1', 0.9, { status: 'confirmed' })], { counts: { suggested: 0, confirmed: 1, rejected: 0 } }))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /approved/i }))
    expect(await screen.findByRole('button', { name: 'Reject all (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve all/i })).not.toBeInTheDocument()
  })
})

describe('LinkedItemsPanel summary and notes', () => {
  it('shows the totals of every status whatever the filters', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)], { totals: { suggested: 40, confirmed: 30, rejected: 10 } }))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p')
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Approved out of 40 reviewed')).toBeInTheDocument()
  })

  it('lists the frameworks that have no saved pairs, so a failed automatic check is noticed', async () => {
    m.page.mockResolvedValue(pageOf([pair('p1', 0.9)], { linkedGuidelineIds: ['ONSA'] }))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('UKCC')
    expect(note).not.toHaveTextContent('ONSA')
  })

  it('shows no such note when every framework has pairs', async () => {
    m.page.mockResolvedValue(pageOf([pair('p1', 0.9)]))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p1')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('runs Find links for the chosen framework and reloads', async () => {
    m.page.mockResolvedValue(pageOf([]))
    m.generate.mockResolvedValue({ checked: 12, suggested: 3, failedBatches: 0 })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.selectOptions(await screen.findByLabelText('Framework'), 'ONSA')
    await userEvent.click(screen.getByRole('button', { name: /find links/i }))
    expect(m.generate).toHaveBeenCalledWith('ONSA')
    expect(await screen.findByText(/found 3 possible links across 12 items/i)).toBeInTheDocument()
  })
})

describe('LearningPanel', () => {
  it('stays closed until opened, then shows how the AI has done per confidence band', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)]))
    m.learning.mockResolvedValue({
      decided: 24, approved: 18, rejected: 6, minDecisionsToShow: 5,
      bands: [{ relation: 'equivalent', fromPercent: 90, toPercent: 100, decided: 20, approved: 18, approvalRate: 0.9 }],
    })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await screen.findByText('A text p')
    expect(m.learning).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /how the ai is learning/i }))
    expect(await screen.findByText('90–100%')).toBeInTheDocument()
    expect(screen.getByText('90% (18 of 20)')).toBeInTheDocument()
    expect(screen.getByText(/24/)).toBeInTheDocument()
  })

  it('loads the new numbers again when it is reopened', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)]))
    m.learning
      .mockResolvedValueOnce({ decided: 0, approved: 0, rejected: 0, minDecisionsToShow: 5, bands: [] })
      .mockResolvedValueOnce({ decided: 7, approved: 4, rejected: 3, minDecisionsToShow: 5, bands: [] })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    const toggle = await screen.findByRole('button', { name: /how the ai is learning/i })
    await userEvent.click(toggle)
    expect(await screen.findByText(/nothing to learn from yet/i)).toBeInTheDocument()
    await userEvent.click(toggle)
    await userEvent.click(toggle)
    expect(m.learning).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('loads the numbers again when a decision is made while it is open', async () => {
    m.page
      .mockResolvedValueOnce(pageOf([pair('p', 0.9)]))
      .mockResolvedValue(pageOf([], { totals: { suggested: 0, confirmed: 1, rejected: 0 } }))
    m.learning
      .mockResolvedValueOnce({ decided: 0, approved: 0, rejected: 0, minDecisionsToShow: 5, bands: [] })
      .mockResolvedValue({ decided: 1, approved: 1, rejected: 0, minDecisionsToShow: 5, bands: [{ relation: 'equivalent', fromPercent: 90, toPercent: 100, decided: 1, approved: 1, approvalRate: 1 }] })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /how the ai is learning/i }))
    await screen.findByText(/nothing to learn from yet/i)

    await userEvent.click(screen.getByRole('button', { name: 'Same requirement' }))
    expect(await screen.findByText('90–100%')).toBeInTheDocument()
    expect(m.learning).toHaveBeenCalledTimes(2)
  })

  it('says there is nothing to learn from yet', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)]))
    m.learning.mockResolvedValue({ decided: 0, approved: 0, rejected: 0, minDecisionsToShow: 5, bands: [] })
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /how the ai is learning/i }))
    expect(await screen.findByText(/nothing to learn from yet/i)).toBeInTheDocument()
  })

  it('shows the error when it cannot load', async () => {
    m.page.mockResolvedValue(pageOf([pair('p', 0.9)]))
    m.learning.mockRejectedValue(new Error('no learning'))
    render(<LinkedItemsPanel guidelines={GUIDELINES} />)
    await userEvent.click(await screen.findByRole('button', { name: /how the ai is learning/i }))
    expect(await screen.findByText('no learning')).toBeInTheDocument()
  })
})
