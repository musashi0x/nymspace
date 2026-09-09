# Local Demo Runbook

The demo runs locally. There is no hosted deployment — the Railway app the
README once described returns `Application not found` from Railway's edge, and
standing up a fresh one days before a deadline would put an unrehearsed
deployment between the demo and the judges.

`docs/15_DEMO_SCRIPT.md` is the narrative. This is the bring-up.

## Quick start

```bash
docker compose up -d
pnpm --filter @nymspace/store db:migrate
pnpm sync:fleet
pnpm dev
```

Then <http://localhost:3111>. Nothing above needs a private key.

If port 5433 is taken, pick another and set it in both places — they are not
derived from each other:

```bash
POSTGRES_PORT=5544 docker compose up -d
# and DATABASE_URL=postgresql://nymspace:nymspace@localhost:5544/nymspace in .env
```

## Check before presenting

```bash
docker compose ps                      # healthy, not just running
curl -s localhost:3112/v1/agents | python3 -c "import json,sys; [print(a['ensName'], a['status']['ens']) for a in json.load(sys.stdin)['agents']]"
```

Three agents, each `active`.

Then open, in demo order:

| page | expect |
|---|---|
| <http://localhost:3111> | commit graph, readership card |
| <http://localhost:3111/console> | three agents; `research` at ENS active / ERC 8004 registered / ENSIP 25 verified |
| <http://localhost:3111/console/agents/agent-research> | the Inspector |

The Inspector's id is `agent-research`, not `research`.

## What is on chain, independent of any database

Re-checkable at any time, no keys needed:

```bash
pnpm --filter @nymspace/ens read:fleet
```

| name | agent-context | endpoint[mcp] | ERC 8004 | ENSIP 25 |
|---|---|---|---|---|
| `research.nymspace.eth` | yes | yes | #9209 | verified |
| `trader.nymspace.eth` | yes | — | — | — |
| `deploy.nymspace.eth` | yes | — | — | — |

All owned by the organization `0xB5e8…55C9`. ENS is on Sepolia (11155111); the
ERC 8004 identity is on **Base Sepolia (84532)**. The registry is deployed at
the same address on both chains, so reading the identity against the wrong one
returns a different agent rather than an error — see `docs/06`.

## Known gaps

Say these rather than working around them on camera.

| what shows | why | to fix |
|---|---|---|
| Graph track `not indexed` | `GRAPH_API_KEY` unset | set the key |
| financial track `no wallet` | Privy credentials unset | set them |
| Grant/Revoke returns 503 | no signing key configured | connect the organization wallet, below |
| "Commit data unavailable" | `GITHUB_TOKEN` unset — 60 req/hr shared across the machine | set a no-scope classic token |

The first two are claimed sponsor integrations, so they are worth credentials
before recording.

The 503 is deliberate rather than broken: it names the prepare route in a
`remedy` field instead of reporting a chain denial, because a missing key is an
infrastructure failure and must never be rendered as a permission verdict.

**To sign for real**, connect the organization account
`0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9` in a browser wallet on Sepolia.
The console header then reads `organization` and Grant/Revoke take the wallet
path. Any other account or network and the panel says so before you click.

## If something looks wrong

| symptom | cause | fix |
|---|---|---|
| no agents | store empty, or written under the wrong organization id | `pnpm sync:fleet` |
| five grey badges | store recreated; chain untouched | `pnpm sync:fleet` |
| two agents with one name | a hand-seeded row colliding on slug | delete the extra; `getAgentBySlug` picks arbitrarily |
| 500 on `/console` | database down, or `DATABASE_URL` port disagrees with the container | `docker compose ps`, check the port |
| Inspector 404 | used the slug | the id is `agent-<slug>` |
| `docker compose restart` does nothing | the container was started by hand, so compose does not own it | `docker compose up -d` |

Reach for `pnpm sync:fleet` before `pnpm provision:fleet`. Provisioning needs
both private keys and spends gas discovering that the names already exist.

## Restart test

`docs/13` task 8.6 requires the demo to survive a restart, because in-memory
state fails identically to success until the moment it does not.

```bash
docker compose restart
```

Wait for `healthy`, then re-check the three agents. ENS, identity and permission
state all reload because none of them live in the store — they are read from
their own systems per request.

## Why the steps are what they are

**Come up through compose, not `docker run`.** A hand-started container serves
fine and then fails one specific way: `docker compose restart` silently does
nothing to a container compose does not own, so the restart test above passes
without restarting anything. Compose also namespaces the volume as
`ens_project_nymspace-pgdata`, so a hand-started container writing to plain
`nymspace-pgdata` is a second database, indistinguishable from the first in
psql.

**`sync:fleet` is the step that fixes a console full of grey badges.** The
console renders the store's record of provisioning progress. A store recreated
locally does not carry what an earlier provisioning run wrote — and an
unprovisioned fleet and a stale row look identical there while having opposite
remedies. `read:fleet` tells them apart; `sync:fleet` fixes the second without
gas or keys.

**The ports are load-bearing.** `WEB_ORIGIN` is parsed as a CORS allowlist and
`NEXT_PUBLIC_API_URL` is baked into the client bundle, so web on 3111 and API on
3112 are not preferences — a different port is a broken page rather than a page
at a new address.

**`ORGANIZATION_ID` is the string `nymspace`,** written out in
`scripts/provision-fleet.ts`, `scripts/sync-fleet.ts` and
`apps/api/src/deps.ts`. A different value in one of them does not error; it
creates a second organization nobody reads, and the fleet goes empty.

**Run the test suite before `sync:fleet`, not after.** `pnpm test` uses a real
Postgres — deliberately, since the store's schema test reads
`information_schema` — and leaves rows under an `org-test` organization. They
are invisible in the console, which filters by organization, so this is
contained rather than dangerous. But the database is not pristine afterwards.
