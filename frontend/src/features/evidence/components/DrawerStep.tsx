import { useId, useState, type ReactNode } from 'react'
import { CheckIcon as Check, PencilSimpleIcon as PencilSimple } from '@phosphor-icons/react'

export type StepState = 'done' | 'current' | 'todo'

const BADGE: Record<StepState, string> = {
  done: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  current: 'bg-blue-600 text-white',
  todo: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
}

interface Props {
  n: number
  title: string
  state: StepState
  /** A control at the right of the step's heading line. */
  aside?: ReactNode
  children: ReactNode
}

/** One numbered step of the drawer: ① Source, ② Set up, ③ Items and run. */
export default function DrawerStep({ n, title, state, aside, children }: Props) {
  return (
    <div>
      <div className="flex min-h-[28px] items-center gap-2.5">
        <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${BADGE[state]}`}>
          {state === 'done' ? <Check size={12} weight="bold" /> : n}
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
          <span className="sr-only">Step {n}: </span>
          {title}
          {state === 'done' ? <span className="sr-only"> (done)</span> : null}
        </h3>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

interface SetupProps {
  complete: boolean
  /** The one line shown while folded. */
  summary: ReactNode
  children: ReactNode
}

/**
 * Step ② with a fold. It starts folded only when the set-up was already complete; finishing the
 * set-up while editing leaves it open, so a second account can still be added.
 */
export function SetupStep({ complete, summary, children }: SetupProps) {
  const [editing, setEditing] = useState(() => !complete)
  const open = editing || !complete
  const contentId = useId()
  const toggle = complete ? (
    <button
      type="button"
      onClick={() => setEditing(!open)}
      aria-expanded={open}
      aria-controls={contentId}
      aria-label={open ? 'Done editing set-up' : 'Edit set-up'}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {open ? null : <PencilSimple size={12} aria-hidden="true" />}
      {open ? 'Done' : 'Edit'}
    </button>
  ) : null
  return (
    <DrawerStep n={2} title="Set up" state={complete ? 'done' : 'current'} aside={toggle}>
      <div id={contentId}>
        {open ? children : <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">{summary}</p>}
      </div>
    </DrawerStep>
  )
}
