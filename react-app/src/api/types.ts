// Mirrors the JSON shapes rails-service actually serializes (see each
// model's as_public_json). Kept in one file, field-for-field, so a drift
// between the two is easy to spot in review.

export type Role = 'admin' | 'viewer' | 'streamer'

export interface User {
  id: string
  username: string
  role: Role
  streamQuota: number
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
  createdAt: string
}

// GET /api/games — the featured-game picker's option list.
export interface Game {
  id: string
  name: string
}

// The streamer self-service relay picker's source list — GET /api/relays/mine.
export interface RelaySource {
  id: string
  name: string
  enabled: boolean
}

// GET /api/streams/available — the pool a user may build a channel from.
export interface AvailableStream {
  id: string
  name: string
  nickname: string
  visibility: 'private' | 'public'
}
