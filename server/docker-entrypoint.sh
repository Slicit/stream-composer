#!/bin/sh
# Named volumes are created owned by root. Fix ownership once, then drop
# privileges so the service never runs as root.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR/logs"
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"
