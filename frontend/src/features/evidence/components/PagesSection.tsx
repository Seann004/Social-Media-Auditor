import { motion } from 'framer-motion'
import { PlayIcon as Play } from '@phosphor-icons/react'
import type { EvidenceApiError } from '../api'
import type { EvidencePermission } from '../types'
import DrawerStep from './DrawerStep'
import PermissionControl from './PermissionControl'

interface Props {
  text: string
  onText(value: string): void
  locked: boolean
  state: 'loading' | 'ok' | 'error'
  error: EvidenceApiError | null
  onRetry(): void
  /** Links are saved: the set-up step counts as done. */
  hasSavedLinks: boolean
  canStart: boolean
  onRun(): void
  /** Head Auditor only, once the sources have loaded. */
  showPermission: boolean
  permission: EvidencePermission | null
  onSavePermission(granted: boolean, note: string | undefined): Promise<string | null>
}

/** The Public pages branch of the drawer (hidden unless PUBLIC_PAGES_ENABLED): links, permission, Run. */
export default function PagesSection(props: Props) {
  const { text, onText, locked, state, error, onRetry, hasSavedLinks, canStart, onRun, showPermission, permission, onSavePermission } = props
  return (
    <>
      <DrawerStep n={2} title="Set up" state={hasSavedLinks ? 'done' : 'current'}>
        <div className="space-y-4">
          {state === 'loading' ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : state === 'error' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="text-xs text-rose-600">{error?.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Try again
              </button>
            </div>
          ) : (
            <div>
              <label htmlFor="evidence-links" className="mb-1 block text-xs font-medium text-slate-700">
                Website links (one per line)
              </label>
              <textarea
                id="evidence-links"
                value={text}
                onChange={(e) => onText(e.target.value)}
                disabled={locked}
                rows={3}
                spellCheck={false}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
              />
            </div>
          )}
          {showPermission ? <PermissionControl permission={permission} onSave={onSavePermission} /> : null}
        </div>
      </DrawerStep>
      <DrawerStep n={3} title="Run" state={hasSavedLinks ? 'current' : 'todo'}>
        {!locked ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={onRun}
            disabled={!canStart}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={14} weight="fill" aria-hidden="true" />
            Run assessment
          </motion.button>
        ) : (
          <p className="text-xs text-slate-500">This audit is locked, so no runs can start.</p>
        )}
      </DrawerStep>
    </>
  )
}
