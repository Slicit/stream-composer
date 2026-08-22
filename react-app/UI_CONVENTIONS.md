# UI conventions

Short, binding rules for this app's UI. Follow these for any new screen or
component; migrate old code you touch anyway, but don't go out of your way
to churn unrelated files just to satisfy a rule below.

## Icon-only actions

A control whose action is commonly recognized by its icon (delete/trash,
refresh, copy, etc.) is icon-only — no text label. Use a `lucide-react`
icon inside a `<Button variant="outline" size="icon">`, with:
- a `title` attribute (hover tooltip, since this app has no Tooltip
  primitive), and
- a `<span className="sr-only">…</span>` carrying the same text, for
  screen readers.

```tsx
<Button variant="outline" size="icon" onClick={remove} title="Delete">
  <Trash2 className="h-4 w-4" />
  <span className="sr-only">Delete</span>
</Button>
```

Actions that aren't universally recognized by shape alone (e.g. "Set as
homepage", "Sign out") keep a text label.

## Toggles

Any on/off setting (enabled/disabled, a single-channel "is this the
homepage" flag, etc.) renders as shadcn's `Switch`
(`@/components/ui/switch`), not a checkbox, a pill-button-wrapping-a-Badge,
or a two-item `Select`. Always pair it with `aria-label` since it has no
visible text of its own:

```tsx
<Switch checked={s.enabled} onCheckedChange={() => toggle(s)} aria-label={`Enabled for ${s.name}`} />
```

A choice between more than two named options (e.g. `private`/`public`
visibility, which is a mode, not strictly an on/off flag) stays a
`Select` — this rule is specifically about binary on/off state.

## API keys

A key is shown as a readonly, masked `Textarea` (`abcd****` — first 4
characters plus a fixed run of asterisks, 8 characters total, just enough
to identify it at a glance) with a copy icon-button inside it, and a
separate rotate icon-button immediately to its right. Never render the
real key value outside the copy handler's clipboard write — see
`@/components/KeyField`, the shared component for this; use it rather
than re-implementing key display.

## Buttons

Every `Button` uses `variant="outline"` (bordered) — this app does not use
the solid `default`, borderless `ghost`, or `secondary` variants. A
button's selected/active state (e.g. the audio picker's current source) is
expressed with extra `className`, not by switching to `default` — see
`@/components/AudioPicker` for the pattern:

```tsx
<Button
  variant="outline"
  className={active ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : ''}
  onClick={...}
>
```

`destructive`-toned actions (delete) stay `variant="outline"` too, with
`className="text-destructive hover:text-destructive"` for color — not
`variant="destructive"`, which is a solid fill.

## Exceptions (custom styling outside the design system)

Stepping outside shadcn/the token palette is fine when it's justified —
document why, inline, at the point of use:

- **`PlayerOverlay`** (the video control bar) — sits on arbitrary video
  content, needs a translucent/blurred surface the solid-HSL tokens don't
  provide. See that file's own comment.
- **`ViewerTile`'s stream-name label** — literal, specified values
  (`font-size`/`line-height: 2.5vw`, `color: #1a8900`, bold), not a
  design-system color or scale step. Kept as an inline `style`, not a
  Tailwind token, so it stays visibly a one-off rather than looking like
  a reusable pattern.
