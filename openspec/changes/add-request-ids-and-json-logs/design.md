## Context

`apps/api` logs through two calls. `app.use("*", logger())` at `app.ts:85` prints `<-- GET /path` on arrival and `--> GET /path 200 12ms` on completion, and `errorHandler` calls `console.error(err)`. Railway captures stdout. Nothing ties a response to its log lines, and the one error line is a multi-line stack trace that Railway shows as separate entries.

Railway parses a log line that is a single-line JSON object. `message` is what it displays, `level` (`debug`, `info`, `warn`, `error`) sets severity, and every other key becomes an attribute queryable as `@key:value`, numeric ranges included (`@status:>=500`). JSON spread across lines is not parsed.

`hono/logger` accepts a `PrintFunc`, but that function receives the string the middleware already formatted (`--> GET /x 200 12ms`), so structured output through it means parsing that string back into fields.

The api-server spec requires the 500 body to be generic, with "the detail" going "to the server log rather than the body". That stays true: an id is not detail.

## Goals / Non-Goals

**Goals:**

- Any response, success or failure, can be matched to its log lines by one id.
- Every line the API process writes is a flat, single-line JSON object Railway can filter on.
- No failure in `apps/api` is discarded without a log line, including failures after the response.
- Tests assert on log output directly.

**Non-Goals:**

- Rendering the id in the console UI.
- Propagating an id from the web app's server components into API calls. The API accepts one if sent; nothing sends one yet.
- Logging from `scripts/` or `packages/*`. Scripts are CLIs with their own output, and package code runs inside a request whose handler logs.
- A logging library, environment-configured levels, sampling, or shipping logs anywhere but stdout.
- Tracing (spans, OpenTelemetry).

## Decisions

### D1. Own middleware instead of `hono/logger`

About twenty lines reading method, path, status and elapsed time directly and writing one object.

Alternatives considered: `hono/logger` with a `PrintFunc`, which parses its own formatted string back apart and still emits two lines per request; pino with `hono-pino`, which adds a dependency and a transport for what is one `JSON.stringify` per request. Revisit pino if volume or redaction needs grow.

### D2. One line per request, on completion

`hono/logger`'s arrival line says only that a request started, and doubles the volume. The request line is written after `await next()`. By then Hono has already run `errorHandler` for a thrown error and set the response, so a 500 is logged with status 500. That ordering is Hono's compose behaviour, and a test pins it rather than the code assuming it.

A request killed mid-flight (process restart) writes no request line. Accepted: the failures that matter get their own lines (D3, D10).

### D3. Fields

Request line: `level`, `message`, `requestId`, `method`, `path`, `status`, `durationMs`. `message` is `"<METHOD> <path> <status>"`, so the unfiltered explorer still reads like an access log.

`path` is `c.req.path`, without the query string. Today's query strings are activity filters, but a query parameter is where a future identifier would travel, and the line should not start carrying one without anyone deciding it should.

No timestamp field: Railway stamps every line on capture.

Level: 5xx `error`, 4xx `warn`, otherwise `info`. A successful `GET /health` logs at `debug`. Railway polls it during a deploy, so those lines are noise until a deploy fails, and then they are the evidence.

Error line from `errorHandler`: `level: "error"`, `message: "unhandled <ErrorName>"`, `requestId`, `method`, `path`, `errorName`, `errorMessage`, `stack`. `JSON.stringify` escapes the stack's newlines, so it stays one line and one Railway entry.

### D4. Flatness is a type

`type LogFields = Record<string, string | number | boolean | undefined>`. A nested object or an array does not compile. `undefined` is allowed so callers can pass optional values, and `JSON.stringify` drops them.

The fixed keys (`level`, `message`, `requestId`) are written after caller fields, so a caller cannot overwrite them.

Alternative considered: accept nested objects and flatten at write time into dotted keys. Rejected because it hides the emitted shape from the caller, and the shape is the contract Railway queries against.

### D5. A request-bound logger on `c.var.log`

The logging middleware sets `c.var.log`, a logger with `requestId` already bound. Handlers and `errorHandler` call `c.var.log.error(message, fields)`. Its type sits beside `DepsEnv`, so every route reading `c.var.deps` can read `c.var.log`.

Work a handler starts without awaiting captures `c.var.log` into a local before the handler returns, the same way the create route already captures `deps`.

### D6. Sink injected through `createApp`

