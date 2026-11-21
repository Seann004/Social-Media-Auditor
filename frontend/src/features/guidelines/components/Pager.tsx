import { CaretLeftIcon as CaretLeft, CaretRightIcon as CaretRight } from '@phosphor-icons/react'

export const PAGE_SIZES = [10, 25, 50] as const

/** The page numbers to offer: the first, the last, the current one and its neighbours, with a gap where numbers are skipped. */
export function pageNumbers(current: number, count: number): (number | 'gap')[] {
  const wanted = new Set([0, count - 1, current - 1, current, current + 1])
  const sorted = Array.from(wanted).filter((n) => n >= 0 && n < count).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('gap')
    out.push(n)
  })
  return out
}

interface Props {
  /** The page shown, counting from 0. */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  /** Names the table for screen readers, such as "High confidence". */
  label: string
}

const buttonClass = 'min-w-[2rem] h-8 px-2 rounded-md border text-xs font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40 disabled:cursor-not-allowed'

/** Paging under a table: what is shown, previous and next, page numbers and how many rows a page holds. */
export default function Pager({ page, pageSize, total, onPage, onPageSize, label }: Props) {
  const count = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)

  return (
    <nav aria-label={`${label} pages`} className="flex items-center gap-3 flex-wrap px-1 pt-3">
      <p className="text-xs text-slate-500" aria-live="polite">Showing {from}–{to} of {total}</p>
      <div className="flex items-center gap-1 ml-auto">
        <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)} className={`${buttonClass} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}>
          <CaretLeft size={12} weight="bold" className="mx-auto" />
        </button>
        {pageNumbers(page, count).map((n, i) => n === 'gap'
          ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-xs text-slate-400">…</span>
          : (
            <button
              key={n}
              type="button"
              aria-label={`Page ${n + 1}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
              className={`${buttonClass} ${n === page ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {n + 1}
            </button>
          ))}
        <button type="button" aria-label="Next page" disabled={page >= count - 1} onClick={() => onPage(page + 1)} className={`${buttonClass} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}>
          <CaretRight size={12} weight="bold" className="mx-auto" />
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        Rows per page
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          aria-label={`Rows per page in ${label}`}
          className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  )
}
