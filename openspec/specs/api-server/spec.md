# api-server Specification

## Purpose

The dedicated HTTP surface — how routes are versioned and namespaced, how origins are restricted, how errors and validation failures are shaped, how the process is configured, and how the web application calls it with types intact.
## Requirements
### Requirement: The API is a standalone process

The API SHALL run as its own process, independent of the Next.js application, and SHALL be configured entirely from its environment.

#### Scenario: The process starts from configuration alone

- **WHEN** the API starts
- **THEN** it MUST read its port and its allowed origins from the environment, and MUST NOT require the web application to be running

#### Scenario: Missing configuration fails at startup

- **WHEN** a required variable is absent
- **THEN** the process MUST fail on startup with a message naming the variable, and MUST NOT accept a request first

#### Scenario: Every variable is declared

- **WHEN** the API reads an environment variable
- **THEN** that variable MUST appear in both `turbo.json` and `.env.example`, so the existing reconciliation check keeps them in step

#### Scenario: Liveness is observable

- **WHEN** `GET /health` is requested
- **THEN** it MUST return 200 with a JSON body identifying the service, without touching the chain or any external provider

### Requirement: Routes are versioned and namespaced

Product routes SHALL live under a version prefix so a breaking change to a response shape does not break a deployed frontend.

#### Scenario: Product routes carry a version

- **WHEN** a route serving product data is added
- **THEN** its path MUST begin with a version segment, and operational routes such as health MUST NOT

#### Scenario: An unknown path is reported as such

- **WHEN** a request arrives for a path with no route
- **THEN** the response MUST be 404 with the same JSON error shape every other failure uses

### Requirement: Input is validated before any domain call

Handlers SHALL reject malformed input at the edge, so an invalid value never reaches a package, a chain call, or a provider.

#### Scenario: A malformed address is rejected

- **WHEN** a parameter that must be a 20-byte address is not one
- **THEN** the response MUST be 400 naming the offending parameter, and no domain function MUST be called

#### Scenario: Parameters that depend on each other are checked together

- **WHEN** one of a set of mutually required parameters is supplied without the others
- **THEN** the response MUST be 400 explaining that they are required together

#### Scenario: Failures do not leak internals

- **WHEN** a handler throws
- **THEN** the response MUST be 500 with a body carrying only a generic message and the request's id, and the error's name, message and stack MUST go to the process log under that id rather than into the body

### Requirement: Browser access is restricted to configured origins

The API SHALL be callable from the browser only by origins it has been configured to trust.

#### Scenario: A configured origin is allowed

- **WHEN** a preflight request arrives from an origin listed in the configuration
- **THEN** the response MUST carry that origin in its allow-origin header

#### Scenario: An unconfigured origin is not allowed

- **WHEN** a preflight request arrives from any other origin
- **THEN** the response MUST NOT carry an allow-origin header for it

### Requirement: The web application calls the API with types intact

The frontend SHALL consume the API through a client derived from the API's own types, so that a change to a route surfaces at typecheck.

#### Scenario: A renamed or removed route breaks the build

- **WHEN** a route is renamed or removed in the API
- **THEN** `pnpm typecheck` MUST fail in the web application, rather than the call failing at runtime

#### Scenario: The base URL is configuration, not a constant

- **WHEN** the web application resolves the API's location
- **THEN** it MUST read it from the public environment surface, so a deployed frontend can point at a deployed API

#### Scenario: An unreachable API degrades rather than crashes

- **WHEN** a call to the API fails or times out
- **THEN** the component MUST render a stated error rather than an empty or broken view

### Requirement: The commit activity endpoint is served by the API

The existing activity endpoint SHALL move to the API, proving the split on a route with real behaviour rather than a derived-value probe.

#### Scenario: The payload is unchanged by the move

- **WHEN** the activity endpoint is requested after the move
- **THEN** the JSON body MUST carry the same fields it carried when served by the Next application

#### Scenario: The Next application no longer serves it

- **WHEN** the web application is inspected after the move
- **THEN** it MUST NOT contain a route handler for activity, and its component MUST fetch through the typed client

### Requirement: The API's own behaviour is tested

The API SHALL carry tests over its routing, validation, and error shapes, and those tests SHALL run in the existing task graph.

#### Scenario: Tests run through the workspace task

- **WHEN** `turbo run test` executes
- **THEN** the API's tests MUST be included

#### Scenario: Handlers are tested without a listening socket

- **WHEN** a route is tested
- **THEN** it MUST be exercised through the application's fetch handler, so no port is bound and tests cannot collide

### Requirement: Agent creation is served by the API

