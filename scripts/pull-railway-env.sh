#!/usr/bin/env bash
#
# Pull the deployed credentials from Railway into the local .env, without
# dragging production's addresses down with them.
#
# A plain `railway variables > .env` breaks local development in a way that
# takes a while to diagnose: DATABASE_URL points at Railway's internal
# Postgres (unreachable from a laptop), and WEB_ORIGIN / NEXT_PUBLIC_API_URL
# point at the deployed domains — so the console loads, talks to production,
# and every read looks subtly wrong rather than failing.
#
# So this merges by key: Railway wins for credentials, the local file wins for
# anything naming a host or a port. Keys only on one side are kept.
#
#   Usage:  bash scripts/pull-railway-env.sh [service]   # service defaults to: api
#
set -euo pipefail

SERVICE="${1:-api}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# Never taken from Railway: every one of these names a host, a port, or an
# origin, and production's answer is wrong on a laptop.
LOCAL_WINS="DATABASE_URL API_PORT PORT WEB_ORIGIN NEXT_PUBLIC_API_URL NODE_ENV"

command -v railway >/dev/null || { echo "railway CLI not installed"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$ENV_FILE.bak-$STAMP"
echo "backed up  .env.bak-$STAMP"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

railway variables -s "$SERVICE" --kv > "$TMP/remote.env"

LOCAL_WINS="$LOCAL_WINS" python3 - "$ENV_FILE" "$TMP/remote.env" "$TMP/merged.env" <<'PY'
import os, sys

env_path, remote_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
local_wins = set(os.environ["LOCAL_WINS"].split())


def parse(path):
    """Key to value, ignoring comments and blanks. Values are kept verbatim —
    a private key with an `=` in it must survive the round trip."""
    out = {}
    for line in open(path, encoding="utf-8"):
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v
    return out


remote = parse(remote_path)
lines = open(env_path, encoding="utf-8").read().splitlines(keepends=True)

filled, kept, added = [], [], []
seen = set()
merged = []

for line in lines:
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        merged.append(line)
        continue
    k, v = s.split("=", 1)
    k = k.strip()
    seen.add(k)
    if k in local_wins:
        kept.append(k)
        merged.append(line)
    elif k in remote and remote[k] != v:
        filled.append(k)
        merged.append(f"{k}={remote[k]}\n")
    else:
        merged.append(line)

# Anything Railway has that the local file never declared. Appended rather than
# dropped: `pnpm env:check` reconciles .env.example against turbo.json, not this
# file, so a variable missing here just fails at runtime with no hint.
#
# Except Railway's own injections. `RAILWAY_*` is set by the platform inside a
# deployed container and means nothing on a laptop — and `railway.ts` only ever
# uses `RAILWAY_PUBLIC_DOMAIN` through a `${{service.VAR}}` template Railway
# resolves at deploy time, never by reading it from a file. Copied down they are
# clutter at best; `RAILWAY_ENVIRONMENT=production` sitting in a local `.env` is
# actively misleading.
extra = [
    k
    for k in remote
    if k not in seen and k not in local_wins and not k.startswith("RAILWAY_")
]
if extra:
    merged.append(f"\n# Pulled from Railway, not present locally before\n")
    for k in sorted(extra):
        added.append(k)
        merged.append(f"{k}={remote[k]}\n")

open(out_path, "w", encoding="utf-8").writelines(merged)

# Names only. A value printed here ends up in a scrollback buffer.
print(f"updated from Railway ({len(filled)}): {' '.join(sorted(filled)) or '—'}")
print(f"kept local ({len(kept)}): {' '.join(sorted(kept)) or '—'}")
print(f"newly added ({len(added)}): {' '.join(sorted(added)) or '—'}")
PY

cp "$TMP/merged.env" "$ENV_FILE"
echo
echo "wrote .env — restart \`pnpm dev\` to pick it up"
