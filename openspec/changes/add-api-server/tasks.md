## 1. Enforce the react-server condition

Do this before moving any code. It is the constraint that already broke the ENSv2 spike script once, and a move made without it will be debugged as a bundling problem.

- [ ] 1.1 Add `scripts/check-server-conditions.ts` beside `scripts/check-env-declarations.ts`. It reads every workspace `package.json`, finds scripts invoking `tsx` or `node` against a source entrypoint, and fails naming any that omits `--conditions=react-server`
- [ ] 1.2 Expose it as a root `conditions:check` script, and run both checks from one `check` script so neither is remembered separately
- [ ] 1.3 Confirm it passes on `apps/api`'s `dev` and `start`, and confirm it fails when the flag is removed. A check that has never failed has not been tested
- [ ] 1.4 Add the spike script's future entrypoint to the rule's coverage, or note explicitly why `packages/ens` needs no change until the script exists

## 2. Move the activity endpoint

- [ ] 2.1 `git mv apps/web/lib/github.ts apps/api/src/lib/github.ts`, preserving history. It is the only real dependency the route has
- [ ] 2.2 `git mv` the activity route handler into `apps/api/src/routes/activity.ts` and adapt it to Hono. The logic must not be rewritten — the payload contract is the thing being preserved
- [ ] 2.3 Mount it under the version prefix and confirm the JSON body carries the same fields it carried when Next served it. Capture the before payload first, or the comparison is a guess
- [ ] 2.4 Declare `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` and `GITHUB_BRANCH` in both `turbo.json` and `.env.example`. All five are read by `lib/github.ts` today and appear in neither file, so a token change currently does not invalidate the build cache
- [ ] 2.5 Decide whether the GitHub token stays optional. It is an escape from the anonymous rate limit, not an auth requirement, so leaving it optional is defensible — but decide it rather than inherit it
- [ ] 2.6 Do not delete the Next route handler yet. It comes out in section 4, once something else is serving the page

## 3. Test the API

- [ ] 3.1 Add `vitest` to `apps/api` with a `test` script, matching how `@nymspace/core` and `@nymspace/ens` are wired, so `turbo run test` picks it up with no new task
- [ ] 3.2 Test routing through `app.fetch` with a constructed `Request`. No port is bound, so tests cannot collide under Turborepo's parallelism
- [ ] 3.3 Test the validation cases the spec names: a malformed registry address returns 400 naming the parameter, and `registry` without `agentId` returns 400 explaining they are required together
- [ ] 3.4 Test that an unknown path returns 404 in the same JSON error shape every other failure uses
- [ ] 3.5 Test CORS both ways — a configured origin comes back in the allow-origin header, and an unconfigured one does not. The negative case is the one that matters
- [ ] 3.6 Test that a thrown handler returns a generic 500 and does not put the detail in the body

## 4. Type the caller

- [ ] 4.1 Add a client module in `apps/web` built with `hono/client` over the API's exported `AppType`
- [ ] 4.2 Read the base URL from `NEXT_PUBLIC_API_URL`, already declared in both files, so a deployed frontend can point at a deployed API
- [ ] 4.3 Repoint `commit-activity.tsx` at the client and give it a stated error state for an unreachable API. A blank panel reads as a broken page
- [ ] 4.4 Delete the Next activity route handler, and confirm `apps/web` no longer contains one
- [ ] 4.5 Prove the type link: rename a route in `apps/api` and confirm `pnpm typecheck` fails in `apps/web`, then restore it. Do this once deliberately, as with the `server-only` guard

## 5. Verification

- [ ] 5.1 `pnpm typecheck` passes across every workspace member
- [ ] 5.2 `pnpm test` runs the API's tests alongside the package tests
- [ ] 5.3 `pnpm env:check` and the new conditions check both pass
- [ ] 5.4 With both servers running, the landing page renders and the activity panel shows the same data as before the move
- [ ] 5.5 With the API stopped, the landing page still renders and the panel shows its error state rather than a blank or a crash
- [ ] 5.6 `git log --follow` resolves history for both moved files

## 6. Close out

- [ ] 6.1 Resolve the open question on whether the browser calls the API directly or Next proxies it. The CORS scenarios assume direct; if that flips, those scenarios change with it
- [ ] 6.2 Update `docs/04_SYSTEM_ARCHITECTURE.md`, which still says not to introduce a separate backend. It is not wrong, it is superseded, and leaving it unamended means the next reader finds two documents disagreeing
- [ ] 6.3 If this change runs long, land sections 1 through 3 and defer section 4. The move and the check are what unblock parallel work; the typed client is what makes it pleasant