The API SHALL expose a route that provisions a new agent under the organization's parent namespace, and SHALL report that provisioning's progress separately from the request that started it.

#### Scenario: Creation answers before provisioning finishes

- **WHEN** a valid creation request is received
- **THEN** the response MUST be 202 carrying the agent's id and ENS name, and MUST NOT wait for the chain transactions to confirm

#### Scenario: The agent is readable before the caller polls

- **WHEN** the API answers a creation request
- **THEN** the agent row and its five provisioning tracks MUST already exist, so the first progress read has something to return

#### Scenario: A label owned by someone else is refused before anything is written

- **WHEN** the requested label's on-chain owner is neither absent nor the organization
- **THEN** the response MUST be 409 naming that owner, and no store row and no transaction may have been written

#### Scenario: Endpoints are named by protocol, never by record key

- **WHEN** a creation request describes the agent's endpoints
- **THEN** the request MUST name protocols and the record keys MUST be derived server-side, so no request can name the ENSIP 25 binding as a key to publish or delegate

### Requirement: Creation is idempotent against chain state

Provisioning SHALL read chain state before every write, so re-sending a creation request repairs what is missing rather than duplicating what exists.

#### Scenario: A re-post spends nothing on completed work

- **WHEN** a creation request names a label the organization already owns and has fully provisioned
- **THEN** every step MUST report that it found its work already on chain, and no transaction may be sent

#### Scenario: A re-post completes a partial provisioning

- **WHEN** a previous run stopped after some steps
- **THEN** a re-post MUST perform only the steps whose work is absent from the chain

#### Scenario: A repair does not re-log work it did not do

- **WHEN** a run skips registration because the name already exists
- **THEN** it MUST NOT record an event whose evidence is a transaction from an earlier run

### Requirement: A step is complete only when read back

No step in a provisioning run SHALL be reported successful on the strength of a submitted transaction.

#### Scenario: Each write is followed by a read

- **WHEN** a provisioning step writes a record or a grant
- **THEN** it MUST re-read that value from chain, and MUST report failure when the read does not match what was written

#### Scenario: The read-back is durable

- **WHEN** a provisioning step is recorded in the activity log
- **THEN** the value it read back MUST be recorded with it, so a later reader sees what the chain said rather than only what was sent

### Requirement: Provisioning progress is reconstructed from the activity log

The API SHALL report a run's steps from the recorded activity events rather than from process memory, and SHALL distinguish provisioning events from later writes of the same type.

#### Scenario: Progress survives a restart

- **WHEN** progress is requested after the API process has restarted mid-run
- **THEN** the steps already taken MUST still be returned, with their transaction hashes and read-back values

#### Scenario: Later writes are not reported as provisioning steps

- **WHEN** a controller updates an endpoint record, or a permission proof records a denial, on an agent that was provisioned earlier
- **THEN** those events MUST NOT appear among that agent's provisioning steps

#### Scenario: Completion is reported for the identity track alone

- **WHEN** provisioning progress is read
- **THEN** completion MUST reflect the ENS track only, and the registry, verification, discovery and financial tracks MUST be reported with their own separate states

### Requirement: The API serves the product contract

The API SHALL expose the agent, permission, record, verification, discovery, wallet, payment, and activity operations the console needs, under the existing version prefix.

#### Scenario: Agent listing carries per-integration status

- **WHEN** the agent list is requested
- **THEN** each entry MUST carry its identity, discovery, and financial status separately

#### Scenario: Identity returns live ENS state

- **WHEN** an agent's identity is requested
- **THEN** the response MUST include owner, resolver, registry, the published records, and the verification result, each read for that request

#### Scenario: Permissions are returned per record and per registry action

- **WHEN** permissions are requested for a controller
- **THEN** the response MUST answer per text key and per registry action, and MUST name the system the answers were derived from

#### Scenario: Discovery returns candidates with their evidence

- **WHEN** a discovery request is served
- **THEN** the response MUST include the ranked candidates, the signals used, the explanation, and the data source

#### Scenario: Payment responses are typed

- **WHEN** a payment is attempted
- **THEN** the response MUST be one of executed, denied, pending approval, or failed, and a denial MUST carry its reason

#### Scenario: Approval status is returned only when implemented

- **WHEN** a pending-approval status would be returned
- **THEN** it MUST correspond to an implemented provider flow

### Requirement: Externally-derived responses carry a read time

Any response field read from a chain, a subgraph, or a provider SHALL be accompanied by the time it was read.

#### Scenario: Chain and Graph payloads are timestamped

- **WHEN** a response contains ENS state, verification results, or Graph results
- **THEN** it MUST include the time that state was read

