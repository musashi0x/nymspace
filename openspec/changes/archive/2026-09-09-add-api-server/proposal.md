## Why

The `monorepo-workspace` capability says the Next.js application is the only server, and `apps/api` now exists on Hono anyway. The principal chose a dedicated backend after the scaffold landed; the spec has not caught up, so the archived requirement and the repository disagree. This change closes that gap and finishes the job the implementation left half-done — the API serves derived keys but nothing real, `/api/activity` still lives in the Next app, and `apps/web` calls the API through no client at all.

It also records a constraint discovered while wiring Hono, which is the more valuable half. The `server-only` package's exports map answers the `react-server` condition and no other, so every non-Next consumer of a guarded package dies at import with a message about Client Components. That already broke the ENSv2 spike script the scaffold was built to enable; it was found by accident, and nothing in the spec prevents the next person from rediscovering it the same way.

## What Changes

- **BREAKING (spec-level)**: replace the `monorepo-workspace` requirement "The web application is the only server" with one permitting a dedicated API application, while keeping the constraint that matters — domain logic lives in packages, and neither server reimplements it.
- Add an `api-server` capability covering the Hono application's HTTP contract: health, versioned routes, CORS restricted to configured origins, a uniform JSON error shape, and validation that rejects malformed input before any domain call.
- Move `/api/activity` from `apps/web` to `apps/api`, and have the Next app consume it through the API rather than serve it. This is the first proof the split works on a route that already has real behaviour rather than a scaffold probe.
- Add a typed client for `apps/web`, generated from the Hono app type via `hono/client`, so a route rename breaks the frontend at typecheck rather than at runtime.
- Record the `--conditions=react-server` requirement in the spec, and add a check that fails when a non-Next entrypoint omits it, so the constraint is enforced rather than remembered.
- Add tests for the API's routing and validation, and give `apps/api` a `test` script so the existing `turbo run test` task covers it.

## Capabilities

### New Capabilities

- `api-server`: the dedicated HTTP surface — how routes are versioned and namespaced, how origins are restricted, how errors and validation failures are shaped, how the process is configured, and how the web application calls it with types intact.

### Modified Capabilities

- `monorepo-workspace`: the "web application is the only server" requirement is replaced by one that permits a dedicated API application and states what both servers must share. The "Server-only code cannot reach the browser" requirement gains a scenario covering non-Next consumers, because the guard as specified is satisfiable in a way that breaks every script and standalone service.

## Impact

- **Moved**: `apps/web/app/api/activity/route.ts` and its `lib/github.ts` dependency to `apps/api`. The `CommitActivity` component's fetch target changes with it.
- **New**: `apps/api` route modules and tests, a typed client module in `apps/web`, a check that non-Next entrypoints pass `--conditions=react-server`.
- **Modified**: `apps/web/components/commit-activity.tsx` to call the API; `turbo.json` and `.env.example` for any variable the move introduces.
- **New dependencies**: none expected. `hono` and `@hono/node-server` are already installed; the typed client ships inside `hono`.
- **Not affected**: the four domain packages. They already carry no Next types, which is why the API could import them unchanged — the property this change now writes down and tests rather than assumes.
- **Risk**: the two servers become two deploy targets and two environment surfaces. `docs/04_SYSTEM_ARCHITECTURE.md` argued against exactly this, and that argument is not wrong, it was overruled. The mitigation is that no domain logic moves, so collapsing back to one server later is deleting `apps/api` and restoring one route file.
