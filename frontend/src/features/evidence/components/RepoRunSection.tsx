import { startRepoRun } from '../api'
import type { PickItem } from '../appState'
import type { ItemKindView, RepoSourceView } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import { useItemRun } from '../useItemRun'
import type { UseRepoSetupResult } from '../useRepoSetup'
import AppItemPicker from './AppItemPicker'
import DrawerStep, { SetupStep } from './DrawerStep'
import RepoSetup, { REPO_ITEM_LIMIT } from './RepoSetup'
import RunFooter from './RunFooter'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

interface Props {
  projectId: string
  /** The saved repository, loaded by the panel while this source is chosen. */
  setup: UseRepoSetupResult
  items: PickItem[]
  evidence: UseEvidenceResult
  locked: boolean
  /** Called after a run was started (or refused as already running), to reload the panel. */
  onStarted(): void | Promise<void>
  /** The AI's high-confidence kind of each item, for the picker's chips. */
  kinds?: ReadonlyMap<string, ItemKindView>
}

export function repoRunBlocker(input: { hasRepo: boolean; picked: number; locked: boolean; running: boolean }): string | null {
  if (input.locked) return 'This audit is locked, so no runs can start.'
  if (input.running) return 'A run is already in progress.'
  if (!input.hasRepo) return 'Save the repository address first.'
  if (input.picked === 0) return 'Pick at least one item.'
  return null
}

/** The folded line of a saved repository: "Code repository · <address> · branch dev". */
function RepoSummary({ repo }: { repo: RepoSourceView }) {
  return (
    <>
      Code repository · <span className="break-all font-medium">{repo.repoUrl}</span> · {repo.branch ? `branch ${repo.branch}` : 'default branch'}
    </>
  )
}

/** The Code repository branch of the drawer: ② the repository, ③ the item picker, and the action bar. */
export default function RepoRunSection({ projectId, setup, items, evidence, locked, onStarted, kinds }: Props) {
  const { setChosen, pickedIds, picked, busy, message, running, start } = useItemRun({
    items,
    run: evidence.run,
    startRun: (ids) => startRepoRun(projectId, ids.slice(0, REPO_ITEM_LIMIT)),
    onStarted,
  })
  const why = repoRunBlocker({ hasRepo: setup.repo !== null, picked: pickedIds.length, locked, running })

  if (setup.state !== 'ok') {
    return (
      <DrawerStep n={2} title="Set up" state="current">
        {setup.state === 'loading' ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <p role="alert" className="text-xs text-rose-600">The saved repository could not be loaded. Choose another source and come back to try again.</p>
        )}
      </DrawerStep>
    )
  }

  return (
    <>
      <SetupStep complete={setup.repo !== null} summary={setup.repo ? <RepoSummary repo={setup.repo} /> : null}>
        <RepoSetup repo={setup.repo} onSave={setup.save} disabled={locked} />
      </SetupStep>
      <DrawerStep n={3} title="Items and run" state={setup.repo ? 'current' : 'todo'}>
        <AppItemPicker items={items} picked={picked} onChange={setChosen} limit={REPO_ITEM_LIMIT} verb="repository" source="repo" kinds={kinds} />
      </DrawerStep>
      <RunFooter
        summary={`${plural(pickedIds.length, 'item')} · ${setup.repo ? 'repository saved' : 'no repository saved'}`}
        reason={why}
        message={message}
        showButton={!locked}
        label="Check the code"
        onRun={() => void start()}
        disabled={why !== null || busy}
      />
    </>
  )
}
