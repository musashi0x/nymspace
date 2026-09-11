## 1. Setup and verification spikes

- [x] 1.1 Add `@modelcontextprotocol/sdk` and `@hono/mcp` to `apps/api` at exact pinned versions; confirm their peer ranges accept the installed `hono` and `zod` — SDK pinned at 1.30.0 (peer `zod ^3.25 || ^4.0` accepts 4.5.4); `@hono/mcp` dropped for the SDK's own web-standard transport, see design.md D3
- [x] 1.2 Spike: confirm `StreamableHTTPClientTransport` in the pinned SDK accepts an injected `fetch`; if not, record the `requestInit.dispatcher` fallback in design.md D8 before continuing — confirmed: `fetch?: FetchLike` on the transport options; no fallback needed
- [x] 1.3 Add `AGENT_MCP_BASE_URL` to `.env.example`, `turbo.json` `globalEnv`, and `.railway/railway.ts` (`https://${{api.RAILWAY_PUBLIC_DOMAIN}}`); `pnpm env:check` passes
- [x] 1.4 Add a pure `agentMcpEndpoint(base, label)` helper to `@nymspace/core`'s root export, with tests for trailing slashes and query-free output

## 2. Agent MCP servers

- [x] 2.1 Create `apps/api/src/mcp/servers.ts`: per-label `McpServer` factory, `serverInfo.name` = full ENS name, tools per design.md D4 answered from static fleet metadata only; no import from `../deps` — fleet metadata moved to `FLEET` in `@nymspace/core`
- [x] 2.2 Mount `/mcp/:label` in `app.ts` as a chained route, stateless transport with JSON responses; unknown label returns the standard 404
- [x] 2.3 Scope CORS so product routes keep the origin allowlist while `/mcp/*` serves clients without an `Origin` header
- [x] 2.4 Test: `initialize` + `tools/list` against `app.ts` for each label; `?proof=` query is ignored; unknown label is 404
- [x] 2.5 Test: `/mcp/*` is absent from `DEPENDENT_ROUTES` and a handler observes `c.var.deps` as undefined — enforced by a guard in the route that throws if `deps` is present, tested both ways

## 3. Endpoint derivation and the live record

- [x] 3.1 Replace the literal in `scripts/provision-fleet.ts`, `scripts/register-identity.ts`, and `permission-proof.tsx`'s fallback with `agentMcpEndpoint` — scripts refuse a non-https base before spending; `provision-fleet.ts` now builds from `FLEET`; the agent page derives the proof's endpoint server-side (identity payload gains `label`), falling back to the on-chain value when the base is not https
- [x] 3.2 Refuse a non-`https` `agent-endpoint[mcp]` value on the record-write path before building a transaction; test it — `recordWriteSchema` answers 400 before any chain call, and `EnsService.writeText` refuses as the backstop for every other caller; `packages/ens` gains a vitest config for the `react-server` condition
- [x] 3.3 Confirm no `mcp.nymspace.example` remains outside `docs/`, evidence files, and ENS spike scripts (spike scripts left as historical record) — `verify-identity.ts` (Gate A) also converted; only `spike-ensv2.ts` remains

## 4. Outbound guard

- [ ] 4.1 Create `apps/api/src/mcp/guard.ts`: `guardedFetch` enforcing https-only, resolve-then-check address classes, pinned connection via undici `Agent` lookup, manual redirects, per-request and overall timeouts, streamed size cap
- [ ] 4.2 Implement the single exact-origin exemption for `AGENT_MCP_BASE_URL`
- [ ] 4.3 Table test of address classes: 127/8, ::1, 10/8, 172.16/12, 192.168/16, fc00::/7, 169.254/16 incl. 169.254.169.254, 100.64/10, 0.0.0.0, multicast, IPv4-mapped IPv6; a public host resolving to a private address is blocked
- [ ] 4.4 Tests: redirect is blocked without requesting the target; oversized body aborts; slow body times out; exemption does not match a suffix or a different port

## 5. Connect

