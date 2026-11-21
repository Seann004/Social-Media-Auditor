import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '../../../../../src/lib/db'
import PendingGroupsPanel from '../../../../../src/features/guidelines/components/PendingGroupsPanel'

vi.mock('../../../../../src/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/db')>()
  return { ...actual, fetchPendingGroups: vi.fn() }
})

const fetchGroups = vi.mocked(db.fetchPendingGroups)

function item(id: string, guidelineName: string, itemCode: string, text: string): db.MappedItem {
  return { itemId: id, guidelineId: guidelineName, guidelineName, category: 'Age', itemCode, text, reference: null, clause: null }
}

const group: db.PendingGroup = {
  groupId: 'a',
  sameGuideline: false,
  items: [item('a', 'TESTA', 'A-1', 'Accounts are private'), item('b', 'TESTB', 'B-1', 'Profiles are private'), item('c', 'TESTC', 'C-1', 'Default privacy')],
  links: [
    { itemIdA: 'a', itemIdB: 'b', state: 'approved' },
    { itemIdA: 'a', itemIdB: 'c', state: 'waiting', mappingId: 'm1', confidence: 0.85 },
    { itemIdA: 'b', itemIdB: 'c', state: 'implied' },
  ],
  waitingIds: ['m1'],
}

beforeEach(() => { vi.resetAllMocks() })

describe('PendingGroupsPanel', () => {
  it('shows nothing when no waiting pairs form a group', async () => {
    fetchGroups.mockResolvedValue([])
    const { container } = render(<PendingGroupsPanel busy={false} onDecide={vi.fn()} />)
    await vi.waitFor(() => expect(fetchGroups).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when the groups cannot be loaded', async () => {
    fetchGroups.mockRejectedValue(new Error('boom'))
    const { container } = render(<PendingGroupsPanel busy={false} onDecide={vi.fn()} />)
    await vi.waitFor(() => expect(fetchGroups).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the group with each link marked as approved, waiting or implied', async () => {
    fetchGroups.mockResolvedValue([group])
    render(<PendingGroupsPanel busy={false} onDecide={vi.fn()} />)
    expect(await screen.findByText(/3 items would be the same requirement/)).toBeInTheDocument()
    expect(screen.getByText('1 link waiting for you')).toBeInTheDocument()
    expect(screen.getByText('Approved by an admin')).toBeInTheDocument()
    expect(screen.getByText('Waiting for you · 85% sure')).toBeInTheDocument()
    expect(screen.getByText('Implied by the other links')).toBeInTheDocument()
  })

  it('approves every waiting link of the group at once', async () => {
    fetchGroups.mockResolvedValue([{ ...group, waitingIds: ['m1', 'm2'] }])
    const onDecide = vi.fn()
    render(<PendingGroupsPanel busy={false} onDecide={onDecide} />)
    await userEvent.click(await screen.findByRole('button', { name: /Approve the group/ }))
    expect(onDecide).toHaveBeenCalledWith(['m1', 'm2'], 'confirmed')
  })

  it('rejects the waiting links of the group', async () => {
    fetchGroups.mockResolvedValue([group])
    const onDecide = vi.fn()
    render(<PendingGroupsPanel busy={false} onDecide={onDecide} />)
    await userEvent.click(await screen.findByRole('button', { name: /Not related/ }))
    expect(onDecide).toHaveBeenCalledWith(['m1'], 'rejected')
  })

  it('disables the buttons while a decision is being saved', async () => {
    fetchGroups.mockResolvedValue([group])
    render(<PendingGroupsPanel busy onDecide={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /Approve the group/ })).toBeDisabled()
  })

  it('warns when two items of one guideline would be grouped', async () => {
    fetchGroups.mockResolvedValue([{ ...group, sameGuideline: true }])
    render(<PendingGroupsPanel busy={false} onDecide={vi.fn()} />)
    expect(await screen.findByText(/Two items of one guideline would be in this group/)).toBeInTheDocument()
  })

  it('turns each item into a link that opens it', async () => {
    fetchGroups.mockResolvedValue([group])
    const onOpenItem = vi.fn()
    render(<PendingGroupsPanel busy={false} onDecide={vi.fn()} onOpenItem={onOpenItem} />)
    const links = await screen.findAllByTitle(/Open TESTC C-1 in Frameworks/)
    await userEvent.click(links[0])
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'c', guidelineName: 'TESTC' }))
  })

  it('shows plain labels when nothing can open the items', async () => {
    fetchGroups.mockResolvedValue([group])
    render(<PendingGroupsPanel busy={false} onDecide={vi.fn()} />)
    await screen.findByText(/3 items would be the same requirement/)
    expect(screen.queryByTitle(/in Frameworks/)).not.toBeInTheDocument()
  })
})
