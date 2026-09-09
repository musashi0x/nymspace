## ADDED Requirements

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
