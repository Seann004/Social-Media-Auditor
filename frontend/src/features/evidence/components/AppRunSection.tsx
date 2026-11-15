import { startAppRun } from '../api'
import { MAX_APP_ITEMS, appRunBlocker, isAppSetupComplete } from '../appState'
import type { PickItem } from '../appState'
import type { AppSetupResponse } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import { useItemRun } from '../useItemRun'
import AppItemPicker from './AppItemPicker'
import AppSetup from './AppSetup'
import DrawerStep, { SetupStep } from './DrawerStep'
import RunFooter from './RunFooter'

interface Props {
  projectId: string
  setup: AppSetupResponse
  items: PickItem[]
  evidence: UseEvidenceResult
  locked: boolean
  /** Called after a run was started (or refused as already running), to reload the panel. */
  onStarted(): void | Promise<void>
  /** Reloads the app address and accounts. */
  onSetupSaved(): void | Promise<void>
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The folded line of a complete app set-up: "App · <address> · 2 test accounts ready". */
function AppSummary({ setup }: { setup: AppSetupResponse }) {
  return (
    <>
      App · <span className="break-all font-medium">{setup.app?.appUrl}</span> · {plural(setup.accounts.length, 'test account')} ready
    </>
  )
}

/** The App branch of the drawer: ② the set-up, ③ the item picker, and the action bar with Run. */
export default function AppRunSection({ projectId, setup, items, evidence, locked, onStarted, onSetupSaved }: Props) {
  const { setChosen, picked, busy, message, running, start: run } = useItemRun({
    items,
    run: evidence.run,
    startRun: (ids) => startAppRun(projectId, ids),
    onStarted,
  })
  const blocker = appRunBlocker({
    hasApp: setup.app !== null,
    accountCount: setup.accounts.length,
    picked: picked.size,
    secretKeyConfigured: setup.secretKeyConfigured,
    locked,
    running,
  })
  const complete = isAppSetupComplete(setup)

  return (
    <>
      <SetupStep complete={complete} summary={<AppSummary setup={setup} />}>
        <AppSetup projectId={projectId} setup={setup} onSaved={onSetupSaved} disabled={locked} canWriteAccounts={setup.secretKeyConfigured} />
      </SetupStep>
      <DrawerStep n={3} title="Items and run" state={complete ? 'current' : 'todo'}>
        {setup.secretKeyConfigured ? (
          <AppItemPicker items={items} picked={picked} onChange={setChosen} limit={MAX_APP_ITEMS} />
        ) : (
          <p className="text-xs text-slate-500">Items can be picked once the server is set up for checks inside the app.</p>
        )}
      </DrawerStep>
      <RunFooter
        summary={`${plural(picked.size, 'item')} · ${plural(setup.accounts.length, 'account')} ready`}
        reason={blocker}
        message={message}
        showButton={!locked}
        label="Run app check"
        onRun={() => void run()}
        disabled={blocker !== null || busy}
      />
    </>
  )
}
