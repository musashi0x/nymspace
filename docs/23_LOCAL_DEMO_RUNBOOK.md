# Local Demo Runbook

How to bring the demo up on a laptop. `docs/15_DEMO_SCRIPT.md` is the
narrative; `docs/22_DEPLOYMENT.md` is the hosted estate.

Running locally is a choice about rehearsal, not a verdict on the deployment.
An earlier draft of this file claimed the Railway app no longer existed,
reading its edge `404` as a missing application. That was wrong, and
`docs/22_DEPLOYMENT.md` has the correct diagnosis: the *service* was healthy
and answering its own healthcheck, while the generated domain record carried
`targetPort: null` — a dead edge record in front of a live container. A
container that cannot be reached answers `502`, so a `404` there points at the
domain, not the app.

The reason to rehearse locally is that a demo should not depend on a hop
nobody has practised, not that there is nowhere to deploy.

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
| <http://localhost:3111/console/chat> | ask it something; a plan renders with a Run it gate |
| <http://localhost:3111/console/treasury> | one row per agent — today all three read *not provisioned* |

The Inspector's id is `agent-research`, not `research`.

Treasury reading *not provisioned* three times is correct output, not a broken
page: no Privy wallet has been created yet. See Known gaps.

## What is on chain, independent of any database

Re-checkable at any time, no keys needed:

```bash
pnpm --filter @nymspace/ens read:fleet
```

It prints the resolver, the registry, the parent name, and then the text
records each agent actually carries:

| name | agent-context | endpoint[mcp] |
|---|---|---|
| `research.nymspace.eth` | yes | yes |
| `trader.nymspace.eth` | yes | — |
| `deploy.nymspace.eth` | yes | — |

It closes by comparing that against the local store, so a console full of grey
badges gets diagnosed in one command: *"Chain holds records the local store
does not"* means the store is behind, and `pnpm sync:fleet` is the fix.

**ENS records only.** `read:fleet` does not read ERC 8004 or ENSIP 25 — the
console does that per request, and the identity lives on a different chain.
ENS is on Sepolia (11155111); the ERC 8004 identity is on **Base Sepolia
(84532)**. The registry is deployed at the same address on both chains, so
reading the identity against the wrong one returns a different agent rather
than an error — see `docs/06`.

All three names are owned by the organization `0xB5e8…55C9`.

## Known gaps

Say these rather than working around them on camera.

| what shows | why | to fix |
|---|---|---|
| Graph track `not indexed` | `GRAPH_API_KEY` unset | set the key |
| financial track `no wallet`, Treasury all *not provisioned* | Privy credentials unset | set them, then `pnpm provision:wallet` |
| Grant/Revoke returns 503 | no signing key configured | set the key, below |
| "Commit data unavailable" | `GITHUB_TOKEN` unset — 60 req/hr shared across the machine | set a no-scope classic token |

The first two are claimed sponsor integrations, so they are worth credentials
before recording. `docs/16_SPONSOR_QUALIFICATION.md` tracks exactly which parts
have run and which have not.

The 503 is deliberate rather than broken. `apps/api/src/deps.ts` builds its
dependencies with *keys when present, addresses otherwise*, so every read works
without credentials and only a write fails — with a 503 naming the missing
variable, because a missing key is an infrastructure failure and must never be
rendered as a permission verdict. A denial and a misconfiguration look identical
on screen otherwise, and this product's whole claim is that it can tell them
apart.

**To sign for real**, set both keys in `.env`:

```
ENSV2_ORGANIZATION_PRIVATE_KEY=0x…      # owns nymspace.eth
ENSV2_AGENT_CONTROLLER_PRIVATE_KEY=0x…  # the delegated controller
```

There is no connect-wallet button, and that is not an omission: `apps/web` has
no wallet stack at all, deliberately. The organization signs server side, and
the agent's authority is the point being demonstrated — a browser wallet in
front of it would put a human back in the path the demo exists to show an agent
taking alone.

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
