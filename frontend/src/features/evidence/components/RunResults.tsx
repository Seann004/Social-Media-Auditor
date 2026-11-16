import { ArrowsClockwiseIcon as ArrowsClockwise } from '@phosphor-icons/react'
import type { PickItem } from '../appState'
import type { PageView, RunScope, RunSource, RunView } from '../types'
import { isRunActive } from '../useItemRun'
import { RunProgress, RunSummary } from './RunSummary'

/** Page runs work by category, app runs by checklist item. */
const REASSESS_LABELS: Record<RunSource, { unfinished: string; all: string }> = {
  pages: { unfinished: 'Re-assess unfinished', all: 'Re-assess all categories' },
  app: { unfinished: 'Re-assess unfinished items', all: 'Re-assess all checked items' },
  repo: { unfinished: 'Re-assess from the code', all: 'Re-assess all from the code' },
}

interface Props {
  /** The latest run of any status. */
  run: RunView | null
  pages: PageView[]
  /** The latest completed or partial run. */
  resultRun: RunView | null
  suggestionCount: number
  flaggedCount: number
  items: PickItem[]
  locked: boolean
  canReassess: boolean
  onReassess(scope: RunScope): void
}

/** The top of the drawer: the run in progress, a failure, and the last result with Re-assess. */
export default function RunResults({ run, pages, resultRun, suggestionCount, flaggedCount, items, locked, canReassess, onReassess }: Props) {
  const running = run !== null && isRunActive(run)
  const failure = run && run.status === 'failed' && run.error ? run.error : null
  if (!running && !failure && !resultRun) return null
  // Re-assess acts on the result run, so its labels follow that run's source: app runs work by item.
  const labels = REASSESS_LABELS[resultRun?.source ?? 'pages']

  return (
    <div className="space-y-3">
      {run && running ? <RunProgress run={run} pages={pages} items={items} /> : null}
      {failure ? <p role="alert" className="text-xs text-rose-600">{failure}</p> : null}
      {resultRun ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <RunSummary
            resultRun={resultRun}
            suggestionCount={suggestionCount}
            flaggedCount={flaggedCount}
            pages={pages}
            pagesBelongToResult={run?.id === resultRun.id}
            items={items}
          />
          {!locked ? (
            // The pair wraps at drawer width: the plain button has no side padding so both start on one edge.
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => onReassess('unfinished')}
                disabled={!canReassess}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowsClockwise size={14} aria-hidden="true" />
                {labels.unfinished}
              </button>
              <button
                type="button"
                onClick={() => onReassess('all')}
                disabled={!canReassess}
                className="rounded py-1.5 text-sm text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
              >
                {labels.all}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
