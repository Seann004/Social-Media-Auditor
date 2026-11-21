import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../../../src/lib/db'
import SimilarItemsNotice from '../../../../../src/features/audits/components/SimilarItemsNotice'

vi.mock('../../../../../src/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/db')>()
  return { ...actual, fetchSimilarItems: vi.fn() }
})

const list = vi.mocked(db.fetchSimilarItems)

function side(guidelineName: string, text: string): db.MappedItem {
  return { itemId: text, guidelineId: guidelineName, guidelineName, category: 'Age', itemCode: null, text, reference: null, clause: null }
}

function pair(id: string, relation: db.MappingRelation): db.SimilarPair {
  return {
    mappingId: id, relation, confidence: 0.9, rationale: null, projectItemIdA: `a${id}`, projectItemIdB: `b${id}`,
    itemA: side('ONSA', `Age check ${id}`), itemB: side('UKCC', `Age assurance ${id}`),
  }
}

beforeEach(() => { vi.resetAllMocks() })

describe('SimilarItemsNotice', () => {
  it('shows nothing when no pair is approved for the project', async () => {
    list.mockResolvedValue([])
    const { container } = render(<SimilarItemsNotice projectId="P1" />)
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith('P1'))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when loading fails, so the audit page still works', async () => {
    list.mockRejectedValue(new Error('boom'))
    const { container } = render(<SimilarItemsNotice projectId="P1" />)
    await vi.waitFor(() => expect(list).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('tells the auditor that two items were marked as similar, and lists them', async () => {
    list.mockResolvedValue([pair('1', 'equivalent')])
    render(<SimilarItemsNotice projectId="P1" />)
    expect(await screen.findByText(/two items in this project were marked as similar/i)).toBeInTheDocument()
    expect(screen.getByText('Age check 1')).toBeInTheDocument()
    expect(screen.getByText('Age assurance 1')).toBeInTheDocument()
    expect(screen.getByText('Same requirement')).toBeInTheDocument()
  })

  it('counts several pairs and words partial links in plain language', async () => {
    list.mockResolvedValue([pair('1', 'equivalent'), pair('2', 'partial')])
    render(<SimilarItemsNotice projectId="P1" />)
    expect(await screen.findByText(/2 pairs of items in this project were marked as similar/i)).toBeInTheDocument()
    expect(screen.getByText('Partly overlaps')).toBeInTheDocument()
  })
})
