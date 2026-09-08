## ADDED Requirements

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
- **THEN** the response MUST be 500 with a generic message, and the detail MUST go to the server log rather than the body

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
