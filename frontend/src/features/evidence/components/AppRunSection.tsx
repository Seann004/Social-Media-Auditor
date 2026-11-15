import { motion } from 'framer-motion'
import { PlayIcon as Play } from '@phosphor-icons/react'
import { startAppRun } from '../api'
import { MAX_APP_ITEMS, appRunBlocker, isAppSetupComplete } from '../appState'
import type { PickItem } from '../appState'
import type { AppSetupResponse } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import { useItemRun } from '../useItemRun'
import AppItemPicker from './AppItemPicker'
import AppSetup from './AppSetup'
import DrawerStep, { SetupStep } from './DrawerStep'

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

/** The App branch of the drawer: ② the set-up and ③ the item picker and the Run button. */
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
        <div className="space-y-3">
          {setup.secretKeyConfigured ? <AppItemPicker items={items} picked={picked} onChange={setChosen} limit={MAX_APP_ITEMS} /> : null}
          {message ? <p role="alert" className="text-xs text-rose-600">{message}</p> : null}
          {blocker ? <p className="text-xs text-slate-500">{blocker}</p> : null}
          {!locked ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={() => void run()}
              disabled={blocker !== null || busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={14} weight="fill" aria-hidden="true" />
              Run app check
            </motion.button>
          ) : null}
        </div>
      </DrawerStep>
    </>
  )
}
