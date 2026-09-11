## ADDED Requirements

### Requirement: Connect resolves the endpoint from its authoritative source

The system SHALL expose `POST /v1/mcp/connect`, which accepts an agent identifier and never a URL, and resolves the MCP endpoint from the system that publishes it.

#### Scenario: A fleet agent resolves through ENS

- **WHEN** connect is called with `{ kind: "fleet", agentId }`
- **THEN** the endpoint MUST be read live from that agent's `agent-endpoint[mcp]` record, and the response MUST name `ens` as its source

#### Scenario: A discovered agent resolves through Agent0

- **WHEN** connect is called with `{ kind: "graph", graphAgentKey }`
- **THEN** the endpoint MUST be the `mcpEndpoint` from the Agent0 registration data for that key, and the response MUST name `graph` as its source

#### Scenario: A URL is not accepted

- **WHEN** a connect request body contains a URL field or any target kind other than `fleet` or `graph`
- **THEN** the request MUST be rejected by validation before any outbound request is made

#### Scenario: No published endpoint is absence

- **WHEN** the resolved agent has no MCP endpoint
- **THEN** the outcome MUST be `no_endpoint`, distinct from every failure outcome, and no outbound request MUST be made

### Requirement: Connect performs a read-only handshake

Connect SHALL send only `initialize`, `tools/list`, and the requests required to close the connection. It SHALL NOT send `tools/call` or any other request that could cause the remote server to act.

#### Scenario: A successful connect reports the tool surface

- **WHEN** the endpoint completes `initialize` and `tools/list`
- **THEN** the outcome MUST be `connected`, carrying the negotiated protocol version, the server's reported name and version, and a summary of each listed tool

#### Scenario: No tool is invoked

- **WHEN** any connect is performed against any endpoint
- **THEN** no `tools/call` request MUST be sent, and a test MUST assert this against a recording server

#### Scenario: Listing is bounded

- **WHEN** `tools/list` paginates
- **THEN** connect MUST follow `nextCursor` up to a fixed page cap and MUST report `toolsTruncated: true` when the cap is reached

#### Scenario: Self-reported identity is labelled as such

- **WHEN** the server's reported name is compared with the ENS name that published the endpoint
- **THEN** the result MUST be one of `matches`, `differs`, or `not_reported`, and the response MUST mark it as self-reported rather than verified

### Requirement: Outbound requests are guarded

Every outbound request made by connect SHALL pass a guard that refuses targets that could reach internal infrastructure, before any bytes are sent to them.

#### Scenario: Non-HTTPS is refused

- **WHEN** the resolved endpoint's scheme is not `https`, and its origin is not the configured `AGENT_MCP_BASE_URL` origin
- **THEN** the outcome MUST be `blocked` naming the rule, and no request MUST be sent

#### Scenario: Internal addresses are refused after resolution

- **WHEN** any address the endpoint's hostname resolves to is loopback, private, link-local, CGNAT, unspecified, or multicast
- **THEN** the outcome MUST be `blocked`, including when the hostname itself looks public

#### Scenario: The checked address is the connected address

- **WHEN** the guard admits a hostname
- **THEN** the connection MUST be made to the address that was checked, not to a second resolution of the hostname

#### Scenario: Redirects are not followed

- **WHEN** the endpoint answers with a 3xx status
- **THEN** the outcome MUST be `blocked` and the redirect target MUST NOT be requested

#### Scenario: Time and size are capped

- **WHEN** a response exceeds the per-request timeout, the overall timeout, or the response size cap
- **THEN** the attempt MUST be aborted and reported as `timeout` or `not_mcp` respectively, without buffering the remainder

#### Scenario: The configured self origin is the only exception

- **WHEN** the endpoint's origin exactly equals the origin of `AGENT_MCP_BASE_URL`
- **THEN** the scheme and address rules MUST be skipped for that request only, and no other origin, pattern, or suffix MUST be exempted

#### Scenario: Connect attempts are throttled per endpoint

- **WHEN** a connect to an endpoint is requested while one is in flight, or within the cooldown after the last attempt
- **THEN** the system MUST return the in-flight or most recent outcome rather than issue a new outbound request

### Requirement: A failed connect is a typed claim about the endpoint

Every connect SHALL return one outcome from a closed set, each carrying the endpoint, its source, and the read time. A failure SHALL never be represented as an empty tool list.

#### Scenario: Failures name their stage

- **WHEN** an attempt fails as `unreachable` or `timeout`
- **THEN** the outcome MUST name the stage it failed at: `dns`, `connect`, `initialize`, or `tools/list`

#### Scenario: A non-MCP answer is distinguished from no answer

- **WHEN** the endpoint answers HTTP but not with a valid MCP response
- **THEN** the outcome MUST be `not_mcp`, carrying the HTTP status where one was received

#### Scenario: Outcomes are responses, not errors

- **WHEN** an outcome other than `connected` is produced
- **THEN** the HTTP status MUST be 200, and a 5xx MUST be reserved for failures of the system itself

#### Scenario: Remote text is bounded

- **WHEN** tool summaries are built from a remote server's `tools/list`
- **THEN** each description MUST be truncated to a fixed length and input schemas MUST be reduced to top-level property names

#### Scenario: Every attempt is logged

- **WHEN** a connect produces any outcome other than a validation rejection
- **THEN** an activity event MUST be recorded with source `mcp` and the outcome as its evidence

### Requirement: A served tool list is compared with a claimed one

When the connected agent's registration advertises tools, a `connected` outcome SHALL carry the difference between the claimed list and the served list. Neither list SHALL replace the other.

#### Scenario: Differences are reported in both directions

- **WHEN** a `connected` outcome is produced for an agent whose registration advertises tools
- **THEN** the outcome MUST carry the names claimed but not served and the names served but not claimed

#### Scenario: A truncated listing cannot prove absence

- **WHEN** the served list is truncated by the page cap
- **THEN** the outcome MUST NOT report any claimed tool as not served

#### Scenario: No claim, no comparison

- **WHEN** the agent's registration advertises no tools
- **THEN** the outcome MUST omit the comparison rather than report every served tool as unclaimed
