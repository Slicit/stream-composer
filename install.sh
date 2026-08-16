#!/usr/bin/env bash
#
# Stream Composer installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Slicit/stream-composer/main/install.sh | bash
#
# Fetches the latest release, asks a handful of questions, writes .env and
# starts the stack. Re-running it upgrades in place and keeps your answers.
#
# Non-interactive example:
#   curl -fsSL .../install.sh | bash -s -- --yes \
#       --domain stream.example.com --email me@example.com --admin-password 'sekrit'

set -euo pipefail

# `set -e` aborts without a word if any command fails somewhere unguarded. For
# an installer that is the worst possible failure mode — the user sees the
# banner, then their prompt back. Turn it into something reportable.
trap 'status=$?; [ "$status" -eq 0 ] && exit 0; printf "\n\033[31m✗ The installer stopped unexpectedly (exit %s at line %s).\033[0m\n  This is a bug. Please report it with the output above:\n  https://github.com/%s/issues\n" "$status" "${BASH_LINENO[0]:-?}" "${SC_REPO:-Slicit/stream-composer}" >&2' ERR

REPO="${SC_REPO:-Slicit/stream-composer}"
INSTALL_DIR="${SC_INSTALL_DIR:-/opt/stream-composer}"
VERSION="${SC_VERSION:-latest}"

DOMAIN=""
ACME_EMAIL=""
PUBLIC_HOST=""
ADMIN_USER="admin"
ADMIN_PASSWORD=""
HTTP_PORT="8080"
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

banner() {
  printf '\n%s' "$BOLD"
  cat <<'ART'
   ┌─┬─┐  Stream Composer
   ├─┼─┤  many streams in, one grid out
   └─┴─┘
ART
  printf '%s\n' "$RESET"
}

# ------------------------------------------------------------------- prompts
# When this script is piped into bash, stdin is the script itself, so all
# interactive reads must come from the terminal directly.

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
Stream Composer installer

Usage: install.sh [options]

  --domain <host>          Public domain; enables HTTPS with Let's Encrypt
  --email <address>        Contact address for the certificate authority
  --public-host <host>     Hostname or IP for OBS and WebRTC (defaults to the domain)
  --admin-user <name>      First administrator account (default: admin)
  --admin-password <pass>  Password for that account (default: randomly generated)
  --http-port <port>       Port for plain-HTTP installs (default: 8080)
  --rtmp-port <port>       RTMP ingest port (default: 1935)
  --dir <path>             Install directory (default: /opt/stream-composer)
  --version <tag>          Release to install (default: latest)
  --yes                    Accept every default and do not ask anything
  --help                   Show this message
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --public-host) PUBLIC_HOST="${2:-}"; shift 2 ;;
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --rtmp-port) RTMP_PORT="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --yes|-y) ASSUME_YES="yes"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
done

# ---------------------------------------------------------- prerequisites

need() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
COMPOSE=""
COMPOSE_KIND="" # v2 = Compose Specification files; v1 = generated fallback

# Everything that touches the install directory or Docker runs through the same
# privilege as the eventual `compose up`, so a tool that exists for one user but
# not the other is caught here rather than half-way through the install.
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

# Resolve Compose *as the user that will actually run it*.
#
# Two traps this avoids:
#
#  1. The v2 plugin is often installed per-user under ~/.docker/cli-plugins/, so
#     `docker compose` can work for you and not for root. Checking it
#     unprivileged and then running it with sudo is how you end up with docker
#     printing its own help and "unknown shorthand flag: 'd' in -d".
#  2. Compose v1 (the standalone Python `docker-compose`, EOL since July 2023)
#     cannot read the canonical files: they follow the Compose Specification,
#     with no `version:` key and a top-level `name:`, and v1 reads a
#     version-less file as the 2015 schema where every top-level key is a
#     service name. There is a generated fallback for exactly that case
#     (docker-compose.v1*.yml), so v1 is supported rather than refused — we
#     just have to know which set of files to point it at.

