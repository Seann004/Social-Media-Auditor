import type { ChecklistItemStatus } from '../../../types'
import type { ResponseFlow } from '../useResponseFlow'
import type { DecisionView, SuggestionView } from '../types'
import SuggestionCard from './SuggestionCard'

interface Props {
  itemId: string
  flow: ResponseFlow
  suggestion: SuggestionView | undefined
  decision: DecisionView | null
  currentStatus: ChecklistItemStatus | undefined
}

/** The suggestion card of one checklist item, wired to the response flow. Renders nothing without a suggestion. */
export default function ItemSuggestion({ itemId, flow, suggestion, decision, currentStatus }: Props) {
  if (!suggestion) return null
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
    />
  )
}
