## Context

MCP exists in this codebase as a text record and a filter. `agent-endpoint[mcp]` is written under an EAC grant (`docs/05_ENSV2_IMPLEMENTATION.md`), read back into the manifest (`assembleManifest`), and used by `packages/graph` to drop candidates that lack one. No code speaks the protocol. The value on the research agent is `https://mcp.nymspace.example/research`, which cannot resolve.

Constraints this design works inside:

- `apps/api` has no caller authentication. It is CORS-restricted and nothing else. The same process holds `ENSV2_ORGANIZATION_PRIVATE_KEY`, `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY`, and the Privy authorization keys through `buildDeps()`.
- `chat.ts` sets the product's doctrine for machine-initiated actions: answer with a plan, never perform.
- Endpoint values are **untrusted input**. For fleet agents the controller can write them. For discovered agents any ERC 8004 registrant can.
- The ENS record is onchain, so changing it costs a transaction and shows up in the activity trail. Whatever URL is published should not need to change again.
- Deployed on Railway as one `api` service with a public domain (`docs/22_DEPLOYMENT.md`).

## Goals / Non-Goals

**Goals:**

- Every MCP endpoint the fleet publishes answers a real MCP handshake.
- The console can show, live, whether any agent's advertised endpoint speaks MCP and what tools it exposes.
- No path from an MCP request, inbound or outbound, reaches a signing key.
- A failed connection is reported as a specific claim about the endpoint.

**Non-Goals:**

- Nymspace as an MCP server for LLM clients (explore option A). A later change can do that, read-only.
- Invoking tools (`tools/call`) on any server, including our own.
- Authentication on the demo MCP servers. They serve public, read-only data.
- Changing discovery ranking to weight reachability. Connect is on demand, not part of the ranking pass.
- Payment routes (owned by `pay-in-usdc-under-a-signer-policy`).

## Decisions

### D1: The demo servers live in `apps/api`, mounted without dependencies

The servers mount at `/mcp/:label` on the existing API process. The path is kept out of `DEPENDENT_ROUTES`, so `c.var.deps` is undefined in every MCP handler. That is the same mechanism that keeps `/health` independent. Tools compute their answers from static fleet metadata (`@nymspace/core`) and public configuration only.

A test asserts that no MCP handler can observe `deps`. The file layout supports it: `apps/api/src/mcp/servers.ts` imports nothing from `../deps`, and `conditions:check`-style static analysis is a possible follow-up.

*Alternative: a separate `apps/agents` service with no secrets in its environment.* That is the stronger isolation claim, since the process simply lacks the keys. It costs a third Railway service, a third public domain, and another deploy target during a hackathon. Rejected for now. Nothing in the route design blocks the move later, because a Hono sub-app lifts out unchanged.

### D2: Protocol routes sit outside the version prefix

The `api-server` spec requires product routes to carry a version. `/mcp/:label` is not a product route. It serves a protocol that negotiates its own version (`MCP-Protocol-Version`), and its URL is published onchain. A `/v1/` segment would bake an HTTP API version into an ENS record, so bumping the product API would mean rewriting chain state. The spec change adds that distinction explicitly rather than treating it as an exemption.

`POST /v1/mcp/connect` *is* a product route and stays versioned.

### D3: Stateless streamable HTTP, JSON responses

Each request builds a fresh `McpServer` and a `StreamableHTTPTransport` from `@hono/mcp`, with no session id generator and JSON responses rather than SSE. Nothing persists between requests, so a Railway restart or a second replica cannot strand a session. The tool set is small enough that per-request construction costs nothing measurable.

*Alternative: the SDK's own `WebStandardStreamableHTTPServerTransport`.* That is equivalent on web-standard `Request`/`Response`. `@hono/mcp` is chosen for the `Context` integration. If its peer range lags the SDK, the fallback is the SDK transport, and the handler shape stays the same.

*Resolved during apply (task 1.1):* the SDK transport is used and `@hono/mcp` is not installed. `@hono/mcp@0.3.2` declares `hono-rate-limiter` as a required peer, which would add a dependency this change has no use for, while the SDK's `WebStandardStreamableHTTPServerTransport` takes `c.req.raw` and returns a `Response` directly, which is the whole of the `Context` integration the handler needs. Each request still builds a fresh server and transport, with no session id generator and `enableJsonResponse: true`.

### D4: What the servers serve

| Agent | Tools | Source of the answer |
|---|---|---|
| research | `describe_agent`, `list_fleet` | static fleet metadata: labels, names, roles, ENS names |
| trader | `describe_agent` | static metadata, including a plain statement that it cannot move funds over MCP |
| deploy | `describe_agent` | static metadata |

`serverInfo.name` is the agent's full ENS name (e.g. `research.nymspace.eth`). That self-report is what connect compares against (D7).

Only `research` needs a published record for the demo. `trader` and `deploy` are served so the route is uniform, but their records stay unset unless the organization writes them. See Open Questions.

