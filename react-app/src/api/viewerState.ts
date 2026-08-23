// Mirrors the JSON shape go-service/internal/viewerstate.State actually
// serializes (GET /api/state, served by the Go data plane, not Rails —
// see types.ts's own doc comment for that side of the API).

export interface ViewerCell {
  x: number
  y: number
  w: number
  h: number
}

export interface ViewerLayout {
  name: string
  cols: number
  rows: number
  cells: ViewerCell[]
  width: number
  height: number
}

export interface OnAirEntry {
  key: string | null
  name: string
}

export interface PlayabilityProblem {
  code: string
  summary: string
  fix: string
}

export interface ViewerStreamEntry {
  key: string
  name: string
  live: boolean
  hasAudio: boolean
  problem: PlayabilityProblem | null
  path: string | null
  audioPath: string | null
  // True for a channel member the current viewer cannot reach — path and
  // audioPath are both null in that case (channel-scoped state only; the
  // global GET /api/state never sets this).
  restricted: boolean
}

export interface ChannelInfo {
  name: string
  slug: string
  backgroundImage: string
  description: string
  currentTopic: string
  // The resolved game name, or "" when none is set — the data plane only
  // ever hands back a plain string here; the id/game-catalog relationship
  // is a Rails-side concern (see api/types.ts's Channel for the editable
  // featuredGameId/featuredGameName pair used by the admin/mine forms).
  featuredGame: string
}

export interface ViewerState {
  settings: { publicViewing: boolean; homepageChannelSlug: string }
  program: { mode: string; ready: boolean; width: number; height: number; gapPx: number }
  layout: ViewerLayout | null
  onAir: OnAirEntry[]
  streams: ViewerStreamEntry[]
  serverTime: string
  // Present only on a channel-scoped state (GET /api/channels/:slug/state).
  channel?: ChannelInfo
}
