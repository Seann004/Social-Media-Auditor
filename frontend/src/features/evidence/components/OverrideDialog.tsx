import { useId, useRef, useState } from 'react'
import type { AnswerStatus } from '../types'
import { useModal } from './useModal'

export const RESULT_LABEL: Readonly<Record<AnswerStatus, string>> = {
  compliant: 'Yes',
  non_compliant: 'No',
  partially: 'Partially',
  not_applicable: 'N/A',
}
const RESULTS = Object.keys(RESULT_LABEL) as AnswerStatus[]
const MIN_REASON = 3
const MAX_REASON = 2000

export interface OverrideDialogProps {
  /** The AI's result, in words, for the heading. */
  suggestedLabel: string
  /** Answer chosen when the dialog opens. */
  presetResult?: AnswerStatus
  /** A result that cannot be chosen (the AI's own: that is an accept). */
  excludeResult?: AnswerStatus
  busy?: boolean
  error?: string | null
  onConfirm: (finalResult: AnswerStatus, reason: string) => void
  onCancel: () => void
}

export default function OverrideDialog({ suggestedLabel, presetResult, excludeResult, busy = false, error, onConfirm, onCancel }: OverrideDialogProps) {
  const [result, setResult] = useState<AnswerStatus | null>(presetResult ?? null)
  const [reason, setReason] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reasonId = useId()
  const onKeyDown = useModal(root, () => {
    if (!busy) onCancel()
  })
  const trimmed = reason.trim()
  const canConfirm = !busy && result !== null && trimmed.length >= MIN_REASON

  return (
    // A press on the backdrop must not move focus out of the dialog (Escape and the Tab trap would stop).
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          Override AI suggestion
        </h2>
        <p className="text-sm text-slate-500">The AI suggested {suggestedLabel}. Choose your answer and say why.</p>
        <fieldset className="flex flex-wrap gap-2" disabled={busy}>
          <legend className="sr-only">Your answer</legend>
          {RESULTS.filter((r) => r !== excludeResult).map((r) => (
            <label
              key={r}
              className={[
                'cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ring-1 focus-within:ring-2 focus-within:ring-blue-500',
                result === r ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-200 hover:ring-blue-300',
              ].join(' ')}
            >
              <input type="radio" name="override-result" value={r} checked={result === r} onChange={() => setResult(r)} className="sr-only" />
              {RESULT_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor={reasonId} className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
            Reason
          </label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={MAX_REASON}
            rows={3}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => result !== null && onConfirm(result, trimmed)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Confirm override
          </button>
        </div>
      </div>
    </div>
  )
}