Query strings are ignored. The permission proof and `verify-identity.ts` write `…/research?proof=<ts>` to force a changing value, and those URLs must still answer.

### D5: The published endpoint is derived, never literal

`AGENT_MCP_BASE_URL` is the public origin of the API (`https://${{api.RAILWAY_PUBLIC_DOMAIN}}` on Railway). An endpoint is `new URL(\`/mcp/${label}\`, base)`, built by one helper in `@nymspace/core`. The helper is safe for client use because it is pure. The three places that hard-code `mcp.nymspace.example` all call it.

The live record is written once, from the deployed base URL. A local `.env` pointing at `http://localhost:3112` must never write to chain, so the write path refuses a non-`https` base.

### D6: Connect accepts identifiers, not URLs

```
POST /v1/mcp/connect
{ "target": { "kind": "fleet", "agentId": "…" } }
{ "target": { "kind": "graph", "graphAgentKey": "…" } }
```

The server resolves the URL itself. For a fleet agent it uses `assembleManifest` → `endpoints.mcp`, the same live read the inspector uses. For a discovered agent it uses the cached Agent0 search → `mcpEndpoint`. A request body carrying a URL would turn this route into an unauthenticated open proxy, because the API has no caller auth. Accepting only identifiers limits reachable targets to URLs that somebody published to a registry, and those still pass the guard (D8).

The response echoes the resolved URL and names its source (`ens` or `graph`), so the console can show which system made the claim.

*Resolved during apply:* a discovered agent resolves through `Agent0Client.agentProfile(graphAgentKey)`, a direct query by key, rather than the cached search. The browse cache is keyed by search parameters, so a key returned by one search is not reliably findable from another. A fleet agent resolves through `EnsService.readText` on `agent-endpoint[mcp]`: the same live read `assembleManifest` would make for this one field, without the context, registration and ENSIP 25 reads it would also make. The throttle (task 5.4) is keyed by target rather than by endpoint, so a repeated connect costs no request to the resolver either.

### D7: Handshake only, no tool invocation

Connect performs `initialize` → `tools/list` (following `nextCursor` up to a page cap) → `close`. It never sends `tools/call`.

The reason is that a tool's name and description say nothing reliable about its side effects. A discovered server's `get_price` might submit an order. Even if connect called only our own servers, the moment it can call anything, the next change will want it to call something else. `tools/list` is enough to prove the claim this feature exists for: the endpoint speaks MCP, and here is what it offers.

The comparison of `serverInfo.name` against the ENS name the record lives on is reported as `identity: "matches" | "differs" | "not_reported"`, always labelled *self-reported*. It is a consistency signal. The server can send any name it likes, so a match is never shown as verification.

### D8: The outbound guard

One function, `guardedFetch`, is handed to the SDK client transport as its fetch implementation. It enforces:

1. `https:` only.
2. DNS resolution first, then rejection if any resolved address is loopback, private (RFC 1918, RFC 4193), link-local (including `169.254.169.254`), CGNAT, unspecified, or multicast. The connection is then pinned to the checked address through an undici `Agent` with a custom `lookup`, so a second resolution cannot rebind to something internal.
3. `redirect: "manual"`, with any 3xx treated as `blocked`. A redirect is a new unchecked target.
4. A 5 s timeout per request and 10 s overall, through `AbortSignal`.
5. A 256 KiB response cap, enforced by reading the body stream with a counter.

The exception: a URL whose origin equals `AGENT_MCP_BASE_URL` skips rule 1 and 2. That is how local development (`http://localhost:3112`) reaches its own servers. The exception is one exact origin taken from configuration, never a pattern.

The guard is tested on its own against a table of addresses. Tests do not rely on the SDK to route through it. One test does assert that the transport actually calls the injected fetch, since a transport that silently falls back to global `fetch` would bypass everything above.

*To verify first (task 1.2):* that `StreamableHTTPClientTransport` in the pinned SDK version accepts a `fetch` option. If it does not, the fallback is `requestInit.dispatcher` with the pinned undici `Agent`, plus the scheme and redirect checks moved before `connect()`.

### D9: Outcomes are a closed union

```ts
type ConnectOutcome =
  | { status: "connected"; protocolVersion; server: { name; version }; identity; tools: ToolSummary[]; toolsTruncated: boolean }
  | { status: "no_endpoint" }                    // nothing published: absence, not failure
  | { status: "blocked"; rule }                  // the guard refused; nothing was sent
  | { status: "unreachable" | "timeout"; stage } // stage: "dns" | "connect" | "initialize" | "tools/list"
  | { status: "not_mcp"; httpStatus?; detail }   // answered, but not as MCP
```

Every variant carries `endpoint`, `endpointSource`, and `readAt`. `ToolSummary` holds `name`, `description` (truncated to 280 chars), and the top-level input property names. It never holds full schemas, because this is display data from an untrusted server. Tool text is rendered as text, never as markup.

