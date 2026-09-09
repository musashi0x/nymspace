# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@apps/web/AGENTS.md

## Commands

pnpm 10 + Turborepo. Run from the repo root unless noted.

```bash
pnpm install
pnpm dev          # turbo run dev — web + api together
pnpm build
pnpm typecheck    # tsc --noEmit across every workspace
pnpm lint         # next lint (web only; no other package defines lint)
pnpm test         # vitest run across workspaces that define it
pnpm check        # env:check + conditions:check — the two custom invariants
```

`@nymspace/store` talks to a real Postgres, so `pnpm test` needs one running:

```bash
docker compose up -d                          # postgres on 5433, not 5432
pnpm --filter @nymspace/store db:migrate
pnpm check:credentials                        # Gate 0 — every provider, real round trip
```

Per-package and single-test:

```bash
pnpm --filter @nymspace/api dev            # tsx watch, port 3112
pnpm --filter @nymspace/web dev            # next dev
pnpm --filter @nymspace/ens test           # one package's suite
pnpm --filter @nymspace/ens test keys      # one file by name substring
pnpm --filter @nymspace/ens test -t "grants"   # one test by title
pnpm --filter @nymspace/ens generate:abis  # regenerate ENSv2 ABIs
pnpm --filter @nymspace/ens spike          # Day 1 ENSv2 authority spike
```

Tests live beside their source as `*.test.ts`. Only `@nymspace/api`, `@nymspace/core`, `@nymspace/ens`, and `@nymspace/store` have suites.

## The coordination store is not an authority

`@nymspace/store` (Drizzle + Postgres) holds identifiers, labels, provisioning progress, cached snapshots, and the activity log. It is **not** the source of truth for ENS identity, permissions, ERC 8004 trust, or Privy policy — those are read from their own systems on every request. `docs/09_DATA_AND_EVENT_MODEL.md` is the contract.

Two mechanisms keep that true as the schema grows, and both will fail your build rather than merely disagree with you:

- `ALLOWED_COLUMNS` in `packages/store/src/schema.ts` is a hand-maintained second list of every permitted column, checked against `information_schema` by `schema.test.ts`. Adding a column means editing that list on purpose, which is the review moment where "should the store hold this?" gets asked. It is deliberately not derived from the Drizzle tables — derived, it would assert the schema equals itself.
- Snapshot tables require a `NOT NULL fetched_at`, and `Snapshot<T>` is branded so `snapshot()` is the only way to build one. A cached value that reaches the interface without its read time is indistinguishable from a live read.

Schema changes are `pnpm --filter @nymspace/store db:generate` (writes SQL to `drizzle/`, committed) then `db:migrate`. Never `drizzle-kit push` — it reshapes tables with no reviewable diff.

## The `react-server` condition — read before adding any script

`packages/*` guard their entrypoints with `import "server-only"`, whose exports map is `{"react-server": empty, "default": throws-at-module-scope}`. Next resolves `react-server` for its server graph, so the guard works there for free. **Every other runtime does not**, and a guarded import outside Next dies with:

```
This module cannot be imported from a Client Component module.
```

— in a process that has no components at all. The message sends you to look at bundling; the actual fix is one flag.

So: any `tsx` or `node` script taking a source entrypoint must pass `--conditions=react-server`. Vitest gets the same thing via `ssr.resolve.conditions` **and** `externalConditions` (see `apps/api/vitest.config.ts`; `server-only` ships JS, so it is externalised and needs both). `pnpm conditions:check` fails the build when a script forgets the flag — that script is the enforcement, so don't route around it.

## Guarded vs unguarded — the package boundary

The split decides what a client component may import:

| Import | Guard | Contains |
|---|---|---|
| `@nymspace/core` | none | types, ERC 7930 encoder, `publicEnv` — safe in the browser |
| `@nymspace/core/env` | `server-only` | `serverEnv` — secrets, never client-importable |
| `@nymspace/ens` `/github` `/graph` `/privy` | `server-only` | all chain/API access |

Pure helpers a client needs go in `@nymspace/core`'s root export. Adding a secret to `env.public.ts` defeats the whole arrangement.

`env.public.ts` writes each `process.env.NEXT_PUBLIC_*` out in full rather than reading through a variable key, because Next only inlines statically analysable member expressions. Keep that shape.

Two ENSv2 proxy addresses (`ENSV2_PARENT_REGISTRY_ADDRESS`, `ENSV2_PERMISSIONED_RESOLVER_ADDRESS`) are deliberately absent from `serverEnv`'s required list — the spike deploys them, so requiring them would stop it bootstrapping its own outputs. `@nymspace/ens`'s `requireDeployed()` checks them at the top of a route instead.

## web ↔ api

Two servers, one set of packages. `apps/api` is Hono over web-standard `Request`/`Response`, the same primitives Next route handlers use, so a handler moves between them without a rewrite. Domain logic is imported from `packages/*`, never reimplemented — one blast radius when the ENSv2 beta moves.

`apps/web/lib/api.ts` builds a `hc<AppType>` client from the API's own exported type, so a renamed route is a compile error in the web app rather than a runtime 404. It imports from `@nymspace/api/app`, **not** the package root — the root is `index.ts`, which calls `serve()` at module scope. Keep that import pointed at `app`.

`apps/api/src/index.ts` is the process; `app.ts` is the application and binds no socket. Test against `app.ts`.

Not everything crosses the wire: the landing page's commit activity is server-rendered straight from `@nymspace/github`, the same package `/v1/activity` serves. No hop, no CORS.

## Environment

`turbo.json`'s `globalEnv` and `.env.example` must list the same variables. Turborepo hashes only what it is told about, so an undeclared variable means editing a contract address and getting a cached build compiled against the old one — which gets debugged as a contract bug, not a cache bug. `pnpm env:check` reconciles the two; add every new variable to both.

Ports: API `3112` (`API_PORT`), web expected at `3111` (`WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`). `WEB_ORIGIN` is required and parsed as a comma-separated CORS allowlist.

## Workspace packages ship TypeScript source

No build step, no `dist`. Consequences:

- `apps/web/next.config.ts` must list every package in `transpilePackages` — a missing one surfaces as a parse error inside `node_modules`, not a clear message.
- `apps/api/vitest.config.ts` inlines `/@nymspace\//` via `test.server.deps.inline`, since Vitest would otherwise externalise them like published deps.

## Specs

`docs/` holds the product and architecture specs and is the source of truth for intent — `docs/README.md` first, then `01_PRD.md` and `04_SYSTEM_ARCHITECTURE.md`. Code comments cite them by filename (e.g. `docs/19_ENV_AND_CONFIG.md`); when changing behaviour those docs describe, update them alongside.

`openspec/` drives spec-driven changes (`openspec/specs/` for capabilities, `openspec/changes/` for in-flight work), with `/opsx:*` commands under `.claude/commands/`.

## Commit messages — no co-author trailer

Do not add `Co-Authored-By: Claude ...` to commits in this repo. It makes GitHub render every commit as "hien-p and claude committed". The author and committer fields are already correct; the trailer was the only cause, and the four commits that carried it were rewritten and force-pushed on 2026-09-08.
