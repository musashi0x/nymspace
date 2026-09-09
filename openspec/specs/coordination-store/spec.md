# coordination-store Specification

## Purpose

The application's own persistence — which entities it may hold, which values it must never treat as authoritative, and the unified activity event with per-source provenance.

## Requirements

### Requirement: The store coordinates and does not adjudicate

The application's persistence SHALL hold identifiers, labels, and events. It SHALL NOT be the authority for ENS identity, ENS permissions, ERC 8004 trust state, or financial policy.

#### Scenario: Only coordination data is stored

- **WHEN** an entity is persisted
- **THEN** it MAY hold local slugs, ENS names, controller addresses, ERC 8004 agent ids, wallet ids, UI labels, and provisioning status, and MUST NOT hold a permission decision or a trust score as an authoritative value

#### Scenario: Authoritative values are read, not recalled

- **WHEN** a value has an authoritative system and that system is reachable
- **THEN** the value MUST be read from that system for the request rather than served from the store

#### Scenario: The store is not consulted for authority

- **WHEN** a permission or verification answer is produced
- **THEN** it MUST originate from a contract read, and the store MUST NOT be able to change the answer

### Requirement: Cached external state is labelled and timed

Where an external value is cached for latency, the cache SHALL be identifiable as a cache.

#### Scenario: A snapshot carries its read time

- **WHEN** an identity, trust, or wallet snapshot is stored
- **THEN** it MUST carry the time it was fetched, and that time MUST travel with the value to the interface

#### Scenario: A stale snapshot is not presented as live

- **WHEN** a cached value is displayed
- **THEN** it MUST be distinguishable from a value read during the current request

#### Scenario: A refresh bypasses the cache

- **WHEN** a refresh is requested
- **THEN** the system MUST read from the authoritative source and MUST NOT return the cached value

### Requirement: Activity is a unified event log with per-source provenance

All external actions SHALL be normalised into one event stream that records which system produced the event and what evidence it carries.

#### Scenario: Every event names its source and status

- **WHEN** an event is written
- **THEN** it MUST identify its source system and a status of pending, success, denied, or failed

#### Scenario: Evidence matches the source

- **WHEN** an event is written
- **THEN** an ENS event MUST carry a transaction hash, a Graph event MUST carry the chain, subgraph identifier, and query time, and a financial event MUST carry a request identifier or transaction hash

#### Scenario: Denied and failed events are retained

- **WHEN** an action is denied or fails
- **THEN** its event MUST be recorded and retained, because a denial is evidence that the control plane worked

#### Scenario: A pending event resolves in place

- **WHEN** a pending external operation completes
- **THEN** its event MUST be updated rather than duplicated

### Requirement: Provisioning state is per-integration, not global

The store SHALL track each integration's progress separately.

#### Scenario: Identity and financial progress are independent

- **WHEN** provisioning state is recorded
- **THEN** identity progress and financial progress MUST be tracked separately, so that an agent with no wallet is not reported as failed

#### Scenario: No single active flag hides an incomplete integration

- **WHEN** an agent's readiness is reported
- **THEN** it MUST NOT be collapsed into one status that conceals which integration is incomplete

### Requirement: No secret material is persisted in the application store

Signing keys and provider secrets SHALL NOT be written to the application database.

#### Scenario: Only references are stored

- **WHEN** financial state is persisted
- **THEN** it MUST hold provider identifiers and addresses only, and MUST NOT hold authorization keys or raw signing material

### Requirement: The store survives restart without carrying the demo

Persistence SHALL be durable across process restarts, and the demo SHALL NOT depend on anything the store holds beyond identifiers.

#### Scenario: Identifiers reconnect the external systems

- **WHEN** the process restarts
- **THEN** the stored ENS names, agent ids, and wallet ids MUST be sufficient to reload every external state the console displays

#### Scenario: In-memory state is not load-bearing

- **WHEN** the process restarts mid-demo
- **THEN** no step of the demo MUST require state that existed only in memory
