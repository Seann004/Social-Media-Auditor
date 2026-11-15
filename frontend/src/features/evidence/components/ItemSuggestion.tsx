import type { ChecklistItemStatus } from '../../../types'
import type { EvidenceKindInput } from '../evidenceKind'
import type { ResponseFlow } from '../useResponseFlow'
import type { DecisionView, RunView, SuggestionView } from '../types'
import SuggestionCard from './SuggestionCard'

interface Props {
  itemId: string
  flow: ResponseFlow
  suggestion: SuggestionView | undefined
  decision: DecisionView | null
  currentStatus: ChecklistItemStatus | undefined
  /** The checklist item, so the card can say when the suggestion's source can't show it. */
  item?: EvidenceKindInput
  /** The run the suggestions belong to: an item it left unchecked gets no such note. */
  resultRun?: RunView | null
}

/** The suggestion card of one checklist item, wired to the response flow. Renders nothing without a suggestion. */
export default function ItemSuggestion({ itemId, flow, suggestion, decision, currentStatus, item, resultRun }: Props) {
  if (!suggestion) {
    // A failed answer-button decision on an item without a card still has to be told to the auditor.
    const error = flow.errorFor(itemId)
    return error ? (
      <p role="alert" className="mt-3 text-sm text-rose-600">
        {error}
      </p>
    ) : null
  }
  return (
    <SuggestionCard
      suggestion={suggestion}
      decision={decision}
      currentStatus={currentStatus}
      canDecide={flow.canDecide}
      busy={flow.isBusy(itemId)}
      error={flow.errorFor(itemId)}
      onAccept={() => void flow.accept(itemId)}
      onOverride={() => flow.openOverride(itemId, 'override')}
      onKeepMine={() => flow.openOverride(itemId, 'keep')}
      item={item}
      unchecked={resultRun?.uncheckedItemIds.includes(itemId) ?? false}
    />
  )
}
