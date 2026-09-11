## Why

A 500 from the API answers `{"error":"internal error"}` and prints a stack trace to stdout, and nothing connects the two. When the console shows an error, the operator has a timestamp and a guess. The request log is `hono/logger`'s plaintext (`--> GET /v1/agents 500 41ms`), which Railway's log explorer can only text-search, and a provisioning run that fails after its 202 can fail twice over without either failure reaching any log: `apps/api/src/routes/agents.ts` ends both of its recovery writes in `.catch(() => {})`.

## What Changes

- **Every request gets an id.** `hono/request-id` runs first in `createApp`. It reuses an inbound `X-Request-Id` (Hono's default, length-capped) or generates one, and returns it on every response in `X-Request-Id`.
- **Browsers can read it.** Both CORS policies expose `X-Request-Id`. Today `productCors` exposes nothing, so the web client could not read the header cross-origin even if it were sent.
- **Error bodies carry it.** The 500 body becomes `{ "error": "internal error", "requestId": "…" }`. 404 and `HTTPException` bodies gain the same field, so every failure keeps one shape. The id is a correlation handle and carries no detail, so the rule that failures do not leak internals still holds; its scenario is reworded to say so.
- **`hono/logger` is replaced by a JSON request logger.** One line per request, written when the response is ready: `level`, `message`, `requestId`, `method`, `path`, `status`, `durationMs`, as a flat object on a single line. That is the format Railway parses into filterable attributes (`@requestId:…`, `@status:>=500`). Level follows status: 5xx `error`, 4xx `warn`, otherwise `info`, with a successful `/health` at `debug`.
- **Flat is a type, not a convention.** Log fields are `Record<string, string | number | boolean | undefined>`. A nested object does not compile.
- **Unhandled errors are logged as JSON under the request's id.** `errorHandler`'s `console.error(err)` becomes one `error` line carrying `errorName`, `errorMessage` and `stack` beside the same `requestId` as the request line.
- **Handlers get a request-bound logger at `c.var.log`.** It stamps the request id on every line, so no handler threads the id by hand.
- **The background provisioning failure is logged instead of swallowed.** The original error is logged first, before any store write is attempted, and each `.catch(() => {})` becomes a catch that logs the write's own failure. If Postgres is what failed, the log still says so.
- **The log sink is injectable.** `createApp` takes an optional sink the way it takes `deps`, so tests assert on emitted lines instead of spying on `console`. The default writes to stdout, and the startup line in `index.ts` goes through it too.

Out of scope: showing the request id in the console UI (the body field makes it possible; rendering it is a web change), forwarding an id from Next server components to the API, logging in `scripts/` and `packages/*`, and shipping logs anywhere other than Railway's stdout capture.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-server`: adds a request id on every response and in every error body, a single-line flat JSON process log, and the rule that failures (including failures in work a request starts after answering) reach that log under the request's id. The "Failures do not leak internals" scenario is reworded to allow the id in the 500 body.

## Impact

- **Code**: new `apps/api/src/log.ts` (field type, sink, request-bound logger, logging middleware). Edits to `apps/api/src/app.ts` (middleware order, CORS headers, error and not-found bodies, `createApp` signature), the env type beside `DepsEnv` in `apps/api/src/deps.ts` (the `log` and `requestId` variables), `apps/api/src/routes/agents.ts` (the provisioning catch), and `apps/api/src/index.ts` (startup line).
- **Tests**: `apps/api/src/app.test.ts:635` changes from `toEqual({ error: "internal error" })` to include `requestId`, keeping its no-secret assertions. Any other exact-match assertion on a 404 or `HTTPException` body needs the same field. New tests cover the id, the line shape, and the provisioning catch.
- **API contract**: one additive field in error bodies and one new response header. No route changes, so the typed `hc` client is unaffected.
- **Dependencies**: none. `hono/request-id` ships inside `hono`, already at `^4.11.7`.
- **Store and environment**: none. No column, migration, or variable, so `ALLOWED_COLUMNS`, `turbo.json` and `.env.example` are untouched.
- **Docs**: `docs/10_API_CONTRACT.md` gains the error body shape and the header. `docs/22_DEPLOYMENT.md` gains how to find a request in Railway's log explorer.
