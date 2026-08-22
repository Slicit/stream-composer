#!/usr/bin/env bash
#
# Stream Composer (Go data plane + Rails control plane + React) installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Slicit/stream-composer/migration/go-rails-react/install-go-rails-react.sh | bash
#
# Unlike install.sh (the pre-migration single-container app), this never
# builds anything: it fetches a handful of small config files and pulls
# pre-built images from GHCR (see .github/workflows/build-go-rails-react-
# images.yml), so a fresh install or an upgrade is seconds of network I/O,
# not a ~10 minute from-source build. Re-running it upgrades in place —
# newer images are pulled, .env is kept.
#
# Non-interactive example:
#   curl -fsSL .../install-go-rails-react.sh | bash -s -- --yes \
#       --domain stream.example.com --email me@example.com \
#       --master-key "$(cat rails-service/config/master.key)"
#
# This stack is still on the migration/go-rails-react branch, so the only
# published channel today is `beta`; --channel/--stable exist so switching
# is a re-run, not a rewrite, once a `stable` channel exists.

set -Eeuo pipefail

REPO="${SC_REPO:-Slicit/stream-composer}"
INSTALL_DIR="${SC_INSTALL_DIR:-/opt/stream-composer-next}"
CHANNEL="${SC_CHANNEL:-beta}" # beta | stable
CHANNEL_EXPLICIT="no"

DOMAIN=""
ACME_EMAIL=""
PUBLIC_HOST=""
ADMIN_USER="admin"
ADMIN_PASSWORD=""
RAILS_MASTER_KEY=""
RTMP_PORT="1935"
ASSUME_YES="no"
MODE="" # tls | local

# ------------------------------------------------------------------ output

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RED=$(printf '\033[31m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); BLUE=$(printf '\033[34m')
  RESET=$(printf '\033[0m')
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s→%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

on_error() {
  local status=$?
  if [ "${BASH_SUBSHELL:-0}" -gt 0 ]; then
    return "$status"
  fi
  printf '\n%s✗ The installer stopped unexpectedly (exit %s at line %s).%s\n' \
    "$RED" "$status" "${BASH_LINENO[0]:-?}" "$RESET" >&2
  printf '  This is a bug. Please report it with the output above:\n  https://github.com/%s/issues\n' \
    "${SC_REPO:-Slicit/stream-composer}" >&2
  exit "$status"
}
trap on_error ERR

banner() {
  printf '\n%s' "$BOLD"
  cat <<'ART'
   ┌─┬─┐  Stream Composer (next)
   ├─┼─┤  Go data plane + Rails + React
   └─┴─┘
ART
  printf '%s\n' "$RESET"
}

# ------------------------------------------------------------------- prompts

TTY="/dev/tty"
have_tty() { [ -e "$TTY" ] && [ -r "$TTY" ]; }

ask() { # ask <variable> <question> <default>
  local __var="$1" question="$2" default="${3:-}" answer=""
  if [ "$ASSUME_YES" = "yes" ] || ! have_tty; then
    printf -v "$__var" '%s' "$default"
    return
  fi
  if [ -n "$default" ]; then
    printf '%s %s[%s]%s ' "$question" "$DIM" "$default" "$RESET" > "$TTY"
  else
    printf '%s ' "$question" > "$TTY"
  fi
  IFS= read -r answer < "$TTY" || true
  printf -v "$__var" '%s' "${answer:-$default}"
}

ask_secret() { # ask_secret <variable> <question>
  local __var="$1" question="$2" answer=""
  if [ "$ASSUME_YES" = "yes" ] || ! have_tty; then
    printf -v "$__var" '%s' ""
    return
  fi
  printf '%s ' "$question" > "$TTY"
  stty -echo < "$TTY" 2>/dev/null || true
  IFS= read -r answer < "$TTY" || true
  stty echo < "$TTY" 2>/dev/null || true
  printf '\n' > "$TTY"
  printf -v "$__var" '%s' "$answer"
}

confirm() { # confirm <question> <default yes|no>
  local question="$1" default="${2:-yes}" answer=""
  if [ "$ASSUME_YES" = "yes" ] || ! have_tty; then
    [ "$default" = "yes" ]
    return
  fi
  local hint="[Y/n]"; [ "$default" = "no" ] && hint="[y/N]"
  printf '%s %s%s%s ' "$question" "$DIM" "$hint" "$RESET" > "$TTY"
  IFS= read -r answer < "$TTY" || true
  answer="${answer:-$default}"
  case "$answer" in [yY]*) return 0 ;; *) return 1 ;; esac
}

