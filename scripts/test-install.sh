#!/usr/bin/env bash
#
# Unit tests for install.sh, which is otherwise only ever exercised by running
# it on a real machine — the one place a bug is most expensive to find.
#
# The installer is sourced with SC_LIB_ONLY=1, which defines its functions and
# returns before doing anything, so individual pieces can be called in
# isolation. Run with: ./scripts/test-install.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

ok()   { printf '  ok   %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# Run installer code in a *separate bash process*, not a subshell of this one:
# on_error deliberately behaves differently at subshell depth 0, and capturing
# with $(...) would make every case look like a subshell.
CASE_DIR="$(mktemp -d)"
trap 'rm -rf "$CASE_DIR"' EXIT

run_installer_fn() { # run_installer_fn <shell code using installer functions>
  {
    echo 'export SC_LIB_ONLY=1'
    # install.sh parses "$@" at load time, and a sourced script inherits the
    # caller's positional parameters — so clear them before sourcing.
    echo 'set --'
    echo "source \"$ROOT/install.sh\""
    printf '%s\n' "$1"
  } > "$CASE_DIR/case.sh"
  bash "$CASE_DIR/case.sh" > "$CASE_DIR/case.out" 2>&1
  local status=$?
  cat "$CASE_DIR/case.out"
  return $status
}

# ----------------------------------------------------------------- write_env
#
# The .env body is a heredoc with variable expansion switched on, which means
# any stray backtick or $(...) in it runs as a command on the operator's
# machine. That actually happened: a comment mentioning the Compose `name:`
# key executed `name:`, printed "name:: command not found", tripped the ERR
# trap from inside a subshell — so the installer announced that it had stopped
# and then carried on regardless — and wrote the comment out mangled.

echo "write_env"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$CASE_DIR"' EXIT

out="$(run_installer_fn '
  INSTALL_DIR='"$TMP"'
  SUDO=""
  MODE="local"
  COMPOSE_KIND="v2"
  VERSION="v1.2.3"
  SESSION_SECRET="s3ss10n"
  INTERNAL_SECRET="1nt3rnal"
  ADMIN_USER="anders"
  ADMIN_PASSWORD="hunter2"
  PUBLIC_HOST="192.0.2.10"
  DOMAIN=""
  ACME_EMAIL=""
  HTTP_PORT="8080"
  RTMP_PORT="1935"
  write_env
' 2>&1)"
status=$?

if [ "$status" -ne 0 ]; then
  bad "write_env succeeds" "exited $status: $out"
elif grep -qi "command not found" <<< "$out"; then
  bad "write_env runs nothing from its heredoc" "$out"
else
  ok "write_env succeeds without executing anything from its own text"
fi

env_file="$TMP/.env"
if [ ! -f "$env_file" ]; then
  bad "write_env writes .env" "no file at $env_file"
else
  ok "write_env writes .env"

  # Every line must be a comment, a blank, or KEY=value. A mangled heredoc
  # shows up here as a stray fragment.
  if bad_line="$(grep -nvE '^[[:space:]]*(#|$)|^[A-Z_][A-Z0-9_]*=' "$env_file" | head -1)"; [ -n "$bad_line" ]; then
    bad ".env contains only comments and assignments" "line $bad_line"
  else
    ok ".env contains only comments and assignments"
  fi

  for pair in \
    "COMPOSE_PROJECT_NAME=stream-composer" \
    "COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml" \
    "COMPOSER_TAG=1.2.3" \
    "SESSION_SECRET=s3ss10n" \
    "INTERNAL_SECRET=1nt3rnal" \
    "ADMIN_USER=anders" \
    "ADMIN_PASSWORD=hunter2" \
    "PUBLIC_HOST=192.0.2.10"; do
    if grep -qxF "$pair" "$env_file"; then
      ok ".env has $pair"
    else
      bad ".env has $pair" "actual: $(grep "^${pair%%=*}=" "$env_file" || echo '(absent)')"
    fi
  done

  # The comment that caused the bug must survive intact.
  if grep -qF '"name:" key' "$env_file"; then
    ok "the Compose project-name comment survives verbatim"
  else
    bad "the Compose project-name comment survives verbatim" \
        "got: $(grep -i 'project name' "$env_file" || echo '(absent)')"
  fi

  perms="$(stat -c '%a' "$env_file" 2>/dev/null || stat -f '%Lp' "$env_file")"
  if [ "$perms" = "600" ]; then
    ok ".env is mode 600"
  else
    bad ".env is mode 600" "got $perms"
  fi
fi

# The Compose v1 fallback must be selected when v1 is what we found.
out="$(run_installer_fn '
  INSTALL_DIR='"$TMP"'
  SUDO=""; MODE="tls"; COMPOSE_KIND="v1"; VERSION="main"
  SESSION_SECRET=x; INTERNAL_SECRET=y; ADMIN_USER=a; ADMIN_PASSWORD=b
  PUBLIC_HOST=h; DOMAIN=d.example; ACME_EMAIL=e@example; HTTP_PORT=8080; RTMP_PORT=1935
  write_env
' 2>&1)"
if grep -qxF "COMPOSE_FILE=docker-compose.v1.yml:docker-compose.v1.tls.yml" "$TMP/.env"; then
  ok "Compose v1 selects the generated fallback files"
else
  bad "Compose v1 selects the generated fallback files" "$(grep '^COMPOSE_FILE=' "$TMP/.env")"
fi
if grep -qxF "COMPOSER_TAG=edge" "$TMP/.env"; then
  ok "the main branch installs the edge tag"
else
  bad "the main branch installs the edge tag" "$(grep '^COMPOSER_TAG=' "$TMP/.env")"
fi

# ----------------------------------------------------------------- on_error
#
# A failure inside a command substitution fires ERR in a subshell, where `exit`
# ends only that subshell. The trap must not claim the installer stopped when
# it demonstrably has not.

echo "on_error"

# The exact shape of the original bug: a command substitution that fails
# inside a heredoc, where the enclosing command still succeeds. The installer
# carries on — so it must not announce that it stopped.
out="$(run_installer_fn '
  writes_a_file() {
    cat > /dev/null <<HEREDOC
$(definitely-not-a-real-command)
HEREDOC
    echo "wrote the file"
  }
  writes_a_file
  echo "and carried on"
' 2>&1)"
if grep -q "stopped unexpectedly" <<< "$out"; then
  bad "a heredoc substitution failure does not claim the installer stopped" "$out"
elif ! grep -q "and carried on" <<< "$out"; then
  bad "a heredoc substitution failure does not claim the installer stopped" \
      "the installer really did stop: $out"
else
  ok "a heredoc substitution failure does not claim the installer stopped"
fi

out="$(run_installer_fn 'false; echo "should not reach here"' 2>&1)"
if grep -q "stopped unexpectedly" <<< "$out" && ! grep -q "should not reach here" <<< "$out"; then
  ok "a real failure in the main shell still stops and reports"
else
  bad "a real failure in the main shell still stops and reports" "$out"
fi

# ------------------------------------------------------------------- compose

echo "compose_major"

out="$(run_installer_fn 'compose_major "definitely-not-a-real-binary"; echo "rc=$?"' 2>&1)"
if grep -q "rc=0" <<< "$out"; then
  ok "compose_major never returns non-zero, even for a missing binary"
else
  bad "compose_major never returns non-zero, even for a missing binary" "$out"
fi

# --------------------------------------------------------------------------

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
