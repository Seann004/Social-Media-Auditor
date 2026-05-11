import type { Severity } from '../../types'

const CONFIG: Record<Severity, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  major: { label: 'Major', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  minor: { label: 'Minor', cls: 'bg-slate-100 text-slate-600' },
}

export default function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, cls } = CONFIG[severity]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}