# --------------------------------------------------------------- arguments

usage() {
  cat <<EOF
Stream Composer (Go/Rails/React) installer

Usage: install-go-rails-react.sh [options]

  --domain <host>          Public domain; enables HTTPS with Let's Encrypt
  --email <address>        Contact address for the certificate authority
  --public-host <host>     Hostname or IP for OBS and WebRTC (defaults to the domain)
  --admin-user <name>      First administrator account (default: admin)
  --admin-password <pass>  Password for that account (default: randomly generated)
  --master-key <hex>       Rails master key — required, see below
  --rtmp-port <port>       RTMP ingest port (default: 1935)
  --dir <path>             Install directory (default: /opt/stream-composer-next)
  --channel <beta|stable>  Image channel (default: beta — the only one
                            published while this stack lives on the
                            migration/go-rails-react branch)
  --beta                   Shorthand for --channel beta
  --stable                 Shorthand for --channel stable
  --yes                    Accept every default and do not ask anything
  --help                   Show this message

The Rails master key decrypts config/credentials.yml.enc and cannot be
generated — every deployment of this app must use the same one. Get it
from an existing checkout's rails-service/config/master.key, or from
whoever set up the first deployment. It is never guessed, generated, or
fetched automatically; running --yes without --master-key (or an
existing one already in .env) fails on purpose rather than launching a
Rails app that will corrupt its own encrypted config.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --public-host) PUBLIC_HOST="${2:-}"; shift 2 ;;
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --master-key) RAILS_MASTER_KEY="${2:-}"; shift 2 ;;
    --rtmp-port) RTMP_PORT="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; CHANNEL_EXPLICIT="yes"; shift 2 ;;
    --beta) CHANNEL="beta"; CHANNEL_EXPLICIT="yes"; shift ;;
    --stable) CHANNEL="stable"; CHANNEL_EXPLICIT="yes"; shift ;;
    --yes|-y) ASSUME_YES="yes"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
done

case "$CHANNEL" in
  beta|stable) ;;
  *) die "--channel must be 'beta' or 'stable', got '$CHANNEL'." ;;
esac

# ---------------------------------------------------------- prerequisites

need() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
COMPOSE=""

resolve_privileges() {
  local parent
  parent="$(dirname "$INSTALL_DIR")"
  if [ "$(id -u)" -eq 0 ]; then return; fi
  if [ -d "$INSTALL_DIR" ] && [ -w "$INSTALL_DIR" ]; then return; fi
  if [ -w "$parent" ]; then return; fi
  need sudo || die "$INSTALL_DIR is not writable and sudo is unavailable. Re-run as root, or pass --dir <somewhere writable>."
  SUDO="sudo"
  info "Using sudo for $INSTALL_DIR and for Docker"
}

compose_major() { # compose_major <command...>
  local out=""
  out="$("$@" version 2>/dev/null)" || return 0
  printf '%s\n' "$out" | grep -oiE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 | tr -d 'vV' | cut -d. -f1 || return 0
}

resolve_compose() {
  for candidate in "$SUDO docker compose" "$SUDO docker-compose"; do
    # shellcheck disable=SC2086
    local major; major="$(compose_major $candidate)"
    [ -n "$major" ] || continue
    if [ "$major" -ge 2 ] 2>/dev/null; then
      COMPOSE="$candidate"
      return
    fi
  done
  die "Docker Compose v2 is not installed (or not usable with the privileges this installer runs under). Add it with:
    sudo apt-get install -y docker-compose-plugin      # Debian / Ubuntu
    sudo dnf install -y docker-compose-plugin          # Fedora / RHEL
Or see https://docs.docker.com/compose/install/

This stack's compose files use the Compose Specification (no version:
key), which Compose v1 (EOL since 2023) cannot parse — unlike the
pre-migration app, there is no v1 fallback here."
}

