import { useState } from 'react'
import type { EvidencePermission } from '../types'

interface Props {
  permission: EvidencePermission | null
  /** Resolves to an error sentence, or null when saved. */
  onSave(granted: boolean, note: string | undefined): Promise<string | null>
}

/** Head Auditor only: records that the platform gave permission to read its pages. */
export default function PermissionControl({ permission, onSave }: Props) {
  const savedGranted = permission?.granted ?? false
  const savedNote = permission?.note ?? ''
  const [granted, setGranted] = useState(savedGranted)
  const [note, setNote] = useState(savedNote)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const unchanged = granted === savedGranted && note.trim() === savedNote.trim()

  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    setProblem(null)
    try {
      const failure = await onSave(granted, note.trim() === '' ? undefined : note.trim())
      if (failure !== null) {
        setProblem(failure)
        setGranted(savedGranted)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4 space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          checked={granted}
          onChange={(e) => setGranted(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
        />
        The platform gave permission to read its pages
      </label>
      <p className="text-xs text-slate-500 max-w-[65ch]">
        When ticked, robots.txt is no longer respected for this project because the platform gave permission.
      </p>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="evidence-permission-note" className="block text-xs text-slate-500 mb-1">Permission note</label>
          <input
            id="evidence-permission-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || unchanged}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Save permission
        </button>
      </div>
      {problem ? <p role="alert" className="text-xs text-rose-600">{problem}</p> : null}
    </div>
  )
}
