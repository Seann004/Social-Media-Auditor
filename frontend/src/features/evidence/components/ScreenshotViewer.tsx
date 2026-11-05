import { XIcon as X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { getScreenshotUrl } from '../api'
import { isHttpUrl } from '../safeUrl'
import type { ScreenshotKind } from '../types'
import { useModal } from './useModal'

interface Props {
  kind: ScreenshotKind
  id: string
  label: string
  onClose: () => void
}

type Loaded = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed'; message: string }

/** Full-size screenshot. The signed link is fetched when it opens and never cached: links expire in minutes. */
export default function ScreenshotViewer({ kind, id, label, onClose }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const root = useRef<HTMLDivElement>(null)
  const onKeyDown = useModal(root, onClose)

  useEffect(() => {
    let alive = true
    getScreenshotUrl(kind, id)
      .then((url) => {
        if (!alive) return
        setLoaded(isHttpUrl(url) ? { state: 'ready', url } : { state: 'failed', message: 'The screenshot link was not valid.' })
      })
      .catch((err: unknown) => {
        if (alive) setLoaded({ state: 'failed', message: err instanceof Error ? err.message : 'The screenshot could not be loaded.' })
      })
    return () => {
      alive = false
    }
  }, [kind, id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-full w-full max-w-4xl overflow-auto rounded-xl bg-white p-3 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close screenshot"
          className="absolute right-3 top-3 rounded-lg bg-white/90 p-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
        {loaded.state === 'loading' && <p className="p-8 text-center text-sm text-slate-500">Loading screenshot…</p>}
        {loaded.state === 'failed' && (
          <p role="alert" className="p-8 text-center text-sm text-rose-600">
            {loaded.message}
          </p>
        )}
        {loaded.state === 'ready' && <img src={loaded.url} alt={label} className="mx-auto h-auto max-w-full rounded-lg" />}
      </div>
    </div>
  )
}
