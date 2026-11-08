import { useMemo, useState } from 'react'
import { EvidenceApiError } from './api'
import type { PickItem } from './appState'
import type { RunStatus, RunView } from './types'

/** Statuses of a run that is still going. */
export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'capturing', 'assessing']

export const isRunActive = (run: RunView | null): boolean => run !== null && ACTIVE_STATUSES.includes(run.status)

interface Options {
  items: PickItem[]
  run: RunView | null
  startRun(itemIds: string[]): Promise<unknown>
  /** Called after a run was started (or refused as already running), to reload the panel. */
  onStarted(): void | Promise<void>
}

export interface UseItemRunResult {
  setChosen(next: Set<string>): void
  /** Picked ids in checklist order; items that left the checklist are dropped. */
  pickedIds: string[]
  picked: ReadonlySet<string>
  busy: boolean
  message: string | null
  running: boolean
  start(): Promise<void>
}

/** Picked items, the busy and message state, and the start call shared by the App and Repo sections. */
export function useItemRun({ items, run, startRun, onStarted }: Options): UseItemRunResult {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const pickedIds = useMemo(() => items.filter((i) => chosen.has(i.id)).map((i) => i.id), [items, chosen])
  const picked = useMemo(() => new Set(pickedIds), [pickedIds])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function start(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      await startRun(pickedIds)
    } catch (err) {
      // A 409 means a run is already going; the reload shows it.
      if (!(err instanceof EvidenceApiError) || err.status !== 409) {
        setMessage(err instanceof EvidenceApiError ? err.message : 'Something went wrong. Try again.')
      }
    }
    try {
      await onStarted()
    } finally {
      setBusy(false)
    }
  }

  return { setChosen, pickedIds, picked, busy, message, running: isRunActive(run), start }
}
