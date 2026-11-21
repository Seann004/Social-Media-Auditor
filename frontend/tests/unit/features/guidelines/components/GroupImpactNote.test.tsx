import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type * as db from '../../../../../src/lib/db'
import { GroupImpactNote } from '../../../../../src/features/guidelines/components/pairParts'

function item(id: string, guidelineName: string, itemCode: string, text: string): db.MappedItem {
  return { itemId: id, guidelineId: guidelineName, guidelineName, category: 'Age', itemCode, text, reference: null, clause: null }
}

function pair(impact: db.GroupImpact | null, status: db.MappingStatus = 'suggested'): db.ItemMapping {
  return {
    mappingId: 'm', relation: 'equivalent', confidence: 0.9, learnedConfidence: 0.9, learnedFrom: 0, score: 0.9, level: 'high',
    rationale: null, status, createdAt: '', reviewedAt: null, usage: { projectsA: 0, projectsB: 0, together: 0 },
    groupImpact: impact, itemA: item('a', 'TESTA', 'A-1', 'x'), itemB: item('c', 'TESTC', 'C-1', 'y'),
  }
}

describe('GroupImpactNote', () => {
  it('names the items an approval would put in the same group', () => {
    render(<GroupImpactNote pair={pair({ joins: [item('b', 'TESTB', 'B-1', 'z')], sameGuideline: false, alreadyTogether: false })} />)
    expect(screen.getByText(/puts both items in one group with TESTB B-1/)).toBeInTheDocument()
  })

  it('warns when two items of one guideline would be grouped', () => {
    render(<GroupImpactNote pair={pair({ joins: [item('b', 'TESTA', 'A-2', 'z')], sameGuideline: true, alreadyTogether: false })} />)
    expect(screen.getByText(/Check that the link is not too wide/)).toBeInTheDocument()
  })

  it('says nothing when the pair touches no group, or is not waiting for review', () => {
    const { container, rerender } = render(<GroupImpactNote pair={pair(null)} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<GroupImpactNote pair={pair({ joins: [item('b', 'TESTB', 'B-1', 'z')], sameGuideline: false, alreadyTogether: false }, 'confirmed')} />)
    expect(container).toBeEmptyDOMElement()
  })
})
