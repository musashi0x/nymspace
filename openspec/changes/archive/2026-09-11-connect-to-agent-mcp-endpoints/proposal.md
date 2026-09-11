## Why

Every MCP endpoint this product publishes points at nothing.

`research.<parent>.eth` carries `agent-endpoint[mcp] = https://mcp.nymspace.example/research`. That value comes from `scripts/provision-fleet.ts`, `scripts/register-identity.ts` and the permission proof's fallback in `permission-proof.tsx`, and `.example` is a reserved TLD that will never resolve. The `agent-identity` spec already forbids this: "the system MUST NOT advertise a protocol whose endpoint does not exist." Today the record the ENS judge moment rests on ("allowed MCP write followed by denied protected write", `docs/16_SPONSOR_QUALIFICATION.md`) is a well-authorized write of a dead URL.

Discovery has the same gap from the other side. `packages/graph` hard-filters on `mcpEndpoint`, and the console renders `MCP available` from whether the field is set. Nothing ever checks that the endpoint answers. `packages/graph/evidence/gate-b.json` shows why that matters: live Agent0 results advertise `http://localhost:8080/mcp` and hosts that no longer serve. "Has an MCP endpoint" is being shown as "is reachable over MCP", and those are different claims.

The tool list has the same gap one level down. Agent0 registrations advertise `mcpTools`, a list the registrant wrote about itself, and `packages/graph` does not read it today: the query takes `mcpVersion` and stops. Once connect exists there are two lists for the same server, what the registration claims and what `tools/list` returned, and showing either one alone hides the only interesting fact, which is whether they agree.

`docs/01_PRD.md` already names the fix as a nice-to-have: "MCP connect button that actually calls a demo MCP server." This change builds both halves of it.

## What Changes

- **The demo agents get real MCP servers.** `apps/api` serves a stateless streamable-HTTP MCP server per fleet agent at `/mcp/<label>`. Each has one or two read-only tools and reports its own ENS name as its server identity. The route gets no dependencies from `withDeps()`, so no MCP handler can reach the store, the chain client, or any key.
- **The published records point at them.** `provision-fleet.ts`, `register-identity.ts` and the permission proof fallback build the endpoint from a configured public base URL (`AGENT_MCP_BASE_URL`) instead of a literal. The research agent's live record is re-pointed once, under the controller's existing grant.
- **Nymspace becomes an MCP client, and only a client of `initialize` and `tools/list`.** `POST /v1/mcp/connect` takes an identifier (a fleet agent id or a Graph agent key), never a URL. It resolves the endpoint from the system that owns it (ENS for the fleet, Agent0 for discovered agents) and performs `initialize` and `tools/list`. It returns the negotiated protocol version, the server's self-reported identity, and the tool surface. It never sends `tools/call`.
- **Outbound calls are guarded.** HTTPS only, no private, loopback, link-local or metadata addresses (checked on the resolved IP, not the hostname), no redirects, a hard timeout and a response size cap. The single exception is the configured `AGENT_MCP_BASE_URL` origin, so the product can reach its own servers in local development.
- **An unreachable endpoint is a finding, not an empty list.** A failed connect returns a typed outcome (`unreachable`, `timeout`, `not_mcp`, `blocked`), with the stage or rule it failed at. An agent with nothing published returns `no_endpoint`, which is absence rather than failure, and makes no request. A tool list is shown only when `tools/list` returned one.
- **Claimed tools are read, and compared with served ones.** Discovery reads `mcpTools` from Agent0 and carries it through normalisation under the same absent-versus-empty rule as the endpoint. A `connected` outcome for an agent with a claim reports the difference in both directions: claimed but not served, and served but not claimed. The comparison is made by the API, neither list overrides the other, and ranking does not change.
- **The console gets a Connect action.** It lives on discovery results and on the inspector's MCP record. Its result is labelled with its read time, and self-reported identity is labelled as a claim rather than a verification.
- **The chat can ask, and proposes rather than performs.** A question like "what does research's MCP serve" matches a new intent in `chat.ts` and is answered with a one-step plan naming `POST /v1/mcp/connect`. Connect makes an outbound request and records an activity event, and the chat's doctrine reserves both for the operator's confirmation. The agent lens never dials an endpoint, so its latency stays bounded by chain reads.
- **Connect attempts are logged.** Each attempt, including failures, lands in the activity log under a new `mcp` source whose evidence carries the endpoint, the outcome, and the time.
- **The chat matcher gets tests.** `chat.ts` has no suite today, and this change adds an intent whose position in the matcher order decides which question wins. Route tests cover the new intent and the intents it could shadow.

Out of scope: exposing Nymspace itself as an MCP server (explore option A), calling any tool on any server, and payment routes. The in-flight `pay-in-usdc-under-a-signer-policy` change owns those routes, and this change does not touch them.

## Capabilities

### New Capabilities

- `agent-mcp-servers`: the demo agents' own MCP servers: what they serve, what they may not reach, and how their published endpoint is derived.
- `mcp-connect`: resolving an agent's MCP endpoint from its authoritative source, performing a read-only handshake against it under an outbound guard, reporting the result as a typed, timed claim, and comparing a served tool list with a claimed one.

### Modified Capabilities

- `api-server`: adds the rule that agent MCP routes are protocol routes outside the version prefix and are mounted without dependencies, and adds `POST /v1/mcp/connect` to the product contract.
- `agent-console`: adds the Connect action on discovery results and the inspector, how its outcomes are rendered, the claimed-against-served tool comparison, and the chat intent that proposes a connect as a plan.
- `agent-discovery`: normalisation carries a registration's `mcpTools` as a claim, absent when the registration has none, and keeps it out of ranking.
- `coordination-store`: the activity log gains an `mcp` source with its own evidence shape.

## Impact

- **Code**: new `apps/api/src/mcp/` (servers, connect, outbound guard) and `apps/api/src/routes/mcp.ts`. Edits to `app.ts` for mounting, to `scripts/provision-fleet.ts`, `scripts/register-identity.ts` and `apps/web/components/console/permission-proof.tsx` for endpoint derivation, and to `discover-form.tsx` and the inspector for the Connect action. `packages/graph` gains `mcpTools` in its query, types and normalisation. `apps/api/src/routes/chat.ts` gains the MCP intent and its first test suite. `packages/core/src/lens.ts` gains a `CONSOLE_SUGGESTIONS` line, which must match the new intent, and a `PlanStep.actor` member for a step no key signs. `chat-console.tsx` learns to read connect outcomes.
- **Dependencies**: `@modelcontextprotocol/sdk` (server and client) and `@hono/mcp` (Hono transport), both in `apps/api` only.
- **Store**: one migration widening `activity_events_source_check` to include `mcp`. `ActivitySource`, `ActivityType` and `ActivityEvidence` gain the matching members. No new columns, so `ALLOWED_COLUMNS` is untouched.
- **Environment**: `AGENT_MCP_BASE_URL` is added to `.env.example`, `turbo.json` `globalEnv`, and `.railway/railway.ts`, where it is set to `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`.
- **Onchain**: one `setText` on `research.<parent>.eth` for `agent-endpoint[mcp]`, signed by the controller under its existing grant. No new grants.
- **Docs**: `docs/10_API_CONTRACT.md` (connect route), `docs/12_SECURITY_MODEL.md` (outbound guard, no `tools/call`), `docs/07_THE_GRAPH_INTEGRATION.md` (`mcpTools` is now read, as a claim), and `docs/01_PRD.md`, which moves the connect button out of Nice to have.