# Prints the major version, or nothing. Must never return non-zero: this runs
# inside a command substitution, and under `set -e` with `pipefail` a failing
# pipeline there kills the whole installer with no output at all — which is
# exactly what "docker compose is not installed" used to do.
compose_major() { # compose_major <command...>
  local out=""
  out="$("$@" version 2>/dev/null)" || return 0
  printf '%s\n' "$out" | grep -oiE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -1 | tr -d 'vV' | cut -d. -f1 || return 0
}

resolve_compose() {
  local found_v1="" found_unprivileged=""

  for candidate in "$SUDO docker compose" "$SUDO docker-compose"; do
    # shellcheck disable=SC2086
    local major; major="$(compose_major $candidate)"
    [ -n "$major" ] || continue
    if [ "$major" -ge 2 ] 2>/dev/null; then
      COMPOSE="$candidate"
      COMPOSE_KIND="v2"
      return
    fi
    found_v1="$candidate"
  done

  # No v2 anywhere, but a working v1: use the generated fallback files.
  if [ -n "$found_v1" ]; then
    COMPOSE="$found_v1"
    COMPOSE_KIND="v1"
    warn "Only Compose v1 ($found_v1) is available; it reached end of life in July 2023."
    warn "Using the generated docker-compose.v1*.yml fallback, which CI verifies resolves"
    warn "to the same stack. Upgrading is still worth it:"
    warn "    sudo apt-get install -y docker-compose-plugin"
    return
  fi

  # Nothing usable with the privileges we will actually run under. Work out why
  # so the message names the real problem.
  if [ -n "$SUDO" ]; then
    for candidate in "docker compose" "docker-compose"; do
      # shellcheck disable=SC2086
      local major; major="$(compose_major $candidate)"
      if [ -n "$major" ] && [ "$major" -ge 2 ] 2>/dev/null; then
        found_unprivileged="$candidate"
        break
      fi
    done
  fi

  if [ -n "$found_unprivileged" ]; then
    die "Docker Compose works for $(id -un) but not for root, so it is almost certainly installed under ~/.docker/cli-plugins — and this installer needs it as root.

Make it system-wide, then re-run:
    sudo apt-get install -y docker-compose-plugin      # Debian / Ubuntu
    sudo dnf install -y docker-compose-plugin          # Fedora / RHEL

Or copy the plugin where root can see it:
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo cp ~/.docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/"
  fi

  die "Docker Compose is not installed. Add it with:
    sudo apt-get install -y docker-compose-plugin      # Debian / Ubuntu
    sudo dnf install -y docker-compose-plugin          # Fedora / RHEL
Or see https://docs.docker.com/compose/install/"
}

