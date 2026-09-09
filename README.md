# Nymspace

> I would make ENS the identity layer, then choose partners that naturally become the data and execution layers.

Programmable identity and permission infrastructure for autonomous agent
organizations. Full product and architecture specs live in [`docs/`](./docs) —
start with [`docs/README.md`](./docs/README.md), then
[`01_PRD.md`](./docs/01_PRD.md) and
[`04_SYSTEM_ARCHITECTURE.md`](./docs/04_SYSTEM_ARCHITECTURE.md).

## The idea

Most stacks get built bottom-up: pick a chain, pick a database, pick a compute provider, then bolt on names at the end as a cosmetic alias. That ordering is backwards. Naming is not decoration — it is the thing every other layer has to agree on.

So pick identity first. Everything downstream then has one job: be reachable *from a name*.

## Why identity is the load-bearing choice

An ENS name is not a string. It is:

- **An owned object.** A name is an NFT. Ownership is transferable, delegable, and expirable. Whoever holds it is the author of everything it points at — authorship is settled without a separate account system.
- **A key/value store.** Text records let a name carry arbitrary namespaced metadata, not just an address. That is the extension point the whole stack hangs off.
- **A pointer.** `contenthash` was designed to point a name at content-addressed data. A name resolving to a CID is the native pattern, not a workaround.
- **Hierarchical.** Subnames give you scoping and versioning for free. `v1.thing.eth` and `v2.thing.eth` are the same primitive, not a new mechanism.
- **Resolvable from anywhere.** Any client, any contract, any script can go from name to records with no registration, no API key, no permission.

Pick this first and you inherit ownership, addressing, namespacing, versioning, and discovery in one decision. Every layer you add afterward is a smaller decision than it would have been.

## The selection test

Once identity is fixed, partners are not chosen by taste. They're chosen by a test:

> **Can an ENS record point directly at it, with no glue?**

That splits candidates into three buckets:

| Verdict | What it looks like |
|---|---|
| **Natural fit** | An ENS record *is* the address of the thing. Resolve the name, you have the pointer. Nothing else to look up. |
| **Workable** | The name points at something that points at it. One hop of indirection, no side registry. |
| **Forced** | You need a separate registry keyed on something other than the name. The name is now decoration again — reject it. |

The test is deliberately narrow. It is what stops the stack from sprawling: anything that fails it would have quietly reintroduced a second identity system, and two identity systems is the problem this design exists to avoid.

## What falls out

**Data layer — where the content lives.**
Content-addressed storage passes the test immediately, because content addressing and name resolution were built to compose. A CID or root hash sits in a record; resolving the name hands you the data pointer. There is no index to maintain and no gateway that owns the mapping. Anything requiring a mutable server-side lookup table fails — it moves the source of truth off the name.

**Execution layer — what runs, and who gets paid.**
Same test, applied to the call path. A record naming the endpoint, the contract, or the payee means the name is the invocation handle *and* the settlement handle. Payment rails that key off an address inherit this for free, because the name already resolves to one. Anything demanding its own account registry fails — a separate account means a separate identity, which defeats the premise.

**The onchain direction.**
The interesting consequence is that a namehash is `bytes32` — it fits in a contract. If a contract can map a namehash to an implementation, ENS names become callable from Solidity, not just from clients. The identity layer stops being an off-chain convenience and becomes part of the execution path.

## Layering

```
        identity          ENS name
                             │
                     resolve records
                             │
              ┌──────────────┴──────────────┐
              │                             │
            data                        execution
     record -> content pointer    record -> endpoint / contract / payee
              │                             │
        content-addressed              invoke + settle
```

One resolution step. Both layers hang off it. Neither knows about the other.

## What this rules out

The design is only meaningful because of what it rejects:

- No central registry to register with.
- No API keys, no allowlists, no onboarding.
- No parallel account system — if a partner needs one, it's the wrong partner.
- No component that only works through one gateway or one indexer.

If a piece can't be reached by resolving a name, it doesn't go in the stack.

## What would prove this wrong

Worth stating plainly, since the thesis is falsifiable:

- If resolution latency or cost makes name-first lookup impractical at real request volume, the layering is elegant but unusable.
- If the natural-fit set turns out to be too small to build anything real with, the test is too strict and needs loosening.
- If mutable state ends up mattering more than content-addressed state for the actual use case, the data layer argument weakens considerably.

None of these are settled yet.

## The landing page

The site is a Next.js app whose main job, besides stating the thesis, is to be
auditable. The build log on the page is not a graphic — it is the GitHub REST
API read at request time and re-validated every 60 seconds.

```bash
pnpm install
pnpm dev          # http://localhost:3111
```

**How the transparency works**

- Every square in the calendar is a real day, counted from real commits.
- Clicking a square lists that day's commits: subject, author, UTC time, and the
  short SHA linking to the commit on GitHub.
