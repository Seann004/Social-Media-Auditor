import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../../../src/lib/db'
import GroupsPanel from '../../../../../src/features/guidelines/components/GroupsPanel'
import { GroupImpactNote } from '../../../../../src/features/guidelines/components/PairCard'

vi.mock('../../../../../src/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/db')>()
  return { ...actual, fetchMappingGroups: vi.fn() }
})

const groups = vi.mocked(db.fetchMappingGroups)

function item(id: string, guidelineName: string, itemCode: string, text: string): db.MappedItem {
  return { itemId: id, guidelineId: guidelineName, guidelineName, category: 'Age', itemCode, text, reference: null, clause: null }
}

beforeEach(() => { vi.resetAllMocks() })

describe('GroupsPanel', () => {
  it('stays closed and loads nothing until it is opened', () => {
    render(<GroupsPanel />)
    expect(groups).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Groups of items/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists each group with its items when opened', async () => {
    groups.mockResolvedValue([{
      groupId: 'a', directPairs: 2, sameGuideline: false,
      items: [item('a', 'TESTA', 'A-1', 'Accounts are private'), item('b', 'TESTB', 'B-1', 'Profiles are private'), item('c', 'TESTC', 'C-1', 'Default privacy')],
    }])
    render(<GroupsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Groups of items/ }))
    expect(await screen.findByText('3 items · 2 approved pairs')).toBeInTheDocument()
    expect(screen.getByText('Profiles are private')).toBeInTheDocument()
  })

  it('warns about a group with two items of one guideline', async () => {
    groups.mockResolvedValue([{ groupId: 'a', directPairs: 1, sameGuideline: true, items: [item('a', 'TESTA', 'A-1', 'x'), item('b', 'TESTA', 'A-2', 'y')] }])
    render(<GroupsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Groups of items/ }))
    expect(await screen.findByText(/Two items of one guideline are in this group/)).toBeInTheDocument()
  })

  it('says so when there are no groups', async () => {
    groups.mockResolvedValue([])
    render(<GroupsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Groups of items/ }))
    expect(await screen.findByText(/No groups yet/)).toBeInTheDocument()
  })

  it('shows an error when the groups cannot be loaded', async () => {
    groups.mockRejectedValue(new Error('boom'))
    render(<GroupsPanel />)
    await userEvent.click(screen.getByRole('button', { name: /Groups of items/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})

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
