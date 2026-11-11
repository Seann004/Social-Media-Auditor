import type { ChecklistItemStatus } from '../../../types'
import { hasAnswer, provenance, toAnswerStatus } from '../state'
import type { DecisionView, SuggestedResult } from '../types'
import { RESULT_LABEL } from './OverrideDialog'

interface Props {
  decision: DecisionView | null
  currentStatus: ChecklistItemStatus | undefined
}

const labelOf = (result: SuggestedResult | null): string =>
  result === null ? 'AI suggestion' : `AI suggested ${RESULT_LABEL[toAnswerStatus(result)]}`

/** Where the current answer came from. Nothing for an item that has no answer yet. */
export default function ProvenanceBadge({ decision, currentStatus }: Props) {
  if (!hasAnswer(currentStatus)) return null
  const source = provenance({ decision, currentStatus })
  const text =
    source.kind === 'manual'
      ? 'Manual'
      : source.kind === 'accepted'
        ? `${labelOf(source.suggested)} · accepted`
        : `${labelOf(source.suggested)} · overridden to ${RESULT_LABEL[source.final]}${source.reason ? `: ${source.reason}` : ''}`
  const tone = source.kind === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{text}</span>
}
