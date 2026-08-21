#!/usr/bin/env bash
#
# Update an existing Stream Composer install in place.
#
#   cd /opt/stream-composer && ./update.sh
#
# install.sh already does this — re-running it detects an existing .env,
# keeps every secret and setting, redownloads the release bundle (compose
# files, config, scripts, docs) and restarts. That upgrade path is correct;
# it is just not obvious that the *installer* is also the *updater*. This
# is that command, spelled the way an operator would look for it, with no
# reconfiguration prompts.
#
# Anything passed to this script is forwarded to install.sh, so a specific
# version can still be requested:
#   ./update.sh --version v1.3.0

set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f install.sh ]; then
  echo "install.sh not found next to update.sh — run this from the install directory." >&2
  exit 1
fi

exec ./install.sh --yes "$@"
