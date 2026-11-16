import { LockSimpleIcon as LockSimple } from '@phosphor-icons/react'
import type { TestAccountView } from '../types'

const AGE_LABEL = { under_18: 'Under 18', adult: 'Adult' } as const
/** Under-18 accounts are the ones the checks are about: they get the brand tint, adults stay neutral. */
const TONE = {
  under_18: 'bg-blue-50 text-blue-700 ring-blue-200',
  adult: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const
const LINK_BUTTON = 'rounded text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'

interface Props {
  account: TestAccountView
  disabled: boolean
  /** False when the server has no key: the account can be removed, not edited. */
  canEdit: boolean
  onEdit(): void
  onRemove(): void
}

/** One saved test account. The password is never shown: only that one is saved. */
export default function AccountRow({ account, disabled, canEdit, onEdit, onRemove }: Props) {
  const initial = account.label.trim().charAt(0).toUpperCase() || '?'
  const age = `${AGE_LABEL[account.ageGroup]}${account.age !== null ? ` (${account.age})` : ''}`
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${TONE[account.ageGroup]}`}>
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate text-sm font-medium text-slate-900">{account.label}</span>
          <span className={`shrink-0 rounded-full px-2 py-px text-2xs font-medium tabular-nums ring-1 ${TONE[account.ageGroup]}`}>{age}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate text-xs text-slate-500">{account.loginName}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-px text-2xs text-slate-600">
            <LockSimple size={10} weight="bold" aria-hidden="true" />
            Password saved
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-3">
        {canEdit ? (
          <button type="button" disabled={disabled} onClick={onEdit} aria-label={`Edit ${account.label}`} className={LINK_BUTTON}>
            Edit
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove ${account.label}`}
          className="rounded text-xs text-rose-600 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </li>
  )
}