The route returns 200 for every outcome, following the api-server rule that denials are responses and not errors. A 5xx means Nymspace itself failed.

### D10: Logging under a new `mcp` source

Each attempt is recorded with `source: "mcp"`, `type: "mcp.connect.succeeded" | "mcp.connect.failed" | "mcp.connect.blocked"`, and evidence `{ source: "mcp", endpoint, endpointSource, outcome, readAt }`. It needs a new source because `ActivityEvidence` is a discriminated union and none of the existing members describes an outbound protocol read. The DB check constraint `activity_events_source_check` is widened by a generated migration.

*Alternative: log under `app`.* Rejected, because it would put a claim about a third-party endpoint under the source reserved for the application's own actions.

### D11: Claimed tools, and connect from the chat

**Claimed tools.** Agent0 registrations carry `mcpTools`, which `packages/graph` does not read today. It joins the query and `normalise` as `mcpTools?: string[]`, omitted when empty. Introspection during apply showed the field is `[String!]!` on both the Sepolia and Base Sepolia subgraphs, the same as `supportedTrusts`, so a registration that lists no tools and one that never mentions them both arrive as `[]`; the only honest reading of `[]` is "no claim". It is a claim and stays labelled as one, and it does not enter ranking (the non-goal above still holds).

The comparison is made by the API, in the connect response, because the console draws and does not decide (`packages/core/src/lens.ts`). A `connected` outcome for an agent with a claim carries `claim: { missing, unclaimed }`: claimed but not in `tools/list`, and listed but not claimed. `claim` is omitted when the registration advertised nothing. When `toolsTruncated` is true, `missing` is withheld, because a truncated listing cannot prove that a claimed tool is not served.

**Connect from the chat.** `chat.ts` gains an MCP intent. It is matched after the plan intents, so "as research, set its mcp endpoint to …" keeps producing the record-write plan, and before the agent lens, so "show research" keeps producing the lens. It answers with a `LensPlan` of one step: `POST /v1/mcp/connect` with a `fleet` target. Connect sends an outbound request and writes an activity event (D10), and `chat.ts`'s doctrine is that the chat performs neither without confirmation.

No key signs that step. `PlanStep.actor` gains `"none"`, and the plan card says the step is unsigned instead of printing "signed by none".

`readOutcome` in `chat-console.tsx` must learn the connect outcomes. Today any 200 that is not `denied`, `failed` or `not_configured` is reported as `done`, so an `unreachable` endpoint would be shown as a completed step, which is the exact overclaim this change exists to remove.

The agent lens does not dial. Putting connect inside `agentLens` would make every "show research" wait up to the 10 s overall timeout, on a lens already tuned down from five seconds of chain reads.

## Risks / Trade-offs

- [The demo servers share a process with the keys (D1)] → Enforced by construction (no deps on the route) and by a test, not by the OS. Moving to a separate service is a lift-out, and the reasoning is recorded here so the trade-off stays visible.
- [DNS rebinding between check and connect] → Connection pinned to the checked address (D8 rule 2). Without pinning, the guard would be advisory.
- [`@hono/mcp` or SDK API drift] → Pin exact versions. D3 names the SDK-native transport as the drop-in fallback.
- [Third-party endpoints are mostly dead (`gate-b.json`)] → That is the point of the feature. The console shows `unreachable` as a finding about the agent, and the demo script connects to our own agent first.
- [Railway domain changes] → The endpoint derives from `AGENT_MCP_BASE_URL`, but the onchain record does not follow automatically. Re-pointing is one `setText`. Attach a custom domain before the final write if one is planned.
- [An unauthenticated caller can make the API issue outbound requests] → Targets are limited to published registry values (D6), each attempt is rate-limited per target (one in-flight connect per endpoint, 10 s cooldown) and logged. This is still a real amplification surface, and it is documented in `docs/12_SECURITY_MODEL.md`.
- [Tool descriptions from third parties are attacker-controlled text shown to operators] → Truncated, rendered as text, and never fed to the discovery ranking model in this change.

## Migration Plan

1. Ship the servers and the guard with the record unchanged, then verify `/mcp/research` on the deployed domain with the MCP Inspector.
2. Set `AGENT_MCP_BASE_URL` on Railway, then re-point `research`'s `agent-endpoint[mcp]` with a single controller `setText`, and read it back.
3. Ship the connect route and the console action.

Rollback: the old record value is in the activity log. Writing it back is one `setText`, and removing the route has no chain effect.

## Open Questions

- Should `trader` and `deploy` publish MCP records? It is an organization-authority write (no delegation needed), and it makes the fleet uniform. The catch: the fleet comment in `provision-fleet.ts` keeps those two minimal on purpose, and the `agent-identity` spec makes `agent-endpoint[mcp]` required, which they currently violate either way.
- Custom domain for the API before the final record write, or accept the Railway-generated domain onchain?
