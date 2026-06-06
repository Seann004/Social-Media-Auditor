import type { ChecklistItemStatus, AuditStatus } from '../../../types'

const CHECKLIST: Record<ChecklistItemStatus, { label: string; cls: string }> = {
  not_started: { label: 'Not Started', cls: 'bg-slate-100 text-slate-500' },
  compliant: { label: 'Compliant', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  non_compliant: { label: 'Non-Compliant', cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  partially: { label: 'Partially', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  not_applicable: { label: 'N/A', cls: 'bg-slate-100 text-slate-500' },
  needs_review: { label: 'Needs Review', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
}

const AUDIT: Record<AuditStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  completed: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  under_review: { label: 'Under Review', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
}

type Props =
  | { type: 'checklist'; status: ChecklistItemStatus }
  | { type: 'audit'; status: AuditStatus }

export default function StatusBadge({ type, status }: Props) {
  const cfg = type === 'checklist' ? CHECKLIST[status as ChecklistItemStatus] : AUDIT[status as AuditStatus]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}