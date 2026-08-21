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

## 2026-08-22

- Admin's own "Add a channel" form (admin.html panel-channels) has no stream picker, unlike /channels' owner-facing form — an admin-created channel starts empty and needs a follow-up PATCH to add streams. Would need the same checkbox-list pattern channels.js (client) already has. (trigger: out-of-scope, source: feat-channels, agent: claude-code)
- Private-channel access is owner + admin + explicitly shared users only — there is no "shared with anyone who has the link" tier. If that turns out to be wanted, it needs a third visibility state, not just true/false. (trigger: out-of-scope, source: feat-channels decision 2026-08-21, agent: claude-code)
- No channel-level HLS fallback: a channel with a source that can't play over WebRTC still falls back to HLS per-tile (unchanged from today's web mode), but there is no way to view a whole channel over HLS the way the classic server-composed programme can. Channels are browser-composed only, so this may not be fixable without contradicting that choice. (trigger: out-of-scope, source: feat-channels decision 2026-08-21, agent: claude-code)
- server/test/api.test.js's call() helper always overwrites any explicit `headers.cookie` with the module-level admin session cookie, silently running the request as admin instead of whoever the test intended. Cost two failing tests before being caught (see callAs() added alongside it). Worth a comment on call() itself warning the next person, or renaming the confusing behavior. (trigger: out-of-band, source: feat-channels test-writing, agent: claude-code)
- Pattern worth writing to notes.md once confirmed: when adding per-resource access control (visibility/sharedWith) to an existing endpoint, check for pre-existing blanket guards stacked in front of it — the v1.3.0 channels feature shipped with exactly this bug (auth.requireViewAccessApi 401'd anonymous requests to *public* streams before resolvePlayback's new per-stream check ever ran), caught only because a user hit it minutes after release. Every proxy test used the signed-in admin session by default, so nothing exercised "anonymous + public resource" until then. (trigger: out-of-band, source: feat-channels post-ship fix 2026-08-22, agent: claude-code)
