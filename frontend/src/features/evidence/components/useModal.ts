import { useEffect, type KeyboardEvent, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The elements Tab visits: a radio group is a single stop (its checked radio, else its first). */
function tabStops(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.name === '') return true
    const group = all.filter((o): o is HTMLInputElement => o instanceof HTMLInputElement && o.type === 'radio' && o.name === el.name)
    const checked = group.find((o) => o.checked)
    return (checked ?? group[0]) === el
  })
}

/** The tab stop that represents the focused element (a radio stands for its whole group). */
function stopOf(active: Element | null, stops: HTMLElement[]): Element | null {
  if (active instanceof HTMLInputElement && active.type === 'radio' && !stops.includes(active)) {
    return stops.find((s) => s instanceof HTMLInputElement && s.type === 'radio' && s.name === active.name) ?? active
  }
  return active
}

/**
 * Focus handling for a modal: focus moves in on mount and returns to where it was on unmount.
 * The returned handler closes on Escape and keeps Tab inside the container.
 */
export function useModal(container: RefObject<HTMLElement | null>, onClose: () => void): (event: KeyboardEvent) => void {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = container.current
    const first = root?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? root)?.focus()
    return () => previous?.focus()
  }, [container])

  return (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !container.current) return
    const items = tabStops(container.current)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = stopOf(document.activeElement, items)
    if (event.shiftKey && (active === first || !container.current.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !container.current.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }
}
