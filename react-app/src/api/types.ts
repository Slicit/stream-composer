// Mirrors the JSON shapes rails-service actually serializes (see each
// model's as_public_json). Kept in one file, field-for-field, so a drift
// between the two is easy to spot in review.

export type Role = 'admin' | 'viewer' | 'streamer'

// Keep in sync with rails-service/app/models/user.rb's User::THEMES, and
// with the [data-theme] blocks in index.css.
export const THEMES = ['studio', 'legacy', 'aurora', 'onair'] as const
export type Theme = (typeof THEMES)[number]

export interface User {
  id: string
  username: string
  role: Role
  email: string | null
  emailConfirmed: boolean
  otpEnabled: boolean
  otpBackupCodesRemaining: number
  theme: Theme | null
  streamQuota: number
  compositorQuota: number
  avatar: string | null
  createdAt: string
  lastLoginAt: string | null
}

export interface Stream {
  id: string
  name: string
  nickname: string
  key: string
  playbackId: string
  enabled: boolean
  note: string
  visibility: 'private' | 'public'
  ownerId: string | null
  sharedWith: string[]
  createdAt: string
}

export interface RelayProvider {
  id: string
  label: string
  url: string
  urlLabel: string
  urlHint: string
  keyLabel: string
  keyHint: string
}

export interface RelayDestination {
  id: string
  streamId: string
  sourceName: string | null
  sourceMissing: boolean
  provider: string
  providerLabel: string
  name: string
  url: string
  keyMasked: string
  hasKey: boolean
  audio: 'copy' | 'aac'
  enabled: boolean
  createdAt: string
}

export type LayoutMode = 'fixed' | 'maximize'

export interface Channel {
  id: string
  name: string
  slug: string
  visibility: 'private' | 'public'
  ownerId: string
  backgroundImage: string | null
  streamIds: string[]
  sharedWith: string[]
  description: string
  currentTopic: string
  featuredGameId: string | null
  featuredGameName: string | null
  // null = inherit AppSettings.defaultLayoutMode — see LayoutMode.
  layoutMode: LayoutMode | null
  createdAt: string
}

// GET /api/games — the featured-game picker's option list.
export interface Game {
  id: string
  name: string
}

// GET/PATCH /api/admin/settings.
export interface AppSettings {
  defaultLayoutMode: LayoutMode
  publicViewing: boolean
}

// The streamer self-service relay picker's source list — GET /api/relays/mine.
export interface RelaySource {
  id: string
  name: string
  enabled: boolean
}

export type Orientation = 'horizontal' | 'vertical'

// A channel's composed-output relay destination — same shape as
// RelayDestination, minus streamId/sourceName/audio (there is no raw
// source to point at or transcode audio for; it forwards a channel's
// already-composed program instead). Providers are the same RelayProvider
// list shape, just a different set of rows.
export interface ChannelCompositionDestination {
  id: string
  channelCompositionId: string
  provider: string
  providerLabel: string
  name: string
  url: string
  keyMasked: string
  hasKey: boolean
  enabled: boolean
  createdAt: string
}

// GET/PATCH /api/channels/mine/:id/compositions — one row per orientation,
// always both present (lazily created server-side).
export interface ChannelComposition {
  id: string
  channelId: string
  orientation: Orientation
  enabled: boolean
  width: number
  height: number
  fps: number
  bitrateKbps: number
  preset: string
  encoder: 'auto' | 'software' | 'vaapi' | 'qsv'
  backgroundColor: string
  labels: boolean
  labelSize: number
  // Authorizes GET /mtx/hls/c/:channelId/:orientation/*.m3u8?token=... —
  // a URL that works pasted straight into VLC, unrelated to (and no more
  // privileged than) any session. Present regardless of `enabled`, but
  // only actually resolves anything once the composition is both enabled
  // and live.
  previewToken: string
  destinations: ChannelCompositionDestination[]
  createdAt: string
}

// GET /api/streams/available — the pool a user may build a channel from.
export interface AvailableStream {
  id: string
  name: string
  nickname: string
  visibility: 'private' | 'public'
}