check_prereqs() {
  need curl || need wget || die "Neither curl nor wget is available. Install one and try again."
  need tar || die "tar is required."

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

# ------------------------------------------------------------- download

resolve_version() {
  if [ "$VERSION" != "latest" ]; then return; fi
  local tag
  tag="$(fetch_stdout "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
        | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[^"]*"([^"]+)".*/\1/' || true)"
  if [ -n "$tag" ]; then
    VERSION="$tag"
  else
    warn "Could not reach the GitHub release API; falling back to the main branch."
    VERSION="main"
  fi
}

download_bundle() {
  local tmp url
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  if [ "$VERSION" = "main" ]; then
    url="https://codeload.github.com/$REPO/tar.gz/refs/heads/main"
  else
    url="https://github.com/$REPO/releases/download/$VERSION/stream-composer-$VERSION.tar.gz"
  fi

  info "Downloading $VERSION"
  if ! fetch "$url" "$tmp/bundle.tar.gz" 2>/dev/null; then
    warn "Release bundle not found; taking the source archive instead."
    url="https://codeload.github.com/$REPO/tar.gz/refs/tags/$VERSION"
    fetch "$url" "$tmp/bundle.tar.gz" || die "Could not download $VERSION from $REPO."
  fi

  mkdir -p "$tmp/extract"
  tar -xzf "$tmp/bundle.tar.gz" -C "$tmp/extract"

  # Release bundles are flat; source archives have a single top-level directory.
  local src="$tmp/extract"
  if [ ! -f "$src/docker-compose.yml" ]; then
    src="$(find "$tmp/extract" -maxdepth 2 -name docker-compose.yml -print -quit)"
    [ -n "$src" ] || die "The downloaded archive does not look like Stream Composer."
    src="$(dirname "$src")"
  fi

  $SUDO mkdir -p "$INSTALL_DIR"
  # Everything except .env is replaced, so upgrades pick up new compose files.
  for item in docker-compose.yml docker-compose.local.yml docker-compose.tls.yml \
              docker-compose.build.yml \
              docker-compose.v1.yml docker-compose.v1.local.yml docker-compose.v1.tls.yml \
              config obs scripts docs README.md LICENSE \
              .env.example Makefile install.sh; do
    [ -e "$src/$item" ] || continue
    $SUDO rm -rf "$INSTALL_DIR/${item:?}"
    $SUDO cp -R "$src/$item" "$INSTALL_DIR/$item"
  done
  ok "Installed files into $INSTALL_DIR"
}

# ------------------------------------------------------------- configure

read_existing() { # read_existing <key>
  [ -f "$INSTALL_DIR/.env" ] || return 0
  $SUDO grep -E "^$1=" "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true
}

configure() {
  local existing_session existing_internal upgrade="no"
  if [ -f "$INSTALL_DIR/.env" ]; then
    upgrade="yes"
    info "An existing configuration was found — keeping your settings."
  fi

  existing_session="$(read_existing SESSION_SECRET)"
  existing_internal="$(read_existing INTERNAL_SECRET)"
  SESSION_SECRET="${existing_session:-$(random_hex)}"
  INTERNAL_SECRET="${existing_internal:-$(random_hex)}"

  if [ "$upgrade" = "yes" ]; then
    DOMAIN="${DOMAIN:-$(read_existing DOMAIN)}"
    ACME_EMAIL="${ACME_EMAIL:-$(read_existing ACME_EMAIL)}"
    PUBLIC_HOST="${PUBLIC_HOST:-$(read_existing PUBLIC_HOST)}"
    local prev_port; prev_port="$(read_existing HTTP_PORT)"
    [ -n "$prev_port" ] && HTTP_PORT="$prev_port"
    local prev_rtmp; prev_rtmp="$(read_existing RTMP_PORT)"
    [ -n "$prev_rtmp" ] && RTMP_PORT="$prev_rtmp"
    local prev_admin; prev_admin="$(read_existing ADMIN_USER)"
    [ -n "$prev_admin" ] && ADMIN_USER="$prev_admin"
    MODE="$([ -n "$DOMAIN" ] && echo tls || echo local)"
    if ! confirm "Review the settings again?" "no"; then
      return
    fi
  fi

  say ""
  say "${BOLD}How should this server be reached?${RESET}"
  say "${DIM}  1) A public domain with automatic HTTPS (recommended)"
  say "     2) Plain HTTP on a port — for a LAN or behind your own proxy${RESET}"
  local choice
  ask choice "Choose 1 or 2" "$([ -n "$DOMAIN" ] && echo 1 || echo 2)"

  if [ "$choice" = "1" ]; then
    MODE="tls"
    while [ -z "$DOMAIN" ]; do
      ask DOMAIN "  Domain name (must already point at this server):" "$DOMAIN"
      [ -n "$DOMAIN" ] || warn "  A domain is required for HTTPS."
      [ "$ASSUME_YES" = "yes" ] && break
    done
    [ -n "$DOMAIN" ] || die "No domain given. Re-run with --domain, or choose option 2."
    ask ACME_EMAIL "  Email for certificate notices:" "$ACME_EMAIL"
    [ -n "$ACME_EMAIL" ] || die "Let's Encrypt requires a contact address. Re-run with --email."
    PUBLIC_HOST="${PUBLIC_HOST:-$DOMAIN}"
  else
    MODE="local"
    ask HTTP_PORT "  Web interface port:" "$HTTP_PORT"
    if [ -z "$PUBLIC_HOST" ]; then
      local guess
      guess="$(fetch_stdout https://api.ipify.org 2>/dev/null || true)"
      [ -n "$guess" ] || guess="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
      PUBLIC_HOST="$guess"
    fi
    ask PUBLIC_HOST "  Address OBS and viewers will use (IP or hostname):" "$PUBLIC_HOST"
  fi

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
}

write_env() {
  # Compose v1 cannot read the Compose Specification files; the generated
  # fallback beside them says the same thing in the 3.7 schema.
  local prefix="docker-compose"
  [ "$COMPOSE_KIND" = "v1" ] && prefix="docker-compose.v1"

  local compose_files
  if [ "$MODE" = "tls" ]; then
    compose_files="${prefix}.yml:${prefix}.tls.yml"
  else
    compose_files="${prefix}.yml:${prefix}.local.yml"
  fi

  # Releases publish a semver tag; the main branch publishes `edge`.
  local image_tag="${VERSION#v}"
  [ "$VERSION" = "main" ] && image_tag="edge"

  local tmp; tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# Written by install.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC').
# Re-running the installer keeps these values.

COMPOSE_FILE=$compose_files
# Set explicitly so Compose v1 and v2 name containers and volumes identically:
# v2 can take the project name from the file's `name:` key, v1 has no such key.
COMPOSE_PROJECT_NAME=stream-composer

COMPOSER_IMAGE=ghcr.io/${REPO,,}
COMPOSER_TAG=$image_tag
MEDIAMTX_VERSION=1.19.1
TRAEFIK_VERSION=v3.3

SESSION_SECRET=$SESSION_SECRET
INTERNAL_SECRET=$INTERNAL_SECRET

ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASSWORD

PUBLIC_HOST=$PUBLIC_HOST
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL

HTTP_PORT=$HTTP_PORT
RTMP_PORT=$RTMP_PORT
RTMPS_PORT=1936
SRT_PORT=8890
WEBRTC_UDP_PORT=8189

LOG_LEVEL=info
LOG_MAX_SIZE_MB=20
LOG_MAX_FILES=5
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

# ------------------------------------------------------------------ launch

launch() {
  cd "$INSTALL_DIR"
  # Compose reads .env itself, including COMPOSE_FILE, so the right overlay is
  # selected without repeating it here.
  info "Pulling images"
  $COMPOSE pull 2>&1 | tail -3 || warn "Some images could not be pulled."
  info "Starting the stack"
  if ! $COMPOSE up -d --remove-orphans; then
    die "The stack did not start. Inspect it with:
    cd $INSTALL_DIR && $COMPOSE logs"
  fi
}

wait_for_health() {
  local url attempts=0
  if [ "$MODE" = "tls" ]; then url="https://$DOMAIN/healthz"; else url="http://127.0.0.1:$HTTP_PORT/healthz"; fi
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
  warn "It has not answered yet. Check the logs with:  cd $INSTALL_DIR && $COMPOSE logs -f"
  return 1
}

summary() {
  local url rtmp
  if [ "$MODE" = "tls" ]; then
    url="https://$DOMAIN"
    rtmp="rtmp://$PUBLIC_HOST:$RTMP_PORT/live  (or rtmps://$PUBLIC_HOST:1936/live)"
  else
    url="http://$PUBLIC_HOST:$HTTP_PORT"
    rtmp="rtmp://$PUBLIC_HOST:$RTMP_PORT/live"
  fi

  say ""
  say "${GREEN}${BOLD}Stream Composer is running.${RESET}"
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
  say "  ${DIM}Next: open the admin console, create a stream, and paste the key into"
  say "  OBS under Settings → Stream with the server URL above.${RESET}"
  say ""
  local c="$COMPOSE"
  say "  ${DIM}Manage it with:${RESET}"
  say "    cd $INSTALL_DIR"
  say "    $c ps          ${DIM}# what is running${RESET}"
  say "    $c logs -f     ${DIM}# follow the logs${RESET}"
  say "    $c down        ${DIM}# stop everything${RESET}"
  say ""
  if [ "$MODE" = "tls" ]; then
    say "  ${DIM}Certificates are issued automatically on first request; the very first"
    say "  page load can take a few seconds while that happens.${RESET}"
    say ""
  fi
}

# --------------------------------------------------------------------- main

banner
resolve_privileges
check_prereqs
resolve_version
download_bundle
configure
write_env
launch
wait_for_health || true
summary
