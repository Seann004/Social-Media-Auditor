import { useState } from 'react'
import type { AgeGroup, TestAccountInput, TestAccountView } from '../types'

interface Props {
  initial?: TestAccountView
  /** Resolves to an error sentence to show, or null when saved. */
  onSubmit(input: TestAccountInput): Promise<string | null>
  onCancel(): void
}

const FIELD = 'w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
const LABEL = 'mb-1 block text-xs font-medium text-slate-700'

const lines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')

/** Add or edit one test account. The password is write-only: never filled in, cleared after saving. */
export default function TestAccountForm({ initial, onSubmit, onCancel }: Props) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(initial?.ageGroup ?? 'under_18')
  const [age, setAge] = useState(initial?.age == null ? '' : String(initial.age))
  const [loginName, setLoginName] = useState(initial?.loginName ?? '')
  const [password, setPassword] = useState('')
  const [handles, setHandles] = useState((initial?.handles ?? []).join('\n'))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!initial && password === '') {
      setError('Enter a password for the new account.')
      return
    }
    setSaving(true)
    setError(null)
    const parsedAge = age.trim() === '' ? null : Number(age)
    const result = await onSubmit({
      label: label.trim(),
      ageGroup,
      age: parsedAge !== null && Number.isFinite(parsedAge) ? parsedAge : null,
      loginName: loginName.trim(),
      password,
      handles: lines(handles),
    })
    setSaving(false)
    if (result === null) setPassword('')
    else setError(result)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {/* Sized for the drawer: only the two short age fields share a line. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label htmlFor="acct-label" className={LABEL}>Account name</label>
          <input id="acct-label" value={label} onChange={(e) => setLabel(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="acct-group" className={LABEL}>Age group</label>
          <select id="acct-group" value={ageGroup} onChange={(e) => setAgeGroup(e.target.value as AgeGroup)} className={FIELD}>
            <option value="under_18">Under 18</option>
            <option value="adult">Adult</option>
          </select>
        </div>
        <div>
          <label htmlFor="acct-age" className={LABEL}>Age (optional)</label>
          <input id="acct-age" type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} className={FIELD} />
        </div>
        <div className="col-span-2">
          <label htmlFor="acct-login" className={LABEL}>Login name</label>
          <input id="acct-login" value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="off" className={FIELD} />
        </div>
        <div className="col-span-2">
          <label htmlFor="acct-password" className={LABEL}>Password</label>
          <input
            id="acct-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial ? 'Leave blank to keep the saved password' : undefined}
            className={FIELD}
          />
        </div>
        <div className="col-span-2">
          <label htmlFor="acct-handles" className={LABEL}>Display handles (one per line)</label>
          <textarea id="acct-handles" rows={2} value={handles} onChange={(e) => setHandles(e.target.value)} spellCheck={false} className={`${FIELD} font-mono text-xs`} />
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          Save account
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
          Cancel
        </button>
      </div>
    </form>
  )
}
