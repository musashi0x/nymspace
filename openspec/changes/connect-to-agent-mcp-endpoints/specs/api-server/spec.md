## ADDED Requirements

### Requirement: Agent MCP routes are protocol routes

Routes that serve an agent's MCP endpoint SHALL live under `/mcp/<label>` outside the version prefix, because their URL is published onchain and the protocol negotiates its own version. They SHALL be mounted without the dependencies product routes receive.

#### Scenario: The path carries no API version

- **WHEN** an agent MCP route is mounted
- **THEN** its path MUST NOT begin with a version segment, and changing the product API version MUST NOT change any published endpoint

#### Scenario: The route is excluded from dependency injection

- **WHEN** the application is constructed
- **THEN** `/mcp/*` MUST NOT be among the paths that receive `withDeps()`, and a test MUST fail if it is added

#### Scenario: Browser origin rules do not gate protocol clients

- **WHEN** an MCP client without an `Origin` header calls an agent MCP route
- **THEN** it MUST be served, while product routes keep their configured-origin restriction

### Requirement: The API serves MCP connect

The API SHALL serve `POST /v1/mcp/connect` as a product route, validated by schema and returned through the typed client, as specified by the `mcp-connect` capability.

#### Scenario: The route is in the typed client

- **WHEN** the web application calls connect
- **THEN** it MUST do so through the `hc<AppType>` client, so a renamed route or changed outcome shape is a compile error

#### Scenario: Connect does not touch payment routes

- **WHEN** this route is added
- **THEN** no payment route's path, schema, or behaviour MUST change
