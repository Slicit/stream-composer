import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import type { Channel, Game } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface StreamOption {
  id: string
  name: string
  nickname: string
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
        <div className="flex flex-wrap gap-2">
          {streams.map((s) => {
            const included = channel.streamIds.includes(s.id)
            return (
              <Badge
                key={s.id}
                variant={included ? 'default' : 'outline'}
                className="cursor-pointer select-none"
                onClick={() =>
                  onUpdate({ streamIds: included ? channel.streamIds.filter((id) => id !== s.id) : [...channel.streamIds, s.id] })
                }
              >
                {s.nickname || s.name}
              </Badge>
            )
          })}
          {streams.length === 0 && <p className="text-sm text-muted-foreground">No streams available to add yet.</p>}
        </div>
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
