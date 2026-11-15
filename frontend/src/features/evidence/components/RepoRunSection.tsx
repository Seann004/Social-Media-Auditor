import { startRepoRun } from '../api'
import type { PickItem } from '../appState'
import type { UseEvidenceResult } from '../useEvidence'
import { useItemRun } from '../useItemRun'
import type { UseRepoSetupResult } from '../useRepoSetup'
import RepoSetup, { REPO_ITEM_LIMIT } from './RepoSetup'

interface Props {
  projectId: string
  /** The saved repository, loaded by the panel while this source is chosen. */
  setup: UseRepoSetupResult
  items: PickItem[]
  evidence: UseEvidenceResult
  locked: boolean
  /** Called after a run was started (or refused as already running), to reload the panel. */
  onStarted(): void | Promise<void>
}

function blocker(input: { hasRepo: boolean; picked: number; locked: boolean; running: boolean }): string | null {
  if (input.locked) return 'This audit is locked, so no runs can start.'
  if (input.running) return 'A run is already in progress.'
  if (!input.hasRepo) return 'Save the repository address first.'
  if (input.picked === 0) return 'Pick at least one item.'
  return null
}

/** The Code repository branch of the evidence panel. */
export default function RepoRunSection({ projectId, setup, items, evidence, locked, onStarted }: Props) {
  const { setChosen, pickedIds, picked, busy, message, running, start } = useItemRun({
    items,
    run: evidence.run,
    startRun: (ids) => startRepoRun(projectId, ids.slice(0, REPO_ITEM_LIMIT)),
    onStarted,
  })
  const why = blocker({ hasRepo: setup.repo !== null, picked: pickedIds.length, locked, running })

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
