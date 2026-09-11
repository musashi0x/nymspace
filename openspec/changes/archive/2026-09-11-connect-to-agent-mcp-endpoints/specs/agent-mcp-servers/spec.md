## ADDED Requirements

### Requirement: Each fleet agent serves a real MCP endpoint

The system SHALL serve a Model Context Protocol server for each fleet agent over streamable HTTP at `/mcp/<label>`, so that the value published in `agent-endpoint[mcp]` names an endpoint that completes a protocol handshake.

#### Scenario: The handshake completes

- **WHEN** an MCP client sends `initialize` to `/mcp/research`
- **THEN** the server MUST answer with a negotiated protocol version, advertise the tools capability, and report `serverInfo.name` equal to the agent's full ENS name

#### Scenario: Tools are listed

- **WHEN** an MCP client sends `tools/list` to an agent's endpoint
- **THEN** the server MUST return that agent's tools, each with a name, description, and input schema

#### Scenario: An unknown label is not an agent

- **WHEN** a request arrives for `/mcp/<label>` where the label is not a fleet agent
- **THEN** the response MUST be 404 with the API's standard JSON error shape, and MUST NOT be an MCP server with no tools

#### Scenario: Query strings do not change the endpoint

- **WHEN** a request arrives for `/mcp/research?proof=<timestamp>`
- **THEN** it MUST be served identically to `/mcp/research`

#### Scenario: No session state is required

- **WHEN** consecutive requests arrive without a session identifier, or the process restarts between them
- **THEN** each request MUST be served without error

### Requirement: Agent MCP servers cannot reach authority

The MCP server handlers SHALL have no access to the store, the chain client, or any signing or authorization key, and every tool they expose SHALL be read-only.

#### Scenario: No dependencies are mounted

- **WHEN** an MCP request is handled
- **THEN** the request context MUST NOT carry the dependencies that product routes receive, and a test MUST assert this

#### Scenario: Tools answer from public data only

- **WHEN** any tool on any agent server is called
- **THEN** its result MUST be computed from static fleet metadata or public configuration, and MUST NOT include secret material or perform a write

### Requirement: Published MCP endpoints are derived from configuration

Every place the system writes or proposes an `agent-endpoint[mcp]` value for a fleet agent SHALL derive it from `AGENT_MCP_BASE_URL` and the agent's label, never from a literal URL.

#### Scenario: One derivation

- **WHEN** provisioning, identity registration, or the permission proof needs a fleet agent's MCP endpoint
- **THEN** each MUST obtain it from the same helper, and no source file MUST contain a hard-coded MCP endpoint host for a fleet agent

#### Scenario: A local base URL never reaches chain

- **WHEN** a write of `agent-endpoint[mcp]` is attempted with an endpoint whose scheme is not `https`
- **THEN** the write MUST be refused before a transaction is built

#### Scenario: The live record answers

- **WHEN** the research agent's `agent-endpoint[mcp]` is read from ENS after this change is deployed
- **THEN** its value, with any query string removed, MUST be an endpoint that completes the MCP handshake
