#!/usr/bin/env python3
"""
Prove the Compose v1 fallback describes the same stack as the canonical files.

`make-compat.py --check` already guarantees the fallback is a faithful textual
transform of the canonical file. This goes one step further and compares what
each Compose version actually *resolves* — because the two implementations
interpolate variables and normalise ports and volumes differently, and a
divergence there would ship a subtly different deployment to v1 users without
anyone noticing.

Compares, per service: image, published ports, environment, volume targets,
container name, restart policy and depends_on.

Usage:
    python3 scripts/check-compose-parity.py
    python3 scripts/check-compose-parity.py --v1 "docker run --rm -v $PWD:/w -w /w docker/compose:1.29.2"
"""

import argparse
import json
import os
import pathlib
import shlex
import subprocess
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Values that only ever exist to satisfy interpolation during the check.
ENV = {
    "COMPOSE_PROJECT_NAME": "stream-composer",
    "SESSION_SECRET": "parity-session",
    "INTERNAL_SECRET": "parity-internal",
    "PUBLIC_HOST": "192.168.1.10",
    "DOMAIN": "example.com",
    "ACME_EMAIL": "parity@example.com",
    # Only interpolated by the external-Traefik overlay, which has no bundled
    # traefik service to derive a real one from.
    "TRAEFIK_NETWORK": "parity-external-net",
}

COMBOS = [
    ("local", "docker-compose.yml:docker-compose.local.yml",
     "docker-compose.v1.yml:docker-compose.v1.local.yml"),
    ("tls", "docker-compose.yml:docker-compose.tls.yml",
     "docker-compose.v1.yml:docker-compose.v1.tls.yml"),
    ("tls-external", "docker-compose.yml:docker-compose.tls.external.yml",
     "docker-compose.v1.yml:docker-compose.v1.tls.external.yml"),
]


# Values are passed through a file rather than the environment so the same
# command works whether Compose runs on this machine or inside a container
# (`docker run ... docker/compose:1.29.2`), where host environment variables
# would not be visible. Both Compose versions accept --env-file.
ENV_FILE = ROOT / ".env.parity"


def write_env_file(compose_file):
    lines = [f"{k}={v}" for k, v in ENV.items()]
    lines.append(f"COMPOSE_FILE={compose_file}")
    ENV_FILE.write_text("\n".join(lines) + "\n")


def run(cmd, compose_file):
    write_env_file(compose_file)
    full = cmd + ["--env-file", ENV_FILE.name, "config"]
    proc = subprocess.run(full, cwd=ROOT, env={**os.environ, "COMPOSE_FILE": compose_file},
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"`{' '.join(full)}` failed for {compose_file}:\n{proc.stderr.strip()}")
    return yaml.safe_load(proc.stdout)


def norm_ports(ports):
    """v1 emits "8080:3000/tcp"; v2 emits a mapping. Reduce both to a set."""
    out = set()
    for p in ports or []:
        if isinstance(p, dict):
            published, target = p.get("published"), p.get("target")
            proto = p.get("protocol", "tcp")
            out.add(f"{published}:{target}/{proto}")
        else:
            text = str(p)
            proto = "tcp"
            if "/" in text:
                text, proto = text.rsplit("/", 1)
            out.add(f"{text}/{proto}")
    return out


def norm_volumes(volumes):
    out = set()
    for v in volumes or []:
        if isinstance(v, dict):
            src = v.get("source", "")
            # Absolute host paths differ only by checkout location.
            out.add(f"{pathlib.Path(src).name if '/' in str(src) else src}:{v.get('target')}")
        else:
            parts = str(v).split(":")
            if len(parts) >= 2:
                src = parts[0]
                out.add(f"{pathlib.Path(src).name if '/' in src else src}:{parts[1]}")
    return out


def norm_env(environment):
    if isinstance(environment, dict):
        return {k: ("" if v is None else str(v)) for k, v in environment.items()}
    out = {}
    for item in environment or []:
        k, _, v = str(item).partition("=")
        out[k] = v
    return out


def summarise(config):
    services = {}
    for name, svc in (config.get("services") or {}).items():
        services[name] = {
            "image": svc.get("image"),
            "container_name": svc.get("container_name"),
            "restart": svc.get("restart"),
            "ports": norm_ports(svc.get("ports")),
            "environment": norm_env(svc.get("environment")),
            "volumes": norm_volumes(svc.get("volumes")),
            "depends_on": sorted(svc.get("depends_on") or []),
            "labels": norm_env(svc.get("labels")),
        }
    return services


def compare(label, a, b):
    problems = []
    if set(a) != set(b):
        problems.append(f"  services differ: canonical={sorted(a)} fallback={sorted(b)}")
        return problems
    for name in sorted(a):
        for key in sorted(a[name]):
            left, right = a[name][key], b[name][key]
            if left != right:
                problems.append(f"  {name}.{key}:\n      canonical: {left}\n      fallback:  {right}")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--v2", default="docker compose", help="command for Compose v2")
    ap.add_argument("--v1", default="docker-compose", help="command for Compose v1")
    args = ap.parse_args()

    v2_cmd = shlex.split(args.v2)
    v1_cmd = shlex.split(args.v1)

    failed = False
    for label, canonical, fallback in COMBOS:
        canonical_cfg = summarise(run(v2_cmd, canonical))
        fallback_cfg = summarise(run(v1_cmd, fallback))
        problems = compare(label, canonical_cfg, fallback_cfg)
        if problems:
            failed = True
            print(f"[{label}] the fallback does not match the canonical stack:")
            print("\n".join(problems))
        else:
            print(f"[{label}] identical: {len(canonical_cfg)} services, "
                  f"{sum(len(s['ports']) for s in canonical_cfg.values())} published ports")

    ENV_FILE.unlink(missing_ok=True)
    if failed:
        print("\nRegenerate with:  python3 scripts/make-compat.py", file=sys.stderr)
        return 1
    print("\nThe Compose v1 fallback resolves to the same stack as the canonical files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
