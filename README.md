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
API read at request time and re-validated every five minutes.

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
| `GITHUB_TOKEN` | — | Optional; raises the API limit from 60 to 5,000 req/hr |

It tracks this project's own repo,
[`musashi0x/nymspace`](https://github.com/musashi0x/nymspace), so every commit
pushed to `main` shows up in the calendar within five minutes. Override the two
variables to point it elsewhere.

## Push access

This repository is pushed **only** by the `hien-p` GitHub account. Several
accounts are authenticated on the primary dev machine and only `hien-p` has
write access here, so the rule is enforced in config rather than left to memory:

| Setting | Value |
|---|---|
| `user.name` | `hien-p` |
| `user.email` | `70145901+hien-p@users.noreply.github.com` |
| `origin` | `https://hien-p@github.com/musashi0x/nymspace.git` |
| `core.hooksPath` | `.githooks` |

The username in the remote URL is what makes the `gh` credential helper hand
back `hien-p`'s token instead of whichever account happens to be active.
[`.githooks/pre-push`](./.githooks/pre-push) then refuses the push if the
identity, the remote, or any outgoing commit's author is not `hien-p`.

After cloning, run:

```bash
git config core.hooksPath .githooks
```

## Status

Early. The README states the architectural position and the site makes the work
on it verifiable; the stack itself is not built yet.

The prior work this generalizes from is [`skillname`](https://github.com/hien-p/Skillname) — ENS names as the import statement for AI skills, where one name resolved to one callable function. That project made the specific case. This one is the general form of the same bet.

## License

MIT
