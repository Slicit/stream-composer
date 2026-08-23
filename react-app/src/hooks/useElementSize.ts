import { useCallback, useEffect, useState } from 'react'

// A callback ref (not a plain useRef) is required here, not just tidier:
// a plain ref + a mount-only effect only gets one chance to attach. If
// this element is inside a conditionally-rendered branch (e.g. behind
// `state.channel &&`) and doesn't exist yet on first render, the effect
// finds nothing to observe and never gets another chance once the real
// element later mounts, since nothing in a `[enabled]`-only dependency
// list would tell it to retry. A callback ref re-fires on every real
// attach, so the observer effect (keyed on the element itself) always
// gets a chance to (re)attach when that happens.
export function useElementSize<T extends HTMLElement>(enabled = true): [(node: T | null) => void, { width: number; height: number } | null] {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const ref = useCallback((node: T | null) => setEl(node), [])

  useEffect(() => {
    if (!enabled || !el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      // Bail out on an unchanged size rather than always creating a new
      // object — CSS driven by this size (e.g. an aspect-ratio box) can
      // itself cause a follow-up resize notification with the same
      // dimensions; without this, that would loop into an extra render
      // every time instead of settling immediately.
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, el])

  return [ref, size]
}
