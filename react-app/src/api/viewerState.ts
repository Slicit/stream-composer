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
}

export interface ViewerState {
  settings: { publicViewing: boolean }
  program: { mode: string; ready: boolean; width: number; height: number; gapPx: number }
  layout: ViewerLayout | null
  onAir: OnAirEntry[]
  streams: ViewerStreamEntry[]
  serverTime: string
}