check_prereqs() {
  need curl || need wget || die "Neither curl nor wget is available. Install one and try again."

  if ! need docker; then
    die "Docker is not installed. Install it first:  curl -fsSL https://get.docker.com | sh"
  fi
  if ! $SUDO docker info >/dev/null 2>&1; then
    die "Docker is installed but not reachable. Start it (systemctl start docker), or add your user to the docker group and log back in."
  fi
  resolve_compose
  ok "Docker $($SUDO docker version --format '{{.Server.Version}}' 2>/dev/null || echo present) with $(echo "$COMPOSE" | sed 's/^sudo //') is ready"
}

fetch() { # fetch <url> <destination>
  if need curl; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi
}

fetch_stdout() {
  if need curl; then curl -fsSL "$1"; else wget -qO- "$1"; fi
}

random_hex() {
  if need openssl; then openssl rand -hex 32
  elif [ -r /dev/urandom ]; then head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else die "No source of randomness found. Install openssl."
  fi
}

random_password() {
  if need openssl; then openssl rand -base64 18 | tr -d '/+=' | cut -c1-20
  else head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-20
  fi
}

# ------------------------------------------------------------- image tags

# Everything published from a single ref: the compose/config files this
# installer fetches directly, and the images RAILS_TAG/DATAPLANE_TAG
# select, must always come from the same commit — otherwise "beta" could
# mean a docker-compose.yml from one build and images from another.
channel_ref() { [ "$CHANNEL" = "stable" ] && echo "main" || echo "migration/go-rails-react"; }
channel_tag() { [ "$CHANNEL" = "stable" ] && echo "stable" || echo "beta"; }

# ------------------------------------------------------------- download
#
# No source tarball, no build — just the compose files and mediamtx's
# config, individually, from the channel's branch. This is the entire
# reason an install/upgrade is seconds and not minutes: everything else
# (Ruby gems, npm packages, the Go toolchain) already happened in CI.

download_files() {
  local ref base tmp
  ref="$(channel_ref)"
  base="https://raw.githubusercontent.com/$REPO/$ref"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  info "Fetching stack files ($ref)"
  mkdir -p "$tmp/config"
  fetch "$base/docker-compose.go-rails-react.yml" "$tmp/docker-compose.go-rails-react.yml" \
    || die "Could not download docker-compose.go-rails-react.yml from $REPO@$ref."
  fetch "$base/docker-compose.go-rails-react.tls.yml" "$tmp/docker-compose.go-rails-react.tls.yml" \
    || die "Could not download docker-compose.go-rails-react.tls.yml from $REPO@$ref."
  fetch "$base/config/mediamtx.yml" "$tmp/config/mediamtx.yml" \
    || die "Could not download config/mediamtx.yml from $REPO@$ref."
  # Copied alongside .env so a future upgrade can run locally
  # (./update-go-rails-react.sh) instead of piping curl again.
  fetch "$base/install-go-rails-react.sh" "$tmp/install-go-rails-react.sh" || true
  fetch "$base/update-go-rails-react.sh" "$tmp/update-go-rails-react.sh" || true

  $SUDO mkdir -p "$INSTALL_DIR/config"
  $SUDO cp "$tmp/docker-compose.go-rails-react.yml" "$INSTALL_DIR/docker-compose.go-rails-react.yml"
  $SUDO cp "$tmp/docker-compose.go-rails-react.tls.yml" "$INSTALL_DIR/docker-compose.go-rails-react.tls.yml"
  $SUDO cp "$tmp/config/mediamtx.yml" "$INSTALL_DIR/config/mediamtx.yml"
  if [ -s "$tmp/install-go-rails-react.sh" ] && [ -s "$tmp/update-go-rails-react.sh" ]; then
    $SUDO cp "$tmp/install-go-rails-react.sh" "$INSTALL_DIR/install-go-rails-react.sh"
    $SUDO cp "$tmp/update-go-rails-react.sh" "$INSTALL_DIR/update-go-rails-react.sh"
    $SUDO chmod +x "$INSTALL_DIR/install-go-rails-react.sh" "$INSTALL_DIR/update-go-rails-react.sh"
  fi
  ok "Installed files into $INSTALL_DIR"
}

# ------------------------------------------------------------- configure

