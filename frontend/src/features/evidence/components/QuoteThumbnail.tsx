import { useEffect, useRef, useState } from 'react'
import { getScreenshotUrl } from '../api'
import { isHttpUrl } from '../safeUrl'
import ScreenshotViewer from './ScreenshotViewer'
import { useNearViewport } from './useNearViewport'

/** A small picture of a quote's page, fetched only when it is near the viewport. A failure leaves a plain placeholder. */
export default function QuoteThumbnail({ quoteId }: { quoteId: string }) {
  const holder = useRef<HTMLSpanElement>(null)
  const near = useNearViewport(holder)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!near) return
    let alive = true
    getScreenshotUrl('quote', quoteId)
      .then((link) => {
        if (!alive) return
        if (isHttpUrl(link)) setUrl(link)
        else setFailed(true)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [near, quoteId])

  return (
    <span ref={holder} className="inline-block">
      <button
        type="button"
        aria-label="Enlarge screenshot"
        onClick={() => setOpen(true)}
        className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {url ? (
          <img
            src={url}
            alt="Screenshot of the quoted passage"
            onError={() => {
              setUrl(null)
              setFailed(true)
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="px-2 text-center text-[11px] text-slate-400">{failed ? 'Preview unavailable' : 'Loading…'}</span>
        )}
      </button>
      {open && <ScreenshotViewer kind="quote" id={quoteId} label="Screenshot of the quoted passage" onClose={() => setOpen(false)} />}
    </span>
  )
}
