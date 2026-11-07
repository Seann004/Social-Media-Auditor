import { useState } from 'react'
import { motion } from 'framer-motion'
import { PlayIcon as Play } from '@phosphor-icons/react'
import { EvidenceApiError, startAppRun } from '../api'
import { appRunBlocker } from '../appState'
import type { PickItem } from '../appState'
import type { AppSetupResponse, RunView } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import AppItemPicker from './AppItemPicker'
import AppSetup from './AppSetup'

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

const ACTIVE: RunView['status'][] = ['queued', 'capturing', 'assessing']

/** The App branch of the evidence panel: setup, item picker and the Run button. */
export default function AppRunSection({ projectId, setup, items, evidence, locked, onStarted, onSetupSaved }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const running = evidence.run !== null && ACTIVE.includes(evidence.run.status)
  const blocker = appRunBlocker({
    hasApp: setup.app !== null,
    accountCount: setup.accounts.length,
    picked: picked.size,
    secretKeyConfigured: setup.secretKeyConfigured,
    locked,
    running,
  })

  async function run(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      await startAppRun(projectId, [...picked])
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

  return (
    <div className="space-y-4">
      {setup.secretKeyConfigured ? (
        <>
          <AppSetup projectId={projectId} setup={setup} onSaved={onSetupSaved} disabled={locked} />
          <AppItemPicker items={items} picked={picked} onChange={setPicked} />
        </>
      ) : null}
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
  )
}
