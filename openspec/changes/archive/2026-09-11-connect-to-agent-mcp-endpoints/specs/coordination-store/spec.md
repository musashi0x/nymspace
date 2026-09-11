## MODIFIED Requirements

### Requirement: Activity is a unified event log with per-source provenance

All external actions SHALL be normalised into one event stream that records which system produced the event and what evidence it carries.

#### Scenario: Every event names its source and status

- **WHEN** an event is written
- **THEN** it MUST identify its source system and a status of pending, success, denied, or failed

#### Scenario: Evidence matches the source

- **WHEN** an event is written
- **THEN** an ENS event MUST carry a transaction hash, a Graph event MUST carry the chain, subgraph identifier, and query time, a financial event MUST carry a request identifier or transaction hash, and an MCP event MUST carry the endpoint, the source that published it, the outcome, and the read time

#### Scenario: Denied and failed events are retained

- **WHEN** an action is denied or fails
- **THEN** its event MUST be recorded and retained, because a denial is evidence that the control plane worked

#### Scenario: A pending event resolves in place

- **WHEN** a pending external operation completes
- **THEN** its event MUST be updated rather than duplicated

#### Scenario: The source set is enforced by the database

- **WHEN** an event is written with a source outside `ens`, `erc8004`, `graph`, `privy`, `app`, and `mcp`
- **THEN** the database MUST reject it, and the permitted set MUST be widened only by a generated, committed migration
