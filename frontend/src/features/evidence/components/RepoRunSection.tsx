import { useMemo, useState } from 'react'
import { EvidenceApiError, startRepoRun } from '../api'
import type { PickItem } from '../appState'
import type { RunView } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import { useRepoSetup } from '../useRepoSetup'
import RepoSetup, { REPO_ITEM_LIMIT } from './RepoSetup'

interface Props {
  projectId: string
  items: PickItem[]
  evidence: UseEvidenceResult
  locked: boolean
  /** Called after a run was started (or refused as already running), to reload the panel. */
  onStarted(): void | Promise<void>
}

const ACTIVE: RunView['status'][] = ['queued', 'capturing', 'assessing']

function blocker(input: { hasRepo: boolean; picked: number; locked: boolean; running: boolean }): string | null {
  if (input.locked) return 'This audit is locked, so no runs can start.'
  if (input.running) return 'A run is already in progress.'
  if (!input.hasRepo) return 'Save the repository address first.'
  if (input.picked === 0) return 'Pick at least one item.'
  return null
}

/** The Code repository branch of the evidence panel. */
export default function RepoRunSection({ projectId, items, evidence, locked, onStarted }: Props) {
  const setup = useRepoSetup(projectId, { enabled: true })
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  // Picked ids follow the checklist's order, and items that left the checklist are not sent.
  const pickedIds = useMemo(() => items.filter((i) => chosen.has(i.id)).map((i) => i.id), [items, chosen])
  const picked = useMemo(() => new Set(pickedIds), [pickedIds])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const running = evidence.run !== null && ACTIVE.includes(evidence.run.status)
  const why = blocker({ hasRepo: setup.repo !== null, picked: pickedIds.length, locked, running })

  async function start(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      await startRepoRun(projectId, pickedIds.slice(0, REPO_ITEM_LIMIT))
    } catch (err) {
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

  if (setup.state === 'loading') return <p className="text-xs text-slate-500">Loading…</p>
  if (setup.state === 'error') {
    return <p role="alert" className="text-xs text-rose-600">The saved repository could not be loaded. Choose another source and come back to try again.</p>
  }

  return (
    <div className="space-y-2">
      <RepoSetup
        repo={setup.repo}
        onSave={setup.save}
        picked={picked}
        onPick={setChosen}
        items={items}
        canStart={why === null}
        onStart={() => void start()}
        busy={busy}
        disabled={locked}
      />
      {message ? <p role="alert" className="text-xs text-rose-600">{message}</p> : null}
      {why ? <p className="text-xs text-slate-500">{why}</p> : null}
    </div>
  )
}
