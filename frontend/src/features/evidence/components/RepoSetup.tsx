import { useState } from 'react'
import { motion } from 'framer-motion'
import { PlayIcon as Play } from '@phosphor-icons/react'
import type { PickItem } from '../appState'
import type { RepoSourceView } from '../types'
import AppItemPicker from './AppItemPicker'

interface Props {
  repo: RepoSourceView | null
  /** Resolves to the server's refusal sentence, or null when saved. */
  onSave(input: { repoUrl: string; branch: string | null }): Promise<string | null>
  picked: ReadonlySet<string>
  onPick(next: Set<string>): void
  items: PickItem[]
  canStart: boolean
  onStart(): void
  busy: boolean
  disabled?: boolean
}

export const REPO_ITEM_LIMIT = 10
const FIELD = 'w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50'

/** The repository address and branch, the item picker and the "Check the code" button. */
export default function RepoSetup({ repo, onSave, picked, onPick, items, canStart, onStart, busy, disabled = false }: Props) {
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
    <div className="space-y-4">
      <form onSubmit={(e) => void submit(e)} className="space-y-2">
        <div>
          <label htmlFor="repo-url" className="mb-1 block text-xs font-medium text-slate-700">Repository address</label>
          <input id="repo-url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/name" aria-describedby={error ? 'repo-error repo-hint' : 'repo-hint'} aria-invalid={error ? true : undefined} disabled={disabled} spellCheck={false} className={FIELD} />
        </div>
        <div>
          <label htmlFor="repo-branch" className="mb-1 block text-xs font-medium text-slate-700">Branch (optional)</label>
          <input id="repo-branch" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={disabled} spellCheck={false} className={FIELD} />
        </div>
        {error ? <p id="repo-error" role="alert" className="text-xs text-rose-600">{error}</p> : null}
        <button
          type="submit"
          disabled={disabled || saving}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save repository
        </button>
        <p id="repo-hint" className="text-xs text-slate-500">Only public GitHub repositories. The code is read, never run.</p>
      </form>

      {repo ? (
        <p className="text-xs text-slate-700">
          Saved: <span className="break-all font-medium">{repo.repoUrl}</span>
          {repo.branch ? <span className="text-slate-500"> · branch {repo.branch}</span> : null}
        </p>
      ) : null}

      <AppItemPicker items={items} picked={picked} onChange={onPick} limit={REPO_ITEM_LIMIT} verb="repository" />

      {!disabled ? (
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={onStart}
          disabled={!canStart || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={14} weight="fill" aria-hidden="true" />
          Check the code
        </motion.button>
      ) : null}
    </div>
  )
}
