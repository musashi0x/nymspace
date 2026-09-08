## REMOVED Requirements

### Requirement: The web application is the only server

**Reason**: The principal chose a dedicated backend after the scaffold landed, and `apps/api` exists. The requirement was written to stop a second server being added casually; that decision has now been made deliberately, so the requirement's purpose is served and its text is false.

**Migration**: Replaced by "Domain logic has one implementation across servers", which keeps the constraint that actually mattered — one implementation of each integration, reachable from any process — and drops the count of servers, which never did. Both scenarios under the removed requirement are carried forward there in stronger form.

## ADDED Requirements

### Requirement: Domain logic has one implementation across servers

The repository MAY contain more than one server application. Every integration SHALL have exactly one implementation, living in a package, and each server SHALL consume it rather than reimplement it.

#### Scenario: A secret-bearing operation goes through a package

- **WHEN** an ENS write, a Graph query, or a Privy payment is exposed over HTTP
- **THEN** the handler MUST import a domain package, and MUST NOT reimplement the call inline

#### Scenario: The same integration is not written twice

- **WHEN** two servers expose the same integration
- **THEN** both MUST reach it through the same package export, so that ENSv2 beta churn has one blast radius

#### Scenario: Packages remain process-agnostic

- **WHEN** a domain package is written
- **THEN** it MUST NOT depend on the request or response types of any framework, so that a Next route handler, a standalone server, and a script can all import it unchanged

#### Scenario: A server application owns no domain logic

- **WHEN** a server application is inspected
- **THEN** it MUST contain only transport concerns — routing, validation, serialisation, and configuration of its own process

## MODIFIED Requirements

### Requirement: Server-only code cannot reach the browser

Packages that read secrets or sign transactions SHALL be prevented at build time from being imported into client code, and SHALL remain importable by every server process.

#### Scenario: Entrypoints are guarded

- **WHEN** the entrypoint of a package that reads credentials is compiled
- **THEN** it MUST import `server-only`, so that importing it from a client component fails the build

#### Scenario: Pure helpers stay importable

- **WHEN** a helper needs no secrets, such as a type definition or an address encoder
- **THEN** it MUST be exported from a path that is not behind the `server-only` guard

#### Scenario: Only public variables cross the boundary

- **WHEN** a value is read in code that runs in the browser
- **THEN** it MUST come from the public environment surface, and a secret MUST NOT be readable from any client-reachable module

#### Scenario: The guard does not lock out non-Next consumers

- **WHEN** a guarded package is imported by a process that is not Next.js — a standalone server, or a script run through `tsx`
- **THEN** that entrypoint MUST run with the `react-server` export condition enabled, because `server-only` resolves its throwing module under every other condition and the resulting error names Client Components, which is misleading in a process that has none

#### Scenario: The condition is enforced, not remembered

- **WHEN** a non-Next entrypoint is declared in a `package.json` script
- **THEN** a check MUST fail if it does not enable the `react-server` condition, so the constraint is caught before the confusing error is hit
