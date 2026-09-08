## Context

`apps/api` already exists, on Hono, with `/health` and one derived-key route, verified end to end. What it does not have is a route with real behaviour, tests, a typed caller, or a spec that permits it to exist. This change closes those four gaps rather than designing the server from scratch.

Three constraints shape the work.

The first is the one that cost the most to find. The `server-only` npm package exports `{"react-server": "./empty.js", "default": "./index.js"}`, and `index.js` throws at module scope. Next resolves the `react-server` condition for its server graph and the throwing module for client bundles, which is exactly the build-time guard `monorepo-workspace` asks for. Every other consumer — a plain Node process, a `tsx` script — also resolves the throwing module, so importing `@nymspace/ens` outside Next dies with "This module cannot be imported from a Client Component module" in a process that has no components at all. This was already broken for `packages/ens/scripts/spike-ensv2.ts`, which the scaffold was built to enable, before Hono existed.

The second is that `docs/04_SYSTEM_ARCHITECTURE.md` argues against a second server and the scaffold's D1 agreed with it. That argument was overruled deliberately, not refuted. The design's job is to keep the overrule cheap to reverse.

The third is timing. `docs/14_EXECUTION_PLAN.md` reserves Day 1 for the ENSv2 permission gate, and U1 through U3 are still unstarted. This change competes with that gate for the same hours, so it is scoped to what makes the split real and safe, and nothing more.

## Goals / Non-Goals

**Goals:**

- One implementation of each integration, consumed identically by both servers.
- A route with real behaviour running on the API, so the split is proven on something that can actually break.
- Route changes that fail at typecheck in the frontend, not at runtime in the browser.
- The `react-server` condition enforced by a check rather than by memory.
- A path back to one server that costs a deletion, not a migration.

**Non-Goals:**

- Moving any domain logic. The packages are already correct and are not touched.
- Authentication, rate limiting, or request signing. Nothing behind the API is user-scoped yet.
- Deployment, Docker, or CI configuration.
- A schema-validation library. The two validations needed are a hex-address regex and a both-or-neither pair; a dependency for that is not yet earned.
- OpenAPI generation. The typed client covers the only consumer that exists.

## Decisions

**D1: Keep `server-only` and pass `--conditions=react-server`, rather than replacing the guard.**

An internal guard package was built and rejected during implementation. It exported `{"browser": throw, "default": empty}`, which fixed Node but downgraded the client violation from a build error to a runtime browser error — the client bundle contained the throwing module and failed only when a user loaded the page. The cause is structural: Next's SSR pass for a client component and a plain Node process are indistinguishable by export conditions, both being Node without `react-server`. No conditions map can separate them, so any guard that is inert in Node is also inert during SSR. `server-only` plus an explicit flag keeps the build-time error and makes non-Next processes work; the flag is the honest statement that this process is a server module graph. *Cost:* every non-Next entrypoint must carry it, which is why a check enforces it rather than a comment asking for it.

**D2: Version product routes, leave operational routes unversioned.**

`/v1/agents/...` and `/health`. The frontend is deployed separately from the API and the two will drift; a version prefix makes the drift explicit instead of silent. Health is not a product surface and versioning it would only make monitoring configuration stale.

**D3: Use `hono/client` for the typed caller, not a hand-written fetch wrapper or a generated SDK.**

The client derives from `typeof app`, which is already exported. A renamed route becomes a type error in `apps/web` with no build step, no generator, and no schema to keep in sync. *Alternative considered:* OpenAPI plus a generated client. Rejected because it adds a generation step to the dev loop for a benefit — non-TypeScript consumers — that nothing here has. *Alternative considered:* a plain `fetch` wrapper. Rejected because it is exactly the drift the change is trying to prevent, written by hand.

**D4: Move `/api/activity` rather than adding a new route to prove the split.**

A route that already works is the only honest test of a move. It has a real dependency (`lib/github.ts`), a real external call, and a component consuming it, so porting it exercises the parts a scaffold probe cannot. It is also low-risk: the landing page degrades to an error state rather than failing to render.

**D5: Test through `app.fetch`, never a listening socket.**

Hono's app is a fetch handler, so a test calls it directly with a `Request`. No port, no teardown, no collision between parallel package tests under Turborepo. This is why the spec requires it rather than leaving it to taste.

**D6: Enforce the condition with a script over `package.json` files, not a lint rule.**

