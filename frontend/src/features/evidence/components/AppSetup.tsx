import { useState } from 'react'
import { EvidenceApiError, addTestAccount, deleteTestAccount, saveAppSource, updateTestAccount } from '../api'
import type { AppSetupResponse, TestAccountInput, TestAccountView } from '../types'
import TestAccountForm from './TestAccountForm'

interface Props {
  projectId: string
  setup: AppSetupResponse
  onSaved(): void | Promise<void>
  disabled?: boolean
  /** False when the server has no key: accounts can be listed and removed, not added or edited. */
  canWriteAccounts?: boolean
}

const AGE_LABEL = { under_18: 'Under 18', adult: 'Adult' } as const
const FIELD = 'w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50'
const LINK_BUTTON = 'rounded text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'

const lines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
const sentence = (err: unknown): string => (err instanceof EvidenceApiError ? err.message : 'Something went wrong. Try again.')

type Editing = { kind: 'new' } | { kind: 'edit'; account: TestAccountView } | null

/** The app address, login domains and test accounts of a project. */
export default function AppSetup({ projectId, setup, onSaved, disabled = false, canWriteAccounts = true }: Props) {
  const [appUrl, setAppUrl] = useState(setup.app?.appUrl ?? '')
  const [domains, setDomains] = useState((setup.app?.loginDomains ?? []).join('\n'))
  const [sourceError, setSourceError] = useState<string | null>(null)
  /** The address the server saved, shown until either field is edited. */
  const [savedUrl, setSavedUrl] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)

  /** Any edit to the address or the domains clears the "Saved" note: it no longer describes the form. */
  function edit(set: (value: string) => void, value: string): void {
    set(value)
    setSavedUrl(null)
  }

  async function saveSource(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSourceError(null)
    setSavedUrl(null)
    try {
      const { app } = await saveAppSource(projectId, appUrl.trim(), lines(domains))
      await onSaved()
      // Only once all went well, so that "Saved" and an error never show together.
      setSavedUrl(app.appUrl)
    } catch (err) {
      setSourceError(sentence(err))
    }
  }

  async function saveAccount(input: TestAccountInput): Promise<string | null> {
    try {
      if (editing?.kind === 'edit') await updateTestAccount(projectId, editing.account.id, input)
      else await addTestAccount(projectId, input)
    } catch (err) {
      return sentence(err)
    }
    setEditing(null)
    await onSaved()
    return null
  }

  async function remove(account: TestAccountView): Promise<void> {
    setListError(null)
    try {
      await deleteTestAccount(projectId, account.id)
      await onSaved()
    } catch (err) {
      setListError(sentence(err))
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void saveSource(e)} className="space-y-2">
        <div>
          <label htmlFor="app-url" className="mb-1 block text-xs font-medium text-slate-700">App address</label>
          <input id="app-url" value={appUrl} onChange={(e) => edit(setAppUrl, e.target.value)} disabled={disabled} spellCheck={false} className={FIELD} />
        </div>
        <div>
          <label htmlFor="app-login-domains" className="mb-1 block text-xs font-medium text-slate-700">Login domains (one per line)</label>
          <textarea id="app-login-domains" rows={2} value={domains} onChange={(e) => edit(setDomains, e.target.value)} disabled={disabled} spellCheck={false} className={`${FIELD} font-mono text-xs`} />
        </div>
        {sourceError ? <p role="alert" className="text-xs text-rose-600">{sourceError}</p> : null}
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save app address
        </button>
        {savedUrl !== null ? (
          <p role="status" className="text-xs text-slate-700">
            Saved: <span className="break-all font-medium">{savedUrl}</span>
          </p>
        ) : null}
      </form>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-slate-700">Test accounts</h3>
        {setup.accounts.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {setup.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <div>
                  <span className="font-medium text-slate-900">{a.label}</span>
                  <span className="text-slate-500"> · {AGE_LABEL[a.ageGroup]}{a.age !== null ? ` (${a.age})` : ''} · {a.loginName}</span>
                  <span className="block text-slate-500">Password saved</span>
                </div>
                <div className="flex gap-3">
                  {canWriteAccounts ? <button type="button" disabled={disabled} onClick={() => setEditing({ kind: 'edit', account: a })} aria-label={`Edit ${a.label}`} className={LINK_BUTTON}>Edit</button> : null}
                  <button type="button" disabled={disabled} onClick={() => void remove(a)} aria-label={`Remove ${a.label}`} className="rounded text-xs text-rose-600 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">Remove</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No test accounts yet.</p>
        )}
        {listError ? <p role="alert" className="text-xs text-rose-600">{listError}</p> : null}
        {editing ? (
          <TestAccountForm
            key={editing.kind === 'edit' ? editing.account.id : 'new'}
            initial={editing.kind === 'edit' ? editing.account : undefined}
            onSubmit={saveAccount}
            onCancel={() => setEditing(null)}
          />
        ) : canWriteAccounts ? (
          <button type="button" disabled={disabled} onClick={() => setEditing({ kind: 'new' })} className={LINK_BUTTON}>Add test account</button>
        ) : null}
      </div>
    </div>
  )
}
