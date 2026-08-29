import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Trash2 } from 'lucide-react'
import type { Channel, Game } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface StreamOption {
  id: string
  name: string
  nickname: string
  visibility: 'private' | 'public'
}

interface UserOption {
  id: string
  username: string
}

export interface ChannelEditFormProps {
  channel: Channel
  streams: StreamOption[]
  games: Game[]
  // Only an admin edit page passes this — reassigning ownership is an
  // admin-only capability (see Api::Admin::ChannelsController#update),
  // never a thing a self-service owner can do to their own channel.
  users?: UserOption[]
  onUpdate: (patch: Record<string, unknown>) => void
  onUploadBackground: (file: File) => void
  uploadingBackground: boolean
  onDelete: () => void
  // Where "cancel"/"back" and the delete redirect should go — /channels
  // for self-service, /admin/channels for admin.
  listPath: string
}

// The full editor for one channel, shared by the self-service page
// (/channels/:id) and the admin page (/admin/channels/:id) so both offer
// the same capabilities — the only difference between them is which data
// they're loaded with and whether `users` (owner reassignment) is passed.
// Text fields save on blur (only when changed), everything else saves
// immediately on change — the same two patterns already used across the
// rest of the admin/self-service pages, just gathered onto one page
// instead of spread across list-row inputs.
export function ChannelEditForm({ channel, streams, games, users, onUpdate, onUploadBackground, uploadingBackground, onDelete, listPath }: ChannelEditFormProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={listPath} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            ← Back
          </Link>
          <Link to={`/c/${channel.slug}`} className="font-mono text-sm text-muted-foreground hover:text-foreground hover:underline">
            /c/{channel.slug}
          </Link>
        </div>
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          Delete channel
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-name">Name</Label>
          <Input
            id="edit-name"
            defaultValue={channel.name}
            onBlur={(e) => {
              if (e.target.value !== channel.name) onUpdate({ name: e.target.value })
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-slug">Slug</Label>
          <Input
            id="edit-slug"
            defaultValue={channel.slug}
            onBlur={(e) => {
              if (e.target.value !== channel.slug) onUpdate({ slug: e.target.value })
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-description">Description</Label>
        <Textarea
          id="edit-description"
          defaultValue={channel.description}
          maxLength={500}
          placeholder="What is this channel about?"
          onBlur={(e) => {
            if (e.target.value !== channel.description) onUpdate({ description: e.target.value })
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-topic">Current topic</Label>
          <Input
            id="edit-topic"
            defaultValue={channel.currentTopic}
            maxLength={255}
            placeholder="What's on right now?"
            onBlur={(e) => {
              if (e.target.value !== channel.currentTopic) onUpdate({ currentTopic: e.target.value })
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-game">Featured game</Label>
          <Combobox
            id="edit-game"
            aria-label="Featured game"
            options={[{ value: '', label: 'None' }, ...games.map((g) => ({ value: g.id, label: g.name }))]}
            value={channel.featuredGameId ?? ''}
            onValueChange={(v) => onUpdate({ featuredGameId: v || null })}
            placeholder="None"
            searchPlaceholder="Search games…"
            emptyText="No games match."
          />
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-6 ${users ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-visibility">Visibility</Label>
          <Select value={channel.visibility} onValueChange={(v) => onUpdate({ visibility: v })}>
            <SelectTrigger id="edit-visibility" aria-label="Visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-layout-mode">Grid layout</Label>
          <Select value={channel.layoutMode ?? 'inherit'} onValueChange={(v) => onUpdate({ layoutMode: v === 'inherit' ? null : v })}>
            <SelectTrigger id="edit-layout-mode" aria-label="Grid layout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Use platform default</SelectItem>
              <SelectItem value="fixed">Fixed (1920x1080)</SelectItem>
              <SelectItem value="maximize">Maximize page space</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {users && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-owner">Owner</Label>
            <Combobox
              id="edit-owner"
              aria-label="Owner"
              options={users.map((u) => ({ value: u.id, label: u.username }))}
              value={channel.ownerId}
              onValueChange={(v) => onUpdate({ ownerId: v })}
              placeholder="Choose an owner"
              searchPlaceholder="Search users…"
              emptyText="No users match."
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Streams in this channel</Label>
        <StreamPicker
          streams={streams}
          selectedIds={channel.streamIds}
          onChange={(streamIds) => onUpdate({ streamIds })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Background image</Label>
        <div className="flex items-center gap-3">
          {channel.backgroundImage && <img src={channel.backgroundImage} alt="" className="h-12 w-20 rounded object-cover" />}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUploadBackground(file)
              e.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" disabled={uploadingBackground} onClick={() => fileInput.current?.click()}>
            {uploadingBackground ? 'Uploading…' : 'Set background image'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function visibilityBadge(visibility: 'private' | 'public') {
  return (
    <Badge variant={visibility === 'public' ? 'default' : 'secondary'} className="shrink-0">
      {visibility}
    </Badge>
  )
}

// A searchable, visibility-filterable add-picker plus the resulting member
// list, each row badged with its own visibility — replaces a flat wrap of
// toggle-badges that was fine for a handful of streams but unworkable once
// a streamer has dozens to choose from (nothing to search or filter by).
function StreamPicker({
  streams,
  selectedIds,
  onChange,
}: {
  streams: StreamOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'private' | 'public'>('all')

  const selected = streams.filter((s) => selectedIds.includes(s.id))
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return streams.filter((s) => {
      if (selectedIds.includes(s.id)) return false
      if (visibilityFilter !== 'all' && s.visibility !== visibilityFilter) return false
      if (q && !(s.nickname || s.name).toLowerCase().includes(q)) return false
      return true
    })
  }, [streams, selectedIds, visibilityFilter, query])

  function add(id: string) {
    onChange([...selectedIds, id])
    setQuery('')
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id))
  }

  return (
    <div className="flex flex-col gap-3">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label="Add a stream"
            className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm text-muted-foreground shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring sm:w-80"
          >
            Add a stream…
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="flex items-center gap-2 border-b p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search streams…"
              aria-label="Search streams"
              className="flex h-8 flex-1 rounded-sm bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Select value={visibilityFilter} onValueChange={(v) => setVisibilityFilter(v as typeof visibilityFilter)}>
              <SelectTrigger aria-label="Filter by visibility" className="h-8 w-[6.5rem] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {candidates.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                {streams.length === 0 ? 'No streams available to add yet.' : 'No streams match.'}
              </p>
            ) : (
              candidates.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add(s.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm py-1.5 pl-2 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                >
                  <span className="truncate">{s.nickname || s.name}</span>
                  {visibilityBadge(s.visibility)}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">No streams added yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {selected.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm">{s.nickname || s.name}</span>
              <div className="flex items-center gap-2">
                {visibilityBadge(s.visibility)}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(s.id)}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Remove {s.nickname || s.name}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
