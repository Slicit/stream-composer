# Stream Composer

Point any number of OBS instances at one server and it composes them into a single live programme, automatically laid out, sub-second latency, no GPU required.

## Stack

- Node.js 20+ / Express (server/src), one runtime dependency by design (`express`, plus vendored `hls.js` on the client)
- Vanilla JS/HTML/CSS frontend (`server/public`), no framework, no build step
- MediaMTX for ingest/packaging (RTMP, SRT, WebRTC/WHEP, HLS, RTSP), ffmpeg for compositing and restreaming
- Traefik for TLS termination
- Docker Compose for deployment (multiple overlay files select plain HTTP vs TLS vs local build)
- Storage: one JSON file (`/data/config.json`), no database
- Tests: Node's built-in test runner (`node --test`), no external test framework

## Conventions

- **No em-dashes.** Use commas, parentheses, or middle dots (`·`).
- **Design for the human, not the API.** We're building for end users, not for someone who can read the network tab. If a value is only discoverable by inspecting a JSON response (a UUID, an internal id), the UI must resolve it for them, not hand them a text box and the API's own vocabulary. Concrete case: the restream form used to require pasting a stream's raw UUID by hand, found only by opening devtools; fixed with a searchable name-to-id `Combobox` (`react-app/src/components/ui/combobox.tsx`).
- **Dates: `YYYY-MM-DD`.** Always absolute.
- **File naming:** lowercase, dash-separated.
- **Trunk-based:** work lands on `main` directly; there is currently no long-lived `feat-<slug>` branch workflow. LOGBOOK feature files still track status by content, not by branch, so `branch:` frontmatter may name a topic rather than an actual git branch.
- **Commit style:** short, imperative, present-tense summaries ("Add the Restream tab", "Document restreaming, and capture the tab"), not Conventional Commits prefixes.
- **Docs live beside the code they describe:** `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, `docs/OBS.md`, `docs/PERFORMANCE.md`, `docs/TROUBLESHOOTING.md`. LOGBOOK feature files should link to these rather than duplicate them.
- **Security-sensitive by default:** anything touching the media proxy, auth hooks, or stream/restream credentials needs a `## Decisions` entry explaining the reasoning, per the existing pattern in `docs/ARCHITECTURE.md`'s "Security model" section.
- **Layout engine is pure:** `server/src/layout.js` has no ffmpeg, no I/O. Changes there are validated by property tests in `server/test/layout.test.js`, not manual checks.

## Non-goals

- No database. A stream server holds a handful of users and keys in one JSON file; that is deliberate, not a temporary gap.
- No mixed programme audio. The composed programme is silent by design; this is a product decision, not a missing feature.
- No frontend build pipeline. The admin/viewer UI is vanilla JS/HTML served as-is.

## Reading order for agents

1. This file (`LOGBOOK.md`).
2. `LOGBOOK/notes.md` for codebase patterns, gotchas, anti-patterns.
3. The active feature file matching current work (`LOGBOOK/features/feat-<slug>.md`) if any.
4. `docs/ARCHITECTURE.md` for the system design this project already documents in depth.
5. `LOGBOOK/features/INDEX.md` for the broader picture.

Do not read `LOGBOOK/ideas.md` unless the user explicitly asks; it is the human-owned inbox.

## Writing guidance for agents

- Append to the current feature's `## Decisions` log when making non-trivial choices. Use today's date.
- Propose additions to `notes.md` when you discover a transferable pattern, gotcha, or anti-pattern. Show a diff and wait for confirmation.
- Never edit `LOGBOOK.md` (this file) without showing the proposed change first.
- Never modify `ideas.md` without an explicit user request.
- Surface passing thoughts (deferred work, alternatives considered, out-of-scope items, out-of-band findings) to `LOGBOOK/candidates.md` rather than acting on them or dropping them silently.
- Use `git mv` for renames and archive moves.

## Status

- LOGBOOK adopted: 2026-08-21
- Index regenerated: manual
- Active feature count: see `LOGBOOK/features/INDEX.md`
