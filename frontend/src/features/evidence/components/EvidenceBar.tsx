import { useId, useState, type ReactNode, type RefObject } from 'react'
import { InfoIcon as Info, LockSimpleIcon as LockSimple, RobotIcon as Robot, SidebarSimpleIcon as SidebarSimple, SpinnerIcon as Spinner } from '@phosphor-icons/react'
import { SUGGESTIONS_NOTE } from '../barStatus'
import type { BarStatus, BarTone } from '../barStatus'

const REGION_NAME = 'AI evidence assessment'
const SHELL =
  'mx-4 my-3 flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250/0.06)] md:mx-8'
const PILL: Partial<Record<BarTone, string>> = {
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section aria-label={REGION_NAME} className={SHELL}>
      <Robot size={18} className="shrink-0 text-blue-600" aria-hidden="true" />
      <span className="shrink-0 text-sm font-semibold text-slate-900">AI evidence</span>
      {children}
    </section>
  )
}

/** The suggestions-only note, behind a small info button: shown on hover, focus or a tap. */
function InfoTip() {
  const tipId = useId()
  const [pinned, setPinned] = useState(false)
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="About AI suggestions"
        aria-describedby={tipId}
        onClick={() => setPinned((v) => !v)}
        onBlur={() => setPinned(false)}
        className="rounded-full p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <Info size={18} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        id={tipId}
        className={`pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none ${
          pinned ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        {SUGGESTIONS_NOTE}
      </span>
    </span>
  )
}

function StatusText({ status, locked }: { status: BarStatus; locked: boolean }) {
  const pill = PILL[status.tone]
  if (pill) {
    return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${pill}`}>{status.text}</span>
  }
  return (
    <span data-running={status.running} className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
      {status.running ? <Spinner size={14} className="shrink-0 animate-spin text-blue-600" aria-hidden="true" /> : null}
      {locked && !status.running ? <LockSimple size={14} className="shrink-0 text-slate-400" aria-hidden="true" /> : null}
      <span className="truncate tabular-nums" title={status.text}>{status.text}</span>
    </span>
  )
}

interface Props {
  /** The source chosen in the drawer: "App", "Code repository" or "Public pages". */
  sourceLabel: string
  status: BarStatus
  locked: boolean
  open: boolean
  drawerId: string
  onOpen(): void
  openerRef: RefObject<HTMLButtonElement>
}

/** One slim line at the top of the audit page: the source, the status and the button that opens the drawer. */
export default function EvidenceBar({ sourceLabel, status, locked, open, drawerId, onOpen, openerRef }: Props) {
  return (
    <Shell>
      <span aria-hidden="true" className="hidden text-slate-300 sm:inline">·</span>
      <span className="hidden shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline">{sourceLabel}</span>
      {/* Read out while the drawer is closed; when open, the drawer's own progress speaks. */}
      <div aria-live={open ? 'off' : 'polite'} className="flex min-w-0 flex-1 items-center">
        <StatusText status={status} locked={locked} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <InfoTip />
        <button
          ref={openerRef}
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={drawerId}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <SidebarSimple size={16} className="-scale-x-100" aria-hidden="true" />
          Open AI evidence
        </button>
      </div>
    </Shell>
  )
}

/** The bar when the evidence service cannot be used at all: one sentence, and Try again when it can help. */
export function BlockedBar({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Shell>
      <p role="alert" className="min-w-0 flex-1 text-xs text-slate-500">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded text-xs font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Try again
        </button>
      ) : null}
    </Shell>
  )
}
