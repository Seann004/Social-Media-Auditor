import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeRun, makeSuggestion } from '../../../../../src/features/evidence/testFixtures'
import type { ItemKindView } from '../../../../../src/features/evidence/types'
import type { ResponseFlow } from '../../../../../src/features/evidence/useResponseFlow'
import ItemSuggestion from '../../../../../src/features/evidence/components/ItemSuggestion'

const flow: ResponseFlow = {
  canDecide: true,
  handleClick: vi.fn(),
  accept: vi.fn(),
  openOverride: vi.fn(),
  isBusy: () => false,
  errorFor: () => null,
  dialogProps: null,
}

const POLICY: ItemKindView = { kind: 'neither', reason: 'A company policy, not a screen or code.' }
const APP: ItemKindView = { kind: 'app', reason: 'A setting a user can see.' }
const NOTE = "This source can't show this item."
const noCode = makeSuggestion({
  runId: 'run-1',
  source: 'repo',
  suggestedResult: null,
  reason: 'No code in the repository matches this item.',
  flags: [{ type: 'missing_evidence', reason: 'No code in the repository matches this item.' }],
})

describe('ItemSuggestion: the kind and the run reach the card', () => {
  it('notes a policy item on a suggestion carried forward from an earlier run of another source', () => {
    // The latest result run checked the app; this repo suggestion was carried forward from an earlier run.
    const resultRun = makeRun({ id: 'run-2', source: 'app', checkedItemIds: ['item-2'] })
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} kind={POLICY} resultRun={resultRun} />)
    expect(screen.getByText(NOTE).closest('[data-tone="hint"]')).toHaveTextContent(`${NOTE} A company policy, not a screen or code.`)
  })

  it('says nothing for an app item on a repo suggestion: only the picker gives that advice', () => {
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} kind={APP} />)
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it('says nothing for an item the result run left unchecked', () => {
    const resultRun = makeRun({ id: 'run-2', source: 'repo', status: 'partial', checkedItemIds: ['item-1'], uncheckedItemIds: ['item-1'] })
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} kind={POLICY} resultRun={resultRun} />)
    expect(screen.queryByText(NOTE)).toBeNull()
    expect(screen.getAllByText('No code in the repository matches this item.').length).toBeGreaterThan(0)
  })

  it('says nothing without a kind from the AI, as before', () => {
    render(<ItemSuggestion itemId="item-1" flow={flow} suggestion={noCode} decision={null} currentStatus={undefined} />)
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
