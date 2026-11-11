import { useEffect, useState, type RefObject } from 'react'

/**
 * True once the element is within `margin` of the viewport; stays true after that.
 * Without IntersectionObserver (old browsers, tests) it is true at once, so nothing is lost.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = '200px'): boolean {
  const supported = typeof IntersectionObserver !== 'undefined'
  const [near, setNear] = useState(!supported)

  useEffect(() => {
    const element = ref.current
    if (near || !element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, near, margin])

  return near
}
