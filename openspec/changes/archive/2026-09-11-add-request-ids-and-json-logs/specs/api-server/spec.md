## MODIFIED Requirements

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

## ADDED Requirements

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
