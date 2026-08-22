#!/usr/bin/env bash
#
# Upgrades an existing go-rails-react install in place: pulls newer images
# for the same channel and restarts. install-go-rails-react.sh's own
# re-run already does exactly this (it keeps .env — channel, domain,
# secrets); this is a shorter, memorable name for that, matching
# update.sh's relationship to install.sh for the pre-migration app.
#
#   cd /opt/stream-composer-next && ./update-go-rails-react.sh
#
# or, without a local checkout:
#
#   curl -fsSL https://raw.githubusercontent.com/Slicit/stream-composer/migration/go-rails-react/update-go-rails-react.sh | bash
#
# At a real terminal this asks "Review the settings again? [y/N]" —
# Enter (or no reply at all, e.g. piped with no tty attached) takes the
# fast path and keeps everything as-is; "y" walks back through every
# prompt so you can change the domain, rotate the admin password, etc.
# Pass --yes yourself to skip the question outright (e.g. from a cron
# job). To switch channels: ./update-go-rails-react.sh --stable (or
# --beta) — works either way, interactive or not.

set -Eeuo pipefail

script_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$script_dir" ] && [ -f "$script_dir/install-go-rails-react.sh" ]; then
  exec "$script_dir/install-go-rails-react.sh" "$@"
fi

# Piped straight into bash (curl | bash): $0 is "bash", so there is no
# local install-go-rails-react.sh sitting next to this script to exec —
# fetch it and hand off. It reads the existing .env (channel, domain,
# secrets) itself and decides what to ask, if anything; nothing here
# decides that.
REPO="${SC_REPO:-Slicit/stream-composer}"
url="https://raw.githubusercontent.com/$REPO/migration/go-rails-react/install-go-rails-react.sh"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" | bash -s -- "$@"
else
  wget -qO- "$url" | bash -s -- "$@"
fi