`createApp(config, deps?, sink?)`. A sink is `(line: string) => void`. The default writes `line + "\n"` to stdout.

Errors go to stdout too. `level` carries severity, and one stream keeps lines in order.

A positional third argument leaves the seven existing `createApp` call sites untouched. Alternative considered: an options object `{ deps, sink }`, which touches every call site for no behaviour change.

`index.ts` writes its startup line through the default sink.

### D7. Request id from Hono's middleware, inbound id trusted

`hono/request-id` runs before everything else, so logging, CORS and handlers all see the id. It reuses an inbound `X-Request-Id`, bounds its length (255 by default), and otherwise generates a UUID.

Trusting the inbound id lets a caller correlate across systems: a future web server forwarding its own id, or an operator reproducing a request with curl and a known id. Nothing authorizes on it. A client can choose a misleading id, which costs a confusing log search, not a security boundary. A hostile value cannot break a log line, because every line is written through `JSON.stringify`.

Alternative considered: always generate and ignore inbound ids. Rejected because it removes cross-system correlation and buys no security.

### D8. The id in every error body

The 500 body gains `requestId`, and so do the 404 and `HTTPException` bodies, because the api-server spec requires a 404 to use "the same JSON error shape every other failure uses". The id in the body is what a person copies off an error screen, which is the case the header alone does not serve.

Validation 400s from `@hono/zod-validator` keep their own shape and are not changed here. They still carry the header.

### D9. CORS

`productCors` gains `exposeHeaders: ["x-request-id"]`. `protocolCors` adds `x-request-id` to its existing `exposeHeaders` and to its `allowHeaders`, so a browser MCP client can send one.

`productCors` sets no `allowHeaders`, and Hono's CORS middleware then reflects the preflight's requested headers, so an inbound `X-Request-Id` is already allowed there. A test pins that rather than this document asserting it.

### D10. The provisioning catch

Order matters. The provisioning error is logged first, as `provisioning stopped` with `agentId`, `ensName`, `errorName`, `errorMessage` and `stack`, before either store write is attempted. Then `setProvisioning` and `recordEvent` each keep their own catch, and each catch logs `could not record provisioning failure` naming the write that failed and its error. If Postgres is the failure, the first line already exists.

The 202's request line was written long before any of this. The shared `requestId` is what connects them.

Noticed, not changed: that `recordEvent` records `ens.action.denied` with an all-zero transaction hash to satisfy the `ens` evidence rule for a failure that has no transaction. That is a store-contract question for its own change.

## Risks / Trade-offs

- [Stack traces and error messages become indexed attributes in Railway] → They already reached the same stdout through `console.error`, so exposure is unchanged and only searchability grows. The body still carries none of it, and the existing no-secret test keeps asserting that.
- [Inbound ids can be spoofed or collide] → Used for correlation only, never authorization. Generated ids are UUIDs, so collisions come only from callers choosing their own.
- [A route mounted without the middleware would have no `c.var.log`] → The middleware is `app.use("*")`, as `logger()` is today. Tests assert a request line for a route without deps (`/health`), one with deps (`/v1/activity`), and an MCP route.
- [Access-log volume] → Half of `hono/logger`'s two lines per request, with `/health` at `debug`.

## Migration Plan

Additive, shipped as a normal Railway deploy of the api service. Operators who searched the old `-->` text switch to `@requestId:`, `@level:error` and `@status:>=500`, which `docs/22_DEPLOYMENT.md` documents. Rollback is a revert. No data or schema is involved.

## Open Questions

None open.

- Resolved during implementation, from `hono/dist/middleware/request-id/request-id.js` at 4.11: an inbound id is replaced with a generated UUID, not truncated, when it is longer than 255 characters **or** contains any character outside `[A-Za-z0-9_=-]`. The character rule is stricter than D7 assumed and makes log injection through the id impossible before `JSON.stringify` is even reached. `app.test.ts` pins both rejections.
- Found during implementation: `routes/agent-mcp.ts` hand-copied `notFoundHandler`'s 404 shape, so its 404 went without `requestId` until a test caught it. It now calls `c.notFound()`, which answers with the app's own handler. `connect-to-agent-mcp-endpoints` made the same fix independently, and threw the 503 as an `HTTPException`; that version was kept on rebase, so `errorHandler` gives the 503 its `requestId` without the route building a body. The spec's failure-body scenario names the 503.
