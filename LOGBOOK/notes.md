<!--
Codebase learnings: patterns, anti-patterns, gotchas, glossary.

Rules:
  · Agents may propose additions; user confirms before merging.
  · Each entry should be transferable (useful for the next person who
    touches the area), not feature-specific.
  · Cite a concrete file path or commit when relevant.
  · No em-dashes.
-->

# Notes

## Patterns

<!-- Conventions and approaches that have proven useful in this codebase. -->

## Anti-patterns

<!-- Things that have caused bugs, regressions, or maintenance pain. Avoid these. -->

## Gotchas

<!-- Surprising behavior in dependencies, frameworks, or our own code. -->

- `scmig-rails` and `scmig-react` (`docker-compose.migration.yml`,
  `Dockerfile.dev` for each) have no bind-mounted source directory — a
  plain `COPY . .` at build time. Syncing a source change to the box does
  nothing to the running container until it's actually rebuilt
  (`docker compose build <service> && docker compose up -d <service>`).
  A `docker restart` isn't enough either, and can leave a stale
  `server.pid` that boot-loops the container. First caught when a new
  `data-testid` synced to the box had no effect on a running Playwright
  spec until the react image was rebuilt (source: feat-e2e-playwright-mailpit,
  2026-08-29, agent: claude-code).

- `docker compose` does not propagate the invoking shell's arbitrary env
  vars into a container — only explicit interpolation in the compose
  file's `environment:` block does (e.g. `CI: ${CI:-}`). Setting `env:`
  on a CI workflow step only affects the process running `docker compose`
  itself, never the container it starts. Bit the e2e CI job: `RAILS_ENV`
  fallback keys gated on `ENV["CI"].present?` inside the Rails app never
  saw `CI=true` even though the GitHub Actions runner had it, because
  nothing in `docker-compose.migration.yml` forwarded it into the `rails`
  service (source: feat-e2e-playwright-mailpit, 2026-08-30, agent: claude-code).

## Glossary

<!-- Project-specific terms an outside reader would not know. -->
