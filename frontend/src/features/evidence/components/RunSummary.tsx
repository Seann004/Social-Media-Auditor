import { SpinnerIcon as Spinner } from '@phosphor-icons/react'
import { isHttpUrl } from '../safeUrl'
import type { PageView, RunStatus, RunView } from '../types'

const STATUS_LABEL: Partial<Record<RunStatus, string>> = {
  queued: 'Queued',
  capturing: 'Capturing pages',
  assessing: 'Assessing categories',
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatWhen(run: RunView): string | null {
  const date = new Date(run.finishedAt ?? run.startedAt ?? run.createdAt)
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date)
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function PageLink({ url }: { url: string }) {
  if (!isHttpUrl(url)) return <span className="break-all text-slate-700">{url}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all rounded text-blue-600 underline-offset-2 hover:text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {url}
    </a>
  )
}

function ProblemPages({ pages }: { pages: PageView[] }) {
  const problems = pages.filter((p) => p.accessStatus !== 'ok')
  if (problems.length === 0) return null
  return (
    <div>
      <p className="text-xs font-medium text-slate-700">{plural(problems.length, 'page')} could not be read</p>
      <ul className="mt-1 space-y-1 text-xs">
        {problems.map((p) => (
          <li key={p.id}>
            <PageLink url={p.url} />
            {p.accessDetail ? <span className="block text-slate-500">{p.accessDetail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Live progress of the latest run while it is queued, capturing or assessing. */
export function RunProgress({ run, pages }: { run: RunView; pages: PageView[] }) {
  const failed = pages.filter((p) => p.accessStatus !== 'ok').length
  return (
    <div aria-live="polite" className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <Spinner size={14} className="animate-spin text-blue-600" aria-hidden="true" />
        {STATUS_LABEL[run.status] ?? run.status}
      </p>
      <p className="text-xs text-slate-600">
        Pages captured: {run.pagesDone} of {run.pagesTotal}
        {failed > 0 ? `, ${failed} failed` : ''}
      </p>
      <p className="text-xs text-slate-600">Categories assessed: {run.categoriesDone} of {run.categoriesTotal}</p>
      <ProblemPages pages={pages} />
    </div>
  )
}

interface SummaryProps {
  resultRun: RunView
  suggestionCount: number
  flaggedCount: number
  /** Pages of the latest run; listed only when the latest run is the result run. */
  pages: PageView[]
  pagesBelongToResult: boolean
}

/** What the last finished run produced. Always about the result run, never the latest. */
export function RunSummary({ resultRun, suggestionCount, flaggedCount, pages, pagesBelongToResult }: SummaryProps) {
  const when = formatWhen(resultRun)
  return (
    <section aria-label="Last run" className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Last run</h3>
      <p className="text-xs text-slate-600">
        {when ? <time dateTime={resultRun.finishedAt ?? resultRun.createdAt}>{when}</time> : null}
        {when ? ' · ' : ''}
        {plural(resultRun.pagesTotal, 'page')} · {plural(suggestionCount, 'suggestion')} · {flaggedCount} flagged
      </p>
      {resultRun.error ? <p className="text-xs text-amber-700">{resultRun.error}</p> : null}
      {resultRun.unassessedCategories.length > 0 ? (
        <p className="text-xs text-slate-600">Not assessed: {resultRun.unassessedCategories.join(', ')}</p>
      ) : null}
      {pagesBelongToResult ? <ProblemPages pages={pages} /> : null}
    </section>
  )
}
