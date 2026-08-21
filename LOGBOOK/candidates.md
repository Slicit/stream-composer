<!--
Agent-surfaced candidates awaiting human triage. See LOGBOOK spec v0.3 §12.

Entries are added automatically when a trigger fires (deferred, alternative,
out-of-scope, out-of-band). Append-only; the only allowed removal is human
triage (promote to ideas.md, or drop).
-->

# Candidates

## 2026-08-21

- On-demand audio transcode, starting only when a viewer subscribes to a source's audio and tearing down after an idle period, instead of always-on per live source. Would need the WHEP proxy to nudge the transcoder on request and poll MediaMTX reader counts to know when to stop. (trigger: alternative, source: feat-audio-monitor-opus decision 2026-08-21, agent: claude-code)
- Admin UI has no visibility into the audio relay's health (status/restarts/last error), unlike the Restream tab's per-destination status. Would need a small addition to admin.js and a status surface in audioRelay.js. (trigger: out-of-scope, source: feat-audio-monitor-opus, agent: claude-code)
- audioRelay.js transcodes to Opus unconditionally, even for a hypothetical source whose audio already arrives as Opus (no such ingest path exists today, everything is OBS/AAC). Skipping the transcode when the source codec already matches would save CPU if that ever changes. (trigger: deferred, source: feat-audio-monitor-opus, agent: claude-code)
