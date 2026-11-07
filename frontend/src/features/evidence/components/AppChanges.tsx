import type { AppChangeView } from '../types'

const rowText = (c: AppChangeView): string =>
  `${c.accountLabel}: "${c.control}" on ${c.pageUrl} is ${c.after} (was ${c.before}). ${c.restoreDetail ?? ''}`.trim()

function ChangeList({ title, rows }: { title: string; rows: AppChangeView[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className="text-xs font-medium text-slate-700">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-600">
        {rows.map((row) => (
          <li key={row.id}>{rowText(row)}</li>
        ))}
      </ul>
    </div>
  )
}

/** Settings an app run changed: those left changed, and those put back. */
export default function AppChanges({ changes }: { changes: AppChangeView[] }) {
  return (
    <div className="space-y-2">
      <ChangeList title="Left changed" rows={changes.filter((c) => !c.restored)} />
      <ChangeList title="Put back" rows={changes.filter((c) => c.restored)} />
    </div>
  )
}
