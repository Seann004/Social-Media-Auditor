import { KIND_LABEL, type EvidenceKindSuggestion } from '../evidenceKind'

/**
 * The source that can most likely answer an item, in neutral slate: advice, never a warning. The
 * reason is the tooltip, and a screen reader hears it after the label.
 */
export default function EvidenceKindChip({ suggestion }: { suggestion: EvidenceKindSuggestion }) {
  return (
    <span
      title={suggestion.reason}
      data-kind={suggestion.kind}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-2xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
    >
      <span className="sr-only">Suggested source: </span>
      {KIND_LABEL[suggestion.kind]}
      <span className="sr-only">. {suggestion.reason}</span>
    </span>
  )
}
