import type { AuditStatus, ChecklistItemStatus, SubmissionStatus } from '../types'

export interface StatusColor {
  hex: string
  dot: string
  badge: string
  label: string
}

export const AUDIT_STATUS_COLOR: Record<AuditStatus, StatusColor> = {
  draft: {
    hex: '#94a3b8',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600',
    label: 'Draft',
  },
  in_progress: {
    hex: '#3b82f6',
    dot: 'bg-blue-500',
    badge: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    label: 'In Progress',
  },
  under_review: {
    hex: '#f59e0b',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    label: 'Under Review',
  },
  completed: {
    hex: '#10b981',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    label: 'Completed',
  },
}

export const CHECKLIST_STATUS_COLOR: Record<ChecklistItemStatus, StatusColor> = {
  not_started: {
    hex: '#94a3b8',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-500',
    label: 'Not Started',
  },
  compliant: {
    hex: '#10b981',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    label: 'Compliant',
  },
  non_compliant: {
    hex: '#f43f5e',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    label: 'Non-Compliant',
  },
  partially: {
    hex: '#6366f1',
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    label: 'Partially Compliant',
  },
  not_applicable: {
    hex: '#94a3b8',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-500',
    label: 'N/A',
  },
  needs_review: {
    hex: '#f59e0b',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    label: 'Needs Review',
  },
}

export const SUBMISSION_STATUS_COLOR: Record<SubmissionStatus, StatusColor> = {
  not_submitted: {
    hex: '#94a3b8',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-500',
    label: 'Not Submitted',
  },
  pending_review: {
    hex: '#f59e0b',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    label: 'Pending Review',
  },
  approved: {
    hex: '#10b981',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    label: 'Approved',
  },
  rejected: {
    hex: '#f43f5e',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    label: 'Rejected',
  },
}

export function statusColor(kind: 'audit', status: AuditStatus): StatusColor
export function statusColor(kind: 'checklist', status: ChecklistItemStatus): StatusColor
export function statusColor(kind: 'submission', status: SubmissionStatus): StatusColor
export function statusColor(kind: 'audit' | 'checklist' | 'submission', status: string): StatusColor {
  if (kind === 'audit') return AUDIT_STATUS_COLOR[status as AuditStatus]
  if (kind === 'checklist') return CHECKLIST_STATUS_COLOR[status as ChecklistItemStatus]
  return SUBMISSION_STATUS_COLOR[status as SubmissionStatus]
}
