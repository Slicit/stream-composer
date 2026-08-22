interface LiveDotProps {
  live: boolean
  className?: string
  // Overridable for non-stream uses (e.g. "Reachable"/"Unreachable" for
  // a service health row) — defaults to the stream-list wording.
  onLabel?: string
  offLabel?: string
}

// A small dot that eases to green over a second rather than snapping —
// "slowly fade" was explicit in the request, and a slow transition also
// reads as calmer than a blinking indicator for something that's meant
// to be glanced at in a sidebar. The glow is a one-off arbitrary value
// (not a design-system token) since it's a very specific effect for
// exactly this use — see UI_CONVENTIONS.md's exceptions section.
export function LiveDot({ live, className = '', onLabel = 'Live', offLabel = 'Offline' }: LiveDotProps) {
  const label = live ? onLabel : offLabel
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full transition-colors duration-1000 ease-in-out ${
        live ? 'bg-success shadow-[0_0_6px_hsl(var(--success)/0.7)]' : 'bg-muted-foreground/25'
      } ${className}`}
      title={label}
      role="status"
      aria-label={label}
    />
  )
}
