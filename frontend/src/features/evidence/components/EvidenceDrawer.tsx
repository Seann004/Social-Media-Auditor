import { useEffect, useId, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { RobotIcon as Robot, XIcon as X } from '@phosphor-icons/react'
import { SUGGESTIONS_NOTE } from '../barStatus'

/** DESIGN.md §11: the expand/collapse spring, and a plain fade for the backdrop. */
const SLIDE = { type: 'spring', stiffness: 200, damping: 28 } as const
const FADE = { duration: 0.2 } as const
const INSTANT = { duration: 0 } as const

interface Props {
  id: string
  open: boolean
  onClose(): void
  /** The dialog element: focus moves here on open. */
  panelRef: RefObject<HTMLDivElement>
  children: ReactNode
}

/**
 * A slide-over from the right. Non-modal: from the lg breakpoint up there is no backdrop and the
 * page behind stays usable; below it a backdrop covers the page and closes the drawer on a click.
 * It stays mounted while closed (hidden and out of the accessibility tree), so the hooks and the
 * picked items inside it live on between openings.
 */
export default function EvidenceDrawer({ id, open, onClose, panelRef, children }: Props) {
  const reduce = useReducedMotion() ?? false
  const titleId = useId()
  // Visible from the moment it opens until the slide-out has ended.
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true })
  }, [open, panelRef])

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="backdrop"
            data-drawer-backdrop=""
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? INSTANT : FADE}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden print:hidden"
          />
        ) : null}
      </AnimatePresence>
      <motion.div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-hidden={open ? undefined : true}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        initial={false}
        animate={{ x: open ? 0 : '100%' }}
        transition={reduce ? INSTANT : SLIDE}
        onAnimationComplete={() => {
          if (!open) setShown(false)
        }}
        style={{ visibility: shown ? 'visible' : 'hidden' }}
        className="fixed inset-y-0 right-0 z-40 flex w-[92vw] max-w-[640px] flex-col border-l border-slate-200 bg-white shadow-2xl focus:outline-none lg:w-[440px] print:hidden"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Robot size={18} className="shrink-0 text-blue-600" aria-hidden="true" />
              <h2 id={titleId} className="text-sm font-semibold text-slate-900">AI evidence assessment</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">{SUGGESTIONS_NOTE}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI evidence"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-6 px-5 pb-5 pt-5">{children}</div>
        </div>
      </motion.div>
    </>
  )
}