- Commits GitHub reports as signature-verified are badged `verified`.
- The exact payload the page renders is served unmodified at
  [`/api/activity`](http://localhost:3111/api/activity), so anyone can diff what
  the page claims against what GitHub returns.

Nothing is seeded, sampled, cached across deploys, or hand-edited. If the API is
unreachable the page says so rather than falling back to placeholder numbers.

**Pointing it at a different repo**

Copy `.env.example` to `.env.local` and set:

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_OWNER` | `musashi0x` | Repo owner |
| `GITHUB_REPO` | `nymspace` | Repo name |
| `GITHUB_BRANCH` | default branch | Optional branch pin |
| `GITHUB_TOKEN` | — | **Required in production.** Raises the API limit from 60 to 5,000 req/hr |

**Deployment**

The site is deployed on Railway and redeploys automatically on every push to
`main`. Commit data refreshes on its own too: the page re-reads the GitHub API
60 seconds after the last read, so new commits appear without a redeploy or any
manual step.

One thing that does need setting up by hand: `GITHUB_TOKEN` must be set in the
Railway environment. Unauthenticated GitHub API access is 60 requests/hour for
the whole server — shared across every visitor — which a public page will
exhaust quickly. With a token it is 5,000/hour. A classic token with **no
scopes** is enough for a public repo. Without one, the page will intermittently
show "Commit data unavailable" instead of the graph.

It tracks this project's own repo,
[`musashi0x/nymspace`](https://github.com/musashi0x/nymspace), so every commit
pushed to `main` shows up in the calendar within a minute. Override the two
variables to point it elsewhere.

## What is built

Three agents live under `nymspace.eth` on ENSv2 Sepolia, and every claim below
is checked by a gate that runs against the real systems rather than a fixture.

```
                    nymspace.eth  (ENSv2 Sepolia · 11155111)
                          │
                UserRegistry proxy 0xd0D823…
                          │
        ┌─────────────────┼─────────────────┐
   research.           trader.           deploy.
        │
        │  PermissionedResolver 0x45DaD5…  (one resolver, all three names)
        │     agent-context             ← organization writes
        │     agent-endpoint[mcp]       ← controller writes  (record-scoped grant)
        │     agent-registration[…]     ← organization only  (ENSIP 25)
        │
        ├──── ERC 8004 IdentityRegistry 0x8004A8…  (Base Sepolia · 84532)
        │       agent 9209, registration file claims research.nymspace.eth
        │            │
        │            └── Agent0 subgraph ──→ discovery, ranked by Gemini
        │
        └──── Privy wallet 0x310207…  under one amount policy
```

The load-bearing detail is the resolver row. `agent-endpoint[mcp]` is granted to
the agent's controller at `resource(namehash, partHash(key))` — one record, not
the name — so the same key that writes it is refused on `agent-context` and on
the ENSIP 25 binding by the contract itself, not by an application check.

### Sponsor mapping

| Track | What it does here | Proof |
|---|---|---|
| **ENS** | ENSv2 subnames with record-scoped delegation through a PermissionedResolver; ENSIP 26 records; ENSIP 25 binding verified at runtime with a seven-state model | Gate A, 10/10 |
| **The Graph** | Live Agent0 ERC 8004 queries, normalisation that preserves absence, an LLM ranking whose every citation is validated against the response | Gate B, 7/7 |
| **Privy** | One amount policy on a server wallet; a denied payment and an allowed one in the same run, with the limit read from the live policy | Gate C, 10/10 |

### Transaction evidence

All hashes are from committed gate artifacts under `evidence/` and
`packages/*/evidence/`.

| What | Chain | Hash |
|---|---|---|
| Register `research.nymspace.eth` | Sepolia | `0x77948c09394877467ad77c178f966cd006b08077739d7d90a5b13dd91c83744f` |
| Grant `SET_TEXT` on `agent-endpoint[mcp]` | Sepolia | `0x036a463931f93d47b5dbb86004cedf11f0668f2ced6b6b33437e99c9d53d9c35` |
| ERC 8004 registration (agent 9209) | Base Sepolia | `0x1750f2f5c77d7b3c951cd0a1ab41a40a42f444bb73081e5376a8c9d588528c9f` |
| ENSIP 25 record, organization-signed | Sepolia | `0xb05d7c58e114299d38fd4d73628df4a365561a7b2ed9467e5be09d9600abf715` |
| Controller write, permitted | Sepolia | `0x5cf1b408e93816c0486ebd51845c50096fc0542c63e0fd42908595a99307f110` |
| Revoke, then re-grant (E6) | Sepolia | `0x233d5583…` / `0x4189dc01…` |
| Payment executed inside policy | Base Sepolia | `0xff4989cdae039f5a7e75b13be49b7b6eda9198c13e75321b74c852cb24b99ded` |

The two denials have no hashes, which is the point. The controller's write to
the ENSIP 25 key reverts with the resolver's own
`EACUnauthorizedAccountRoles`, and the over-limit payment returns Privy's
`RPC request denied due to policy violation` without broadcasting anything.
A denial that reached a chain would not be a denial.

### The unemancipation point

The organization retains root roles on the parent registry and can reclaim any
agent subname. That is deliberate and the demo says so out loud rather than
letting a judge discover it: an organization that cannot revoke a compromised
agent's identity has delegated authority it can never take back. Emancipation
is a later decision, and this is the state before it.

### Running the gates

```bash
docker compose up -d                       # postgres on 5433
pnpm --filter @nymspace/store db:migrate
pnpm check:credentials                     # Gate 0 — every provider, real round trip
pnpm check:addresses                       # ENSv2 addresses vs the canonical page
pnpm provision:fleet                       # three subnames, records, record-scoped grants
pnpm register:identity                     # ERC 8004 + ENSIP 25 binding
pnpm provision:wallet                      # Privy wallet under one amount policy
pnpm verify:acceptance                     # Gates A-D, three consecutive clean runs
pnpm audit:secrets                         # nothing committed, nothing in a bundle
```

`verify:acceptance` takes roughly two minutes per run and resets its streak on
any failure — three attempts of which two succeeded is not three consecutive
clean runs.

## License

MIT
