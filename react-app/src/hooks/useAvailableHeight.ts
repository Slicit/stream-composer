import { useEffect, useState, type RefObject } from 'react'

// Matches <main>'s own bottom padding (py-6 → 24px) so a "maximize"-mode
// stage fills exactly down to that padding, not past it.
const BOTTOM_MARGIN = 24
const MIN_HEIGHT = 200

// How much viewport height is left below `ref`'s own top edge — the
// budget a "maximize" layout mode packs into. Measured against the real
// DOM (not a hardcoded navbar/padding guess) so it stays correct however
// tall the page's own header content ends up being, and recomputed on
// resize since that budget changes with the window.
export function useAvailableHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setHeight(null)
      return
    }
    function measure() {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      setHeight(Math.max(window.innerHeight - top - BOTTOM_MARGIN, MIN_HEIGHT))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ref, enabled])

  return height
}
