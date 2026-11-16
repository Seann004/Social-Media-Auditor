import type { EvidenceApiError } from '../api'
import type { EvidencePermission } from '../types'
import DrawerStep from './DrawerStep'
import PermissionControl from './PermissionControl'
import RunFooter from './RunFooter'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

interface Props {
  text: string
  onText(value: string): void
  /** Links in the box now, for the action bar. */
  linkCount: number
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

/** The Public pages branch of the drawer (hidden unless PUBLIC_PAGES_ENABLED): links, permission, and the action bar. */
export default function PagesSection(props: Props) {
  const { text, onText, linkCount, locked, state, error, onRetry, hasSavedLinks, canStart, onRun, showPermission, permission, onSavePermission } = props
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
      <RunFooter
        summary={`${plural(linkCount, 'link')} to read`}
        reason={locked ? 'This audit is locked, so no runs can start.' : null}
        showButton={!locked}
        label="Run assessment"
        onRun={onRun}
        disabled={!canStart}
      />
    </>
  )
}
