## Why

The repository is a single Next.js application at its root. The work described in `docs/` needs the same domain logic in two places at once: the ENSv2 spike runs as a script with no HTTP server, and the product runs it behind route handlers. Task 9.1 of the `ensv2-authority-spike` change already calls for extracting an `EnsService` so that ENSv2 beta churn has one blast radius, which `docs/17_RISKS_AND_FALLBACKS.md` Risk 1 requires. A flat repository cannot express that boundary.

A pnpm workspace with Turborepo gives it: domain packages that both a script and a route handler can import, one dependency graph, and cached task runs. `pnpm-workspace.yaml` already exists but carries only `ignoredBuiltDependencies`, so the workspace is dormant rather than absent.

This change does not add a second server. `docs/04_SYSTEM_ARCHITECTURE.md` says not to introduce a separate backend framework unless required, and nothing in the PRD requires one: every secret-bearing call is request-scoped and Next.js route handlers are already server-side. The backend is Next.js. The packages are process-agnostic, so a standalone service can be added later without moving domain code.

## What Changes

- Enable the pnpm workspace by adding `packages: ["apps/*", "packages/*"]` to the existing `pnpm-workspace.yaml`.
- **BREAKING (developer-facing)**: move the Next.js application from the repository root to `apps/web` using `git mv`, preserving file history. `app/`, `components/`, `lib/`, `public/`, `next.config.ts`, `components.json`, `postcss.config.mjs`, and `next-env.d.ts` all move.
- Add Turborepo with a task graph covering `dev`, `build`, `typecheck`, `lint`, and `test`, and with every environment variable from `docs/19_ENV_AND_CONFIG.md` declared so cache keys are correct.
- Create four domain packages: `@nymspace/core`, `@nymspace/ens`, `@nymspace/graph`, `@nymspace/privy`.
- Ship packages as TypeScript source rather than built output, consumed through `transpilePackages` in Next and directly by `tsx` in scripts, so no build step sits inside the dev loop.
- Add `tsconfig.base.json` at the root; each app and package extends it. The `@/*` path alias stays scoped to `apps/web` and packages reference each other by package name only.
- Guard every server-only package entrypoint with `import "server-only"`, making an accidental client import a build error instead of a leaked credential.
- Add a validated environment module in `@nymspace/core` that separates `serverEnv` from `publicEnv` and fails fast on missing required values.
- Update `CLAUDE.md`'s `@AGENTS.md` import, because `next dev` regenerates that file relative to the Next package and it will move to `apps/web/AGENTS.md`.

## Capabilities

### New Capabilities

- `monorepo-workspace`: the repository's build and dependency topology — how applications and domain packages are separated, how tasks are orchestrated and cached, how configuration is shared, and how server-only code is prevented from reaching the browser.

### Modified Capabilities

None. `openspec/specs/` is empty; `ensv2-authority` is proposed but not yet archived, so it has no baseline spec to amend. The overlap with that change is handled as a sequencing dependency rather than a spec delta.

## Impact

- **Moved**: the entire Next.js application, to `apps/web`. Import paths inside it are unchanged because `@/*` moves with it.
- **New**: `turbo.json`, `tsconfig.base.json`, four package directories, root scripts that delegate to `turbo`.
- **New dependencies**: `turbo` and `tsx` as root development dependencies.
- **Renamed**: the root package from `ens_project` to `nymspace`, marked private.
- **Depends on this change**: `ensv2-authority-spike`. Its section 1 currently creates a flat layout — `scripts/spike-ensv2.ts`, a root `.env.example`, an unplaced "typed chain config module". Those become `packages/ens/scripts/spike-ensv2.ts` and `packages/core/src/env.ts`, and its setup section is rewritten to assume the workspace exists.
- **Cost**: this lands before the ENSv2 Day 1 gate and competes with it for time. Accepted deliberately by the principal after being shown the trade.
- **Not affected**: `.githooks/pre-push` and the `hien-p` push identity, which are git configuration and independent of directory layout.