- [ ] 5.1 Create `apps/api/src/mcp/connect.ts`: resolve target (fleet via `assembleManifest`, graph via cached Agent0 search), then `initialize` → paged `tools/list` with cap → `close`, returning the `ConnectOutcome` union from design.md D9
- [ ] 5.2 Map transport and protocol errors to `unreachable`/`timeout` with stage, `not_mcp` with HTTP status, `blocked` with rule; `no_endpoint` makes no request
- [ ] 5.3 Identity comparison of `serverInfo.name` against the ENS name, returned as `matches | differs | not_reported` and marked self-reported
- [ ] 5.4 Per-endpoint in-flight dedupe and cooldown
- [ ] 5.5 Add `POST /v1/mcp/connect` in `apps/api/src/routes/mcp.ts` with a zod schema accepting only `fleet` and `graph` targets; mount it chained in `app.ts` and include it in `DEPENDENT_ROUTES`
- [ ] 5.6 Test against a recording MCP server: connected path returns tools; no `tools/call` is ever sent; pagination cap sets `toolsTruncated`; a URL in the body is a 400
- [ ] 5.7 Test: the transport uses the injected guarded fetch, not global `fetch`
- [ ] 5.8 Add `mcpTools` to the Agent0 query in `packages/graph/src/client.ts`, to its types, and to `normalise` as `mcpTools?: string[]`; test absent versus empty, and that ranking is unchanged by it
- [ ] 5.9 On `connected`, return `claim: { missing, unclaimed }` when the registration advertises tools (design.md D11); omit `claim` with no advertisement; withhold `missing` when `toolsTruncated`; test all three

## 6. Activity log

- [ ] 6.1 Add `mcp` to `ActivitySource`, `mcp.connect.succeeded|failed|blocked` to `ActivityType`, and the `mcp` evidence member to `ActivityEvidence`; extend `assertEvidence`
- [ ] 6.2 Widen `activity_events_source_check` in `schema.ts`, run `pnpm --filter @nymspace/store db:generate`, commit the migration; store tests pass against Postgres
- [ ] 6.3 Record an event for every connect outcome; test that a failed connect is retained

## 7. Console

- [ ] 7.1 Change the discovery badge from `MCP available` to advertised wording; add a Connect action per result that has an endpoint
- [ ] 7.2 Add Connect to the inspector's MCP record
- [ ] 7.3 Render each outcome: tools as plain text with read time; identity labelled self-reported; failures as findings with stage or rule — built from Astryx components per `apps/web/AGENTS.md`
- [ ] 7.4 Render `claim` from the connect response in both directions, labelled by direction; the console computes no comparison of its own
- [ ] 7.5 Add the MCP intent to `apps/api/src/routes/chat.ts`, matched after the plan intents and before the agent lens, answering with a one-step `POST /v1/mcp/connect` plan for a `fleet` target; add `"none"` to `PlanStep.actor` in `packages/core/src/lens.ts` and render it as unsigned; add one matching line to `CONSOLE_SUGGESTIONS`
- [ ] 7.6 Make `readOutcome` in `apps/web/components/console/chat-console.tsx` report connect outcomes by their status, so `unreachable`, `timeout`, `not_mcp`, `blocked` and `no_endpoint` never read as `done`
- [ ] 7.7 Create `apps/api/src/routes/chat.test.ts` against `app.ts`: the MCP intent returns the connect plan and performs no connect; "as research, set its mcp endpoint to …" still returns the record-write plan; "show research" still returns the agent lens
- [ ] 7.8 `pnpm typecheck` and `pnpm lint` pass; the typed client covers the new route

## 8. Deploy, re-point, verify

- [ ] 8.1 Deploy; connect to `https://<api domain>/mcp/research` with the MCP Inspector and record the result in `evidence/`
- [ ] 8.2 Re-point `research`'s `agent-endpoint[mcp]` with one controller `setText`; read it back from ENS
- [ ] 8.3 From the deployed console, Connect to the research agent (expect `connected`, identity `matches`) and to one dead third-party result from discovery (expect a failure outcome); capture both in `evidence/`
- [ ] 8.4 Update `docs/10_API_CONTRACT.md`, `docs/12_SECURITY_MODEL.md` (outbound guard, no `tools/call`, amplification note), `docs/07_THE_GRAPH_INTEGRATION.md` (`mcpTools` read as a claim), and `docs/01_PRD.md` (connect button no longer nice-to-have)
- [ ] 8.5 `pnpm check`, `pnpm typecheck`, `pnpm test` all pass
