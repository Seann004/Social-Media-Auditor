import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChecklistItem } from '../../../types'
import { makeRun, makeSuggestion } from '../testFixtures'
import type { ResponseFlow } from '../useResponseFlow'
import ItemSuggestion from './ItemSuggestion'

const flow: ResponseFlow = {
  canDecide: true,
  handleClick: vi.fn(),
  accept: vi.fn(),
  openOverride: vi.fn(),
  isBusy: () => false,
  errorFor: () => null,
  dialogProps: null,
}

const appItem: ChecklistItem = {
  id: 'item-1',
  guidelineId: 'g1',
  category: 'Privacy by default',
  text: 'Accounts of users under 16 are private by default.',
  severity: 'critical',
}
const NOTE = "This source can't show this item."
const noCode = makeSuggestion({
  runId: 'run-1',
  source: 'repo',
  suggestedResult: null,
  reason: 'No code in the repository matches this item.',
  flags: [{ type: 'missing_evidence', reason: 'No code in the repository matches this item.' }],
})

describe('ItemSuggestion: the item and its run reach the card', () => {
  it("names the item's kind on a suggestion carried forward from an earlier run of another source", () => {
    // The latest result run checked the app; this repo suggestion was carried forward from an earlier run.
    const resultRun = makeRun({ id: 'run-2', source: 'app', checkedItemIds: ['item-2'] })
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} item={appItem} resultRun={resultRun} />)
    expect(screen.getByText(NOTE).closest('[data-tone="hint"]')).toHaveTextContent(
      `${NOTE} It is about something a user can see or change in the app (it mentions “private”).`,
    )
  })

  it('says nothing for an item the result run left unchecked', () => {
    const resultRun = makeRun({ id: 'run-2', source: 'repo', status: 'partial', checkedItemIds: ['item-1'], uncheckedItemIds: ['item-1'] })
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} item={appItem} resultRun={resultRun} />)
    expect(screen.queryByText(NOTE)).toBeNull()
    expect(screen.getAllByText('No code in the repository matches this item.').length).toBeGreaterThan(0)
  })

  it('says nothing when the page gives no item, as before', () => {
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} />)
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
