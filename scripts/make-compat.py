#!/usr/bin/env python3
"""
Generate the Compose v1 fallback files from the canonical ones.

Why generate rather than hand-maintain
--------------------------------------
The fallback differs from the real files in exactly two mechanical ways, so a
hand-kept copy would be pure duplication — and duplication of deployment files
drifts silently until someone's install breaks. Generating them means the only
maintenance is editing the canonical file and re-running this script, and CI
fails if the committed output does not match.

The transform is textual, not a YAML round-trip, so comments, ordering and
formatting all survive.

What changes, and why
---------------------
1. `version: "3.7"` is added.
   Compose v1 treats a file with no `version:` key as the 2015 schema, where
   every top-level key is a service name. It then reports the baffling
   "'name' does not match any of the regexes: '^x-'".
   3.7 is chosen because it is the newest format Compose 1.25 understands, and
   nothing here needs anything later.

2. The top-level `name:` is removed.
   Project naming by file is Compose Spec only. The installer sets
   COMPOSE_PROJECT_NAME in .env instead, which both versions honour, so the
   containers and volumes come out identically named either way.

Usage:  python3 scripts/make-compat.py [--check]
        --check exits non-zero if the committed files are out of date.
"""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# The fallback lives beside the canonical files, not in a subdirectory.
# Compose resolves relative paths and `.env` against the directory of the first
# compose file, so `compat/v1/docker-compose.yml` would look for
# `compat/v1/config/mediamtx.yml` and `compat/v1/.env` — neither of which
# exists. Same directory, different names, no surprises.
SOURCES = {
    "docker-compose.yml": "docker-compose.v1.yml",
    "docker-compose.local.yml": "docker-compose.v1.local.yml",
    "docker-compose.tls.yml": "docker-compose.v1.tls.yml",
}
COMPOSE_VERSION = "3.7"

BANNER = """# ---------------------------------------------------------------------------
# GENERATED FILE — do not edit.
#
# Compose v1 fallback, generated from {source} by scripts/make-compat.py.
# Edit that file and re-run:  python3 scripts/make-compat.py
#
# Differences from the canonical file:
#   * `version: "{version}"` added — v1 reads a version-less file as the 2015
#     schema and misparses every top-level key as a service name.
#   * top-level `name:` removed — Compose Spec only; the project name comes
#     from COMPOSE_PROJECT_NAME in .env instead.
# ---------------------------------------------------------------------------
"""


def transform(text: str, source: str) -> str:
    # Point the documentation inside the file at the v1 names, so someone
    # reading the fallback is told the right COMPOSE_FILE line.
    for canonical, fallback in SOURCES.items():
        text = text.replace(canonical, fallback)

    lines = text.splitlines()
    out, dropped_name = [], False

    for i, line in enumerate(lines):
        # Drop the top-level `name:` key (column 0, not a nested one).
        if not dropped_name and line.startswith("name:"):
            dropped_name = True
            # Also swallow a single blank line left behind by the removal.
            if i + 1 < len(lines) and lines[i + 1].strip() == "":
                lines[i + 1] = "\x00"
            continue
        if line == "\x00":
            continue
        out.append(line)

    body = "\n".join(out).lstrip("\n")

    # Place `version:` before the first top-level key so it reads naturally.
    banner = BANNER.format(source=source, version=COMPOSE_VERSION)
    return f'{banner}\nversion: "{COMPOSE_VERSION}"\n\n{body}\n'


def main() -> int:
    check = "--check" in sys.argv
    stale = []

    for source, target in SOURCES.items():
        src = ROOT / source
        if not src.exists():
            print(f"missing source: {source}", file=sys.stderr)
            return 2
        generated = transform(src.read_text(), source)
        dest = ROOT / target

        if check:
            current = dest.read_text() if dest.exists() else ""
            if current != generated:
                stale.append(str(dest.relative_to(ROOT)))
        else:
            dest.write_text(generated)
            print(f"wrote {dest.relative_to(ROOT)}")

    if check:
        if stale:
            print("The Compose v1 fallback is out of date:", file=sys.stderr)
            for s in stale:
                print(f"  {s}", file=sys.stderr)
            print("\nRegenerate with:  python3 scripts/make-compat.py", file=sys.stderr)
            return 1
        print("The Compose v1 fallback is up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
