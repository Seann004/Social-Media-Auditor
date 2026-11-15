import { useId } from 'react'
import { motion } from 'framer-motion'
import { PlayIcon as Play } from '@phosphor-icons/react'

interface Props {
  /** What the run would use, for example "2 items · 2 accounts ready". */
  summary: string
  /** Why the run cannot start, shown beside the button and linked to it; null when it can. */
  reason: string | null
  /** A refusal from the last start. */
  message?: string | null
  /** False on a locked audit: only the reason shows. */
  showButton: boolean
  label: string
  onRun(): void
  disabled: boolean
}

/**
 * The action bar at the bottom of the drawer. It sticks to the bottom of the scrolling content, so
 * it must be the last element of that content.
 */
export default function RunFooter({ summary, reason, message = null, showButton, label, onRun, disabled }: Props) {
  const reasonId = useId()
  return (
    <div
      data-run-bar=""
      role="group"
      aria-label="Run"
      className="sticky bottom-0 z-10 -mx-5 -mb-5 border-t border-slate-200 bg-white px-5 py-3 shadow-[0_-6px_12px_-8px_oklch(0.3_0.01_250/0.18)]"
    >
      {message ? <p role="alert" className="mb-2 text-xs text-rose-600">{message}</p> : null}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tabular-nums text-slate-700">{summary}</p>
          {reason ? <p id={reasonId} className="text-xs text-slate-600">{reason}</p> : null}
        </div>
        {showButton ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={onRun}
            disabled={disabled}
            aria-describedby={reason ? reasonId : undefined}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={14} weight="fill" aria-hidden="true" />
            {label}
          </motion.button>
        ) : null}
      </div>
    </div>
  )
}
