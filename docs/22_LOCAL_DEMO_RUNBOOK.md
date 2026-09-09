# Local Demo Runbook

The demo runs on a laptop. There is no hosted deployment: the Railway app that
`README` and the tracking board once pointed at returns `Application not found`
from Railway's own edge, which means the application no longer exists rather
than that a route is wrong. Recreating it before the deadline would put the
first run of an unrehearsed deployment between the demo and the judges, so the
decision recorded here is to demo locally and treat hosting as post-submission
work.

`docs/15_DEMO_SCRIPT.md` is the narrative. This is the bring-up.

## What is actually on chain

Independent of any database, and re-checkable at any time with
`pnpm --filter @nymspace/ens read:fleet`:

| name | agent-context | agent-endpoint[mcp] | ERC 8004 | ENSIP 25 |
|---|---|---|---|---|
| `research.nymspace.eth` | yes | yes | #9209, Base Sepolia | verified |
| `trader.nymspace.eth` | yes | — | — | — |
| `deploy.nymspace.eth` | yes | — | — | — |

All three are owned by the organization `0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9`.
ENS is on Sepolia (11155111); the ERC 8004 identity is on **Base Sepolia
(84532)**, and the registry is deployed at the same address on both chains — so
reading the identity against the wrong chain returns a different agent rather
than an error. `docs/06` has the detail.

## Bring-up

Four terminals' worth of work, in order. Each step has a check, because the
failure this sequence is designed against is a step that half-succeeded.

### 1. Database

```bash
POSTGRES_PORT=5443 docker compose up -d
```

Port 5443, not the compose default of 5433, because 5433 is taken on this
machine by an unrelated project's container. `DATABASE_URL` in `.env` must name
the same port — the two are not derived from each other.

Bring it up **through compose**, not with a bare `docker run`. A hand-started
container works for everything except `docker compose restart`, which quietly
does nothing to a container compose does not own — so the restart test in
`docs/13` passes without having restarted anything. Compose also namespaces the
volume as `ens_project_nymspace-pgdata`, so a hand-started container writing to
plain `nymspace-pgdata` is a second database that looks identical from psql.

```bash
docker compose ps
```

Wait for `healthy`, not `running`. Then:

```bash
pnpm --filter @nymspace/store db:migrate
```

### 2. Fill the store from chain

```bash
pnpm sync:fleet
```

Needs **no private keys**. It reads ENS, the ERC 8004 registry and the ENSIP 25
binding, and writes what it found. Expect:

```
research.nymspace.eth  -> ens=active erc8004=registered ensip25=verified
trader.nymspace.eth    -> ens=active erc8004=unregistered
deploy.nymspace.eth    -> ens=active erc8004=unregistered
```

It says at the end that `graph` and `financial` were **not** synced. That is
true and expected — see *Known gaps*.

**This is the step that fixes a console full of grey badges.** A store that has
been recreated locally does not carry what an earlier provisioning run wrote,
and the console renders the store's record of provisioning progress. An
unprovisioned fleet and a stale row look identical there and have opposite
remedies; `read:fleet` tells them apart, and this fixes the second one without
spending gas or needing a key.

Do **not** reach for `pnpm provision:fleet` to fix a stale row. It needs both
private keys and it spends gas discovering that the names already exist.

### 3. Services

```bash
pnpm dev
```

Web on **3111**, API on **3112**. Both ports are load-bearing: `WEB_ORIGIN` is
parsed as a CORS allowlist and `NEXT_PUBLIC_API_URL` is baked into the client
bundle, so a different port is a broken page rather than a page on a new
address.

### 4. Check before presenting

```bash
curl -s localhost:3112/v1/agents | python3 -c "import json,sys; [print(a['ensName'], a['status']['ens']) for a in json.load(sys.stdin)['agents']]"
```

Three lines, each `active`. (`grep -c ensName` does not work here — the
response is a single line, so it counts 1 however many agents there are.)

Then open, in this order — the same order as the demo script:

- <http://localhost:3111> — landing, commit activity
- <http://localhost:3111/console> — three agents, `research` showing
  ENS active / ERC 8004 registered / ENSIP 25 verified
- <http://localhost:3111/console/agents/agent-research> — the Inspector

The Inspector's id is `agent-research`, not `research`. Every panel on it is
read live per request: owner, registry and resolver from chain, the manifest
assembled from ENSIP 26 text records, the authority matrix from `hasRoles`
against the resolver's own fallback chain, and ENSIP 25 verified against chain
84532. Each value carries its own provenance chip — `CHAIN 11155111`, `STORE` —
so nothing on the page can claim to be live when it is cached.

## Known gaps

State these rather than working around them on camera.

**The Graph track shows `not indexed`.** `GRAPH_API_KEY` is unset. Discovery
against a live subgraph is a claimed sponsor integration, so this one needs the
key before recording.

**The financial track shows `no wallet`.** The Privy credentials are unset.
The Inspector says "Financial authority has not been configured for this
agent", which is accurate rather than broken — but it is also a claimed sponsor
integration.

**Grant and Revoke fall back to the server path and return 503.** Both
`ENSV2_ORGANIZATION_PRIVATE_KEY` and `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY` are
empty in `.env`. The 503 names the prepare route in a `remedy` field rather
than reporting a chain denial, which is deliberate: a missing key is an
infrastructure failure and must never be rendered as a permission verdict.

To sign for real, connect the **organization** account
`0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9` in a browser wallet on Sepolia.
The header then shows `organization` and Grant/Revoke take the wallet path.
Any other account, or any other network, and the panel says so before a click.

**GitHub commit activity is rate limited.** `GITHUB_TOKEN` is unset, so the
landing page shares the unauthenticated 60 requests/hour limit for the whole
machine. The page reports the limit rather than rendering zero commits, but on
a bad hour it will say so on camera.

## If the console looks wrong

| symptom | cause | fix |
|---|---|---|
| no agents at all | store empty, or written under the wrong organization id | `pnpm sync:fleet` |
| five grey badges | store recreated, chain untouched | `pnpm sync:fleet` |
| two agents with the same name | a hand-seeded row colliding on slug | delete the extra row; `getAgentBySlug` picks arbitrarily |
| 500 on `/console` | database not up, or `DATABASE_URL` port disagrees with the container | check `docker compose ps` and the port |
| Inspector 404 | using the slug | the id is `agent-<slug>` |

`ORGANIZATION_ID` is the string `nymspace`, and it is written out in
`scripts/provision-fleet.ts`, `scripts/sync-fleet.ts` and
`apps/api/src/deps.ts`. Writing a different value in one of them does not
error — it creates a second organization nobody reads, and the fleet goes
empty.

## Restart test

`docs/13` task 8.6 requires the demo to survive a restart, because in-memory
state fails identically to success until the moment it does not:

```bash
docker compose restart
```

Wait for `healthy`, then re-check the three agents. ENS, identity and
permission state all reload because none of them live in the store — they are
read from their own systems per request. Only provisioning progress and the
activity log are persisted, and the Postgres volume is named rather than
anonymous so it survives.

Verified on 2026-09-09: container back to `healthy`, three agents, `research`
still `ensip25=verified`.

## Do not run the test suite against the demo database

`pnpm test` uses a real Postgres — that is deliberate, `@nymspace/store`'s
schema test reads `information_schema` — and it leaves rows behind under an
`org-test` organization.

They are invisible in the console, which filters by `ORGANIZATION_ID`, so this
is contained rather than dangerous. But it means a database is not pristine
after a test run, and a future test that used the real organization id would
corrupt the demo silently. Run the suite before `sync:fleet`, not after.
