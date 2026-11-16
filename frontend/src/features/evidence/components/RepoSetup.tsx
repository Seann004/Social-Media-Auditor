import { useState } from 'react'
import type { RepoSourceView } from '../types'

interface Props {
  repo: RepoSourceView | null
  /** Resolves to the server's refusal sentence, or null when saved. */
  onSave(input: { repoUrl: string; branch: string | null }): Promise<string | null>
  disabled?: boolean
}

export const REPO_ITEM_LIMIT = 10
const FIELD = 'w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50'

/** The repository address and branch, and the saved address. */
export default function RepoSetup({ repo, onSave, disabled = false }: Props) {
  const [repoUrl, setRepoUrl] = useState(repo?.repoUrl ?? '')
  const [branch, setBranch] = useState(repo?.branch ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      setError(await onSave({ repoUrl: repoUrl.trim(), branch: branch.trim() === '' ? null : branch.trim() }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <div>
          <label htmlFor="repo-url" className="mb-1 block text-xs font-medium text-slate-700">Repository address</label>
          <input id="repo-url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/name" aria-describedby={error ? 'repo-error repo-hint' : 'repo-hint'} aria-invalid={error ? true : undefined} disabled={disabled} spellCheck={false} className={FIELD} />
          <p id="repo-hint" className="mt-1 text-xs text-slate-500">Only public GitHub repositories. The code is read, never run.</p>
        </div>
        <div>
          <label htmlFor="repo-branch" className="mb-1 block text-xs font-medium text-slate-700">Branch (optional)</label>
          <input id="repo-branch" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={disabled} spellCheck={false} className={FIELD} />
        </div>
        {error ? <p id="repo-error" role="alert" className="text-xs text-rose-600">{error}</p> : null}
        <button
          type="submit"
          disabled={disabled || saving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save repository
        </button>
      </form>

      {repo ? (
        <p className="text-xs text-slate-700">
          Saved: <span className="break-all font-medium">{repo.repoUrl}</span>
          {repo.branch ? <span className="text-slate-500"> · branch {repo.branch}</span> : null}
        </p>
      ) : null}
    </div>
  )
}
