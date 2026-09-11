## 1. The log module

- [x] 1.1 Create `apps/api/src/log.ts` with `LogFields = Record<string, string | number | boolean | undefined>`, a `Sink = (line: string) => void`, and a default sink that writes `line + "\n"` to stdout (design D4, D6)
- [x] 1.2 Add a request-bound logger with `debug`, `info`, `warn` and `error`, each taking `(message, fields?)`, that writes caller fields first and `level`, `message`, `requestId` last so they cannot be overwritten (D4, D5)
- [x] 1.3 Add `apps/api/src/log.test.ts`: a line parses as one JSON object; a value containing a newline or a quote still yields one line; fixed keys win over caller fields; `undefined` fields are dropped; a nested object in `LogFields` fails typecheck (`@ts-expect-error`)

## 2. Request id and request logging

- [x] 2.1 Mount `requestId()` from `hono/request-id` as the first middleware in `createApp`
- [x] 2.2 Add the logging middleware to `log.ts`: set `c.var.log`, `await next()`, then write one line with `method`, `path` (`c.req.path`, no query string), `status`, `durationMs`; level from status, successful `GET /health` at `debug` (D2, D3)
- [x] 2.3 Replace `app.use("*", logger())` with it and remove the `hono/logger` import
- [x] 2.4 Give `createApp` an optional third `sink` parameter, defaulting to stdout (D6)
- [x] 2.5 Type `c.var.log` and `c.var.requestId` beside `DepsEnv` so routes and `errorHandler` can read them without casts (D5)
- [x] 2.6 Add `x-request-id` to `productCors.exposeHeaders`, and to `protocolCors.exposeHeaders` and `allowHeaders` (D9)
- [x] 2.7 Route `index.ts`'s startup line through the default sink as a JSON line with `port`

## 3. Error responses

- [x] 3.1 In `errorHandler`, replace `console.error(err)` with `c.var.log.error("unhandled <ErrorName>", { method, path, errorName, errorMessage, stack })` (D3)
- [x] 3.2 Add `requestId` to the 500 body, the `HTTPException` body, and `notFoundHandler`'s body (D8)
- [x] 3.3 Confirm no `console.*` call remains in `apps/api/src` outside tests

## 4. The provisioning catch

- [x] 4.1 In `apps/api/src/routes/agents.ts`, capture `c.var.log` beside `deps` before `void provisionAgent(...)`
- [x] 4.2 In the `.catch`, log `provisioning stopped` with `agentId`, `ensName`, `errorName`, `errorMessage`, `stack` before either store write (D10)
- [x] 4.3 Replace both `.catch(() => {})` with catches that log `could not record provisioning failure`, naming the write (`setProvisioning` or `recordEvent`) and its error

## 5. Tests

- [x] 5.1 Update `app.test.ts:635` to expect `{ error: "internal error", requestId: <header value> }`, keeping the assertions that the secret and `PRIVY_APP_SECRET` are absent; update any other exact-match 404 or `HTTPException` body assertion the same way
- [x] 5.2 Every response carries `X-Request-Id`: a success, a 404, a 500, and an agent MCP route
- [x] 5.3 An inbound `X-Request-Id` is echoed and used in the log lines; one longer than 255 characters is not used as the id (pin Hono's actual behaviour, and resolve the design's open question with it)
- [x] 5.4 With an injected sink: one request line per request for `/health`, `/v1/activity` (with deps) and an MCP route; every emitted line parses as an object with only primitive values; `path` excludes the query string; levels map 5xx/4xx/other and successful `/health` to `debug`
- [x] 5.5 A throwing route yields an error line and a request line with status 500, both carrying the same `requestId`; this pins that Hono runs `errorHandler` before the logging middleware resumes (D2)
- [x] 5.6 CORS: an allowed-origin response exposes `x-request-id`; a preflight from an allowed origin requesting `x-request-id` is allowed; an MCP route exposes it and allows it
- [x] 5.7 Provisioning failure: with deps whose chain calls reject and whose store writes reject, creating an agent returns 202, then the sink receives `provisioning stopped` before the two `could not record provisioning failure` lines, all carrying the creating request's id

## 6. Docs

- [x] 6.1 `docs/10_API_CONTRACT.md`: add the error body shape (`error`, `status` where present, `requestId`) and the `X-Request-Id` response header
- [x] 6.2 `docs/22_DEPLOYMENT.md`: add finding a request in Railway's log explorer (`@requestId:`, `@level:error`, `@status:>=500`) and the line fields
- [x] 6.3 `CLAUDE.md`: note under web ↔ api that `apps/api` logs only through `c.var.log` (or the default sink outside a request), never `console.*`

## 7. Verify

- [x] 7.1 `pnpm typecheck`, `pnpm --filter @nymspace/api test`, and `pnpm check` pass
- [ ] 7.2 After deploy, a request with a chosen `X-Request-Id` is found in Railway by `@requestId:<id>`, and a Railway log entry shows the line's fields as attributes