#### Scenario: A response without a read time is incomplete

- **WHEN** an externally-derived payload omits its read time
- **THEN** the response MUST be treated as incomplete, because a permission or verification result without a read time cannot be evaluated for staleness

### Requirement: Responses never carry secret material

The API SHALL NOT return provider secrets, authorization keys, or server signing material in any response.

#### Scenario: Financial metadata is filtered

- **WHEN** wallet or policy state is returned
- **THEN** it MUST contain only the address, the provider, the agent association, and a policy summary, and MUST NOT contain credentials or configuration that reveals them

#### Scenario: Configuration endpoints expose only public values

- **WHEN** demo configuration is served
- **THEN** it MUST contain only values safe for the browser — the parent name, the chain, public addresses, and public provider identifiers

#### Scenario: A missing secret fails before the external call

- **WHEN** a route requiring a provider secret is invoked without it
- **THEN** the failure MUST name the absent variable and MUST occur before any external request is made

### Requirement: Denials are responses, not errors

An authority or policy denial SHALL be returned as a successful response describing the denial.

#### Scenario: An EAC revert is a described outcome

- **WHEN** a write is rejected by the resolver's access control
- **THEN** the API MUST return a denied outcome naming the source, rather than a generic server error

#### Scenario: A provider denial is a described outcome

- **WHEN** a payment is rejected by policy
- **THEN** the API MUST return a denied status with its reason, and MUST NOT surface it as an internal error

### Requirement: Every request carries an id

The API SHALL assign each request an id, return it on the response, and use it to connect the response to every log line the request produces.

#### Scenario: An id is generated when none is sent

- **WHEN** a request arrives without an `X-Request-Id` header
- **THEN** the response MUST carry an `X-Request-Id` header with a newly generated id

#### Scenario: An inbound id is reused

- **WHEN** a request arrives with an `X-Request-Id` header of acceptable length
- **THEN** the response MUST carry that same id, and every log line the request produces MUST use it

#### Scenario: An inbound id is bounded

- **WHEN** a request arrives with an `X-Request-Id` longer than 255 characters
- **THEN** that value MUST NOT be used as the request's id

#### Scenario: Browsers can read the id

- **WHEN** a cross-origin request from an allowed origin, or any request to an agent MCP route, is answered
- **THEN** the response MUST list `X-Request-Id` in `Access-Control-Expose-Headers`

#### Scenario: Every failure body names its request

- **WHEN** the API answers with an error body of its own making: a 404, the status of an `HTTPException`, a 500, or an agent MCP route's 503
- **THEN** the JSON body MUST include `requestId` equal to the response's `X-Request-Id` header

### Requirement: The process log is single-line flat JSON

Every line the API process writes SHALL be one JSON object on one line whose values are strings, numbers or booleans, so the platform's log explorer can filter on each field.

#### Scenario: One line per request

- **WHEN** a request completes
- **THEN** exactly one request line MUST be written, carrying `level`, `message`, `requestId`, `method`, `path`, `status` and `durationMs`

#### Scenario: Level follows status

- **WHEN** a request completes with a 5xx status, a 4xx status, or any other status
- **THEN** its line's level MUST be `error`, `warn`, or `info` respectively, except a successful `GET /health`, which MUST be logged at `debug`

#### Scenario: Values are never nested

- **WHEN** any line is written
- **THEN** it MUST parse as a JSON object with no object or array values, and MUST contain no newline before its terminator

#### Scenario: The query string is not logged

- **WHEN** a request with a query string completes
- **THEN** its line's `path` MUST NOT include the query string

#### Scenario: Log output is testable without the console

- **WHEN** the application is constructed with a log sink
- **THEN** every line MUST be written to that sink and none to the process's stdout

### Requirement: Failures reach the log with their request

No error raised while serving a request, or in work a request starts and does not await, SHALL be discarded without a log line carrying that request's id.

#### Scenario: An unhandled error is logged under the request's id

- **WHEN** a handler throws an error that is not an `HTTPException`
- **THEN** an `error` line MUST be written with the error's name, message and stack and the same `requestId` as the request line, and the request line MUST record status 500

#### Scenario: Work after the response logs its failure

- **WHEN** provisioning started by a creation request fails after the 202 was sent
- **THEN** an `error` line carrying the creating request's id and the agent's id MUST be written before any attempt to record the failure in the store

#### Scenario: A failure to record a failure is itself logged

- **WHEN** recording a provisioning failure in the store also fails
- **THEN** a further `error` line MUST be written naming the write that failed, and the error MUST NOT be discarded

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