The check reads every workspace `package.json`, finds scripts that invoke `tsx` or `node` on a source entrypoint, and fails when `--conditions=react-server` is absent. It sits beside `scripts/check-env-declarations.ts`, which solves the same class of problem — a constraint that is invisible until it bites — and can run in the same place.

## Risks / Trade-offs

- **Two deploy targets and two environment surfaces** → This is the real cost and it is not mitigated away. It is bounded instead: no domain logic lives in either server, so collapsing back to one is deleting `apps/api` and restoring one route file. The packages make the decision reversible, which is why they were built first.
- **CORS misconfiguration in a deployed environment fails only in the browser** → Server-to-server calls succeed while the frontend fails, so the error appears as a frontend bug. Mitigated by testing both the allowed and the rejected origin, which the spec requires as separate scenarios.
- **The `--conditions` flag is forgotten on a new entrypoint** → The resulting error names Client Components and will be debugged as a bundling problem. This is precisely what happened during implementation. Mitigated by D6; the check is the deliverable, not the documentation.
- **The environment drift check compares two files, not code against files** → `pnpm env:check` reconciles `turbo.json` with `.env.example` and passes while five variables the build actually reads appear in neither. Moving activity is the moment to declare them; a check that scans source for `process.env` reads is the real fix and is out of scope here.
- **`hono/client` types can degrade silently on a large route surface** → With enough routes, inference gets slow or gives up and the client's safety quietly weakens. Not a problem at this size. Worth rechecking when the API passes roughly twenty routes.
- **This change competes with the Day 1 ENSv2 gate** → Same trade the scaffold made. If it runs long, land the move and the check, and defer the typed client — the move is what unblocks parallel work, the client is what makes it pleasant.

## Migration Plan

1. Add the `--conditions=react-server` check and fix anything it flags, before moving code.
2. Move `lib/github.ts` and the activity handler into `apps/api` with `git mv`, keeping history.
3. Add API tests through `app.fetch`, and the `test` script so `turbo run test` picks them up.
4. Add the typed client in `apps/web` and repoint `commit-activity.tsx`, with an error state for an unreachable API.
5. Delete the Next route handler only once the component is consuming the API.
6. Verify the landing page renders with the API up, and degrades with it down.

Rollback is `git revert`. Nothing is deployed, and the payload shape is unchanged, so a revert restores a working page with no data migration.

## Resolved Questions

- **Whether the API should proxy or the browser should call it directly — resolved: directly.** A Next proxy would remove CORS and keep one public origin, at the cost of re-introducing the coupling this split exists to break: every API call would depend on the Next process, and the second server would be invisible to anything but Next. Direct also turned out cheaper than the design assumed, because the section 2 decision took CORS off the critical render path — the landing page server-renders from `@nymspace/github` and makes no browser call at all. A CORS misconfiguration therefore degrades an interactive feature rather than the page, which lowers the risk this design flagged. Both directions are tested.

- **Whether the activity endpoint's five environment variables should be required — resolved: all five stay optional, and all five are now declared.** `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` and `GITHUB_BRANCH` are in `turbo.json` and `.env.example`, so changing one invalidates the build cache; before this change they were in neither. The token stays optional because it lifts GitHub's anonymous rate limit rather than authorising anything, and the payload already reports upstream failure explicitly instead of returning empty data. `.env.example` says so, so the next reader does not have to infer it.

## Outcome

Sections 1 through 4 landed, so the deferral in task 6.3 was not needed and the typed client was not dropped.

Two things came out differently from the plan, both recorded against their tasks:

- **`lib/github.ts` went to a package, not to `apps/api`.** Applying section 2 showed the page calls `getActivity()` directly server-side and the component imports its types, so the file was never API-only — and app-owned domain logic would have violated this change's own new requirement. `packages/github` is the correction, and it made task 4.3 moot exactly as predicted.
- **Hono's RPC types needed the routes rewritten.** Route modules built with `new Hono()` then a separate `.get()` discard their types, and query parameters read inside a handler are invisible to the client. Chaining plus a `hono/validator` fixed both, and moved validation to the edge where the spec wanted it anyway.

One risk in this document became an incident rather than a hypothetical, though not the one expected. Not the `--conditions` flag — that check was written first and has held. A second agent working concurrently in the same repository reset the shared git index between an `add` and a `commit`, and later amended one of this change's commits out of existence. Recovered from the reflog and re-committed with `git commit --only`, which does not depend on the shared index. Worth a line in the risk list of anything that assumes one writer per working tree.