read_existing() { # read_existing <key>
  [ -f "$INSTALL_DIR/.env" ] || return 0
  $SUDO grep -E "^$1=" "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true
}

configure() {
  local existing_internal existing_token existing_pg existing_key upgrade="no"
  if [ -f "$INSTALL_DIR/.env" ]; then
    upgrade="yes"
    info "An existing configuration was found — keeping your settings."
  fi

  existing_internal="$(read_existing INTERNAL_SECRET)"
  existing_token="$(read_existing INTERNAL_API_TOKEN)"
  existing_pg="$(read_existing POSTGRES_PASSWORD)"
  existing_key="$(read_existing RAILS_MASTER_KEY)"
  INTERNAL_SECRET="${existing_internal:-$(random_hex)}"
  INTERNAL_API_TOKEN="${existing_token:-$(random_hex)}"
  POSTGRES_PASSWORD="${existing_pg:-$(random_hex)}"
  RAILS_MASTER_KEY="${RAILS_MASTER_KEY:-$existing_key}"

  if [ "$upgrade" = "yes" ]; then
    DOMAIN="${DOMAIN:-$(read_existing DOMAIN)}"
    ACME_EMAIL="${ACME_EMAIL:-$(read_existing ACME_EMAIL)}"
    PUBLIC_HOST="${PUBLIC_HOST:-$(read_existing PUBLIC_HOST)}"
    local prev_rtmp; prev_rtmp="$(read_existing RTMP_PORT)"
    [ -n "$prev_rtmp" ] && RTMP_PORT="$prev_rtmp"
    local prev_admin; prev_admin="$(read_existing ADMIN_USER)"
    [ -n "$prev_admin" ] && ADMIN_USER="$prev_admin"
    local prev_channel; prev_channel="$(read_existing CHANNEL)"
    [ -n "$prev_channel" ] && [ "$CHANNEL_EXPLICIT" = "no" ] && CHANNEL="$prev_channel"
    MODE="$([ -n "$DOMAIN" ] && echo tls || echo local)"
    if ! confirm "Review the settings again?" "no"; then
      validate_config
      return
    fi
  fi

  # This stack has no plain-HTTP overlay yet (docker-compose.go-rails-
  # react.yml's own header comment: "this stack's production path assumes
  # Traefik") — unlike the pre-migration app, there is no LAN/behind-your-
  # own-proxy option to offer here without presenting a dead end.
  MODE="tls"
  say ""
  say "${BOLD}Domain (HTTPS is required — Traefik terminates it with a Let's Encrypt certificate)${RESET}"
  while [ -z "$DOMAIN" ]; do
    ask DOMAIN "  Domain name (must already point at this server):" "$DOMAIN"
    [ -n "$DOMAIN" ] || warn "  A domain is required."
    [ "$ASSUME_YES" = "yes" ] && break
  done
  [ -n "$DOMAIN" ] || die "No domain given. Re-run with --domain."
  ask ACME_EMAIL "  Email for certificate notices:" "$ACME_EMAIL"
  [ -n "$ACME_EMAIL" ] || die "Let's Encrypt requires a contact address. Re-run with --email."
  PUBLIC_HOST="${PUBLIC_HOST:-$DOMAIN}"

  ask RTMP_PORT "  RTMP ingest port for OBS:" "$RTMP_PORT"

  say ""
  say "${BOLD}Administrator account${RESET}"
  ask ADMIN_USER "  Username:" "$ADMIN_USER"
  if [ -z "$ADMIN_PASSWORD" ]; then
    local pass1 pass2
    ask_secret pass1 "  Password (leave empty to generate one):"
    if [ -n "$pass1" ]; then
      ask_secret pass2 "  Repeat the password:"
      [ "$pass1" = "$pass2" ] || die "The passwords do not match."
      [ ${#pass1} -ge 8 ] || die "Use at least 8 characters."
      ADMIN_PASSWORD="$pass1"
    else
      ADMIN_PASSWORD="$(random_password)"
      GENERATED_PASSWORD="yes"
    fi
  fi

  say ""
  say "${BOLD}Rails master key${RESET}"
  say "${DIM}  Decrypts config/credentials.yml.enc. Cannot be generated here —"
  say "  every deployment of this app must use the exact same key. Copy it"
  say "  from an existing checkout's rails-service/config/master.key.${RESET}"
  if [ -z "$RAILS_MASTER_KEY" ]; then
    ask_secret RAILS_MASTER_KEY "  Master key:"
  fi

  validate_config
}

# Everything the stack cannot start without, checked in one place rather
# than failing opaquely inside a container later. Missing values are
# re-prompted for interactively; non-interactively (--yes, or piped with
# no tty) a missing value is a hard stop with a specific, actionable
# message — never a silently-incomplete .env.
validate_config() {
  local problems=0

  if [ -z "$RAILS_MASTER_KEY" ]; then
    if [ "$ASSUME_YES" = "yes" ] || ! have_tty; then
      warn "RAILS_MASTER_KEY is not set."
      problems=$((problems + 1))
    else
      say ""
      warn "A Rails master key is required."
      ask_secret RAILS_MASTER_KEY "  Master key (from rails-service/config/master.key):"
      [ -n "$RAILS_MASTER_KEY" ] || problems=$((problems + 1))
    fi
  fi
  if [ -n "$RAILS_MASTER_KEY" ] && ! printf '%s' "$RAILS_MASTER_KEY" | grep -qE '^[0-9a-fA-F]{16,}$'; then
    warn "RAILS_MASTER_KEY does not look like a hex key (expected only 0-9a-f characters). Double-check you copied the whole line from master.key with no extra whitespace."
  fi

  if [ "$MODE" = "tls" ]; then
    [ -n "$DOMAIN" ] || { warn "DOMAIN is required for HTTPS mode."; problems=$((problems + 1)); }
    [ -n "$ACME_EMAIL" ] || { warn "ACME_EMAIL is required for HTTPS mode."; problems=$((problems + 1)); }
  fi
  [ -n "$PUBLIC_HOST" ] || { warn "PUBLIC_HOST is not set — OBS/WebRTC clients need a reachable address."; problems=$((problems + 1)); }
  [ -n "$INTERNAL_SECRET" ] || problems=$((problems + 1))
  [ -n "$INTERNAL_API_TOKEN" ] || problems=$((problems + 1))
  [ -n "$POSTGRES_PASSWORD" ] || problems=$((problems + 1))

  if [ "$problems" -gt 0 ]; then
    die "$problems required setting(s) are still missing (see above). Re-run interactively, or pass them as flags — see --help."
  fi
  ok "Configuration looks complete"
}

write_env() {
  local tag; tag="$(channel_tag)"

  local tmp; tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# Written by install-go-rails-react.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC').
# Re-running the installer keeps these values.

COMPOSE_FILE=docker-compose.go-rails-react.yml:docker-compose.go-rails-react.tls.yml
COMPOSE_PROJECT_NAME=stream-composer

CHANNEL=$CHANNEL
RAILS_IMAGE=ghcr.io/${REPO,,}-rails
RAILS_TAG=$tag
DATAPLANE_IMAGE=ghcr.io/${REPO,,}-dataplane
DATAPLANE_TAG=$tag
MEDIAMTX_VERSION=1.19.1
TRAEFIK_VERSION=v3.7

INTERNAL_SECRET=$INTERNAL_SECRET
INTERNAL_API_TOKEN=$INTERNAL_API_TOKEN
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
RAILS_MASTER_KEY=$RAILS_MASTER_KEY

ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASSWORD

PUBLIC_HOST=$PUBLIC_HOST
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL

RTMP_PORT=$RTMP_PORT
RTMPS_PORT=1936
SRT_PORT=8890
WEBRTC_UDP_PORT=8189

DOCKER_LOG_MAX_SIZE=10m
DOCKER_LOG_MAX_FILES=3

ENCODER=
TZ=$(cat /etc/timezone 2>/dev/null || echo UTC)
EOF

  $SUDO cp "$tmp" "$INSTALL_DIR/.env"
  $SUDO chmod 600 "$INSTALL_DIR/.env"
  rm -f "$tmp"
  ok "Configuration written to $INSTALL_DIR/.env"
}

# Note: REPO is lowercased with a shell parameter expansion (${REPO,,})
# above, which needs bash 4+. Every target this installer supports
# (systemd-based Linux servers) ships bash 4 or newer; documented here
# rather than hedged against, to keep the script readable.

# ------------------------------------------------------------------ launch

launch() {
  cd "$INSTALL_DIR"
  info "Pulling images ($CHANNEL channel)"
  $COMPOSE pull || die "Could not pull images. Check the image names/tags in .env and that ghcr.io is reachable."
  info "Starting the stack"
  if ! $COMPOSE up -d --remove-orphans; then
    die "The stack did not start. Inspect it with:
    cd $INSTALL_DIR && $COMPOSE logs"
  fi
}

unhealthy_containers() {
  $COMPOSE ps --format '{{.Name}} {{.State}}' 2>/dev/null |
    awk '$2 != "running" { print $1 }'
}

diagnose_failure() {
  local down; down="$(unhealthy_containers)"
  if [ -z "$down" ]; then
    warn "Every container is running but the service is not answering yet."
    say "  ${DIM}It may still be starting. Watch it with:"
    say "    cd $INSTALL_DIR && $COMPOSE logs -f${RESET}"
    return
  fi
  warn "These containers are not running: $(echo "$down" | tr '\n' ' ')"
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    say ""
    say "  ${BOLD}${name}${RESET} ${DIM}— last 15 lines${RESET}"
    $COMPOSE logs --tail 15 "${name#sc-}" 2>&1 | sed 's/^/    /' || true
  done <<< "$down"
  say ""
  say "  ${DIM}Full logs: cd $INSTALL_DIR && $COMPOSE logs -f${RESET}"
}

wait_for_health() {
  local url attempts=0
  # Rails' own default health route (config/routes.rb: get "up" =>
  # "rails/health#show") — answering here means migrations ran
  # (ENTRYPOINT does `db:prepare` first) and the master key decrypted
  # correctly, not just that the process is listening.
  url="https://$DOMAIN/up"
  printf '%s→%s Waiting for the service to answer' "$BLUE" "$RESET"
  while [ $attempts -lt 45 ]; do
    if fetch_stdout "$url" >/dev/null 2>&1; then
      printf '\n'; ok "The service is up"
      return 0
    fi
    printf '.'
    sleep 2
    attempts=$((attempts + 1))
  done
  printf '\n'
  diagnose_failure
  return 1
}

summary() {
  local url rtmp
  url="https://$DOMAIN"
  rtmp="rtmp://$PUBLIC_HOST:$RTMP_PORT/live  (or rtmps://$PUBLIC_HOST:1936/live)"

  say ""
  say "${GREEN}${BOLD}Stream Composer (go-rails-react, $CHANNEL) is running.${RESET}"
  say ""
  say "  ${BOLD}Web interface${RESET}   $url"
  say "  ${BOLD}Admin console${RESET}   $url/admin"
  say "  ${BOLD}OBS server URL${RESET}  $rtmp"
  say ""
  say "  ${BOLD}Sign in as${RESET}      $ADMIN_USER"
  if [ "${GENERATED_PASSWORD:-no}" = "yes" ]; then
    say "  ${BOLD}Password${RESET}        $ADMIN_PASSWORD"
    say "  ${DIM}(this was generated for you — store it somewhere safe)${RESET}"
  else
    say "  ${BOLD}Password${RESET}        the one you chose"
  fi
  say ""
  local c="$COMPOSE"
  say "  ${DIM}Manage it with:${RESET}"
  say "    cd $INSTALL_DIR"
  say "    $c ps          ${DIM}# what is running${RESET}"
  say "    $c logs -f     ${DIM}# follow the logs${RESET}"
  say "    $c down        ${DIM}# stop everything${RESET}"
  say ""
  say "  ${DIM}Upgrade any time with: ./update-go-rails-react.sh (pulls newer images, seconds)${RESET}"
  if [ "$MODE" = "tls" ]; then
    say ""
    say "  ${DIM}Certificates are issued automatically on first request; the very first"
    say "  page load can take a few seconds while that happens.${RESET}"
  fi
  say ""
}

# --------------------------------------------------------------------- main

if [ "${SC_LIB_ONLY:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

banner
resolve_privileges
check_prereqs
configure
write_env
download_files
launch
wait_for_health || true
summary
