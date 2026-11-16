import { KIND_LABEL } from '../kindHints'
import type { ItemKindView } from '../types'

/**
 * The source the AI says can most likely answer an item, in neutral slate: advice, never a warning.
 * The AI's reason is the tooltip, and a screen reader hears it after the label.
 */
export default function EvidenceKindChip({ kind }: { kind: ItemKindView }) {
  return (
    <span
      title={kind.reason}
      data-kind={kind.kind}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-2xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
    >
      <span className="sr-only">Suggested source: </span>
      {KIND_LABEL[kind.kind]}
      <span className="sr-only">. {kind.reason}</span>
    </span>
  )
}
