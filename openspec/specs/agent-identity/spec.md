# agent-identity Specification

## Purpose

How an agent's public identity is published on ENS and bound to an ERC 8004 registration — the ENSIP 26 record set, the Agent Manifest as a read-through view rather than a stored object, the ENSIP 25 key construction, and runtime verification with a status model that distinguishes a missing registry claim from a missing ENS record from a mismatch.

## Requirements

### Requirement: Agents publish a standardised public identity

Each agent SHALL publish its identity as ENSIP 26 text records on its own subname. `agent-context` and `agent-endpoint[mcp]` are required; `agent-endpoint[a2a]` and `agent-endpoint[web]` are optional.

#### Scenario: Required records are present

- **WHEN** an agent is reported as provisioned
- **THEN** `agent-context` and `agent-endpoint[mcp]` MUST both resolve to non-empty values on that agent's name

#### Scenario: Agent context is machine-parseable

- **WHEN** `agent-context` is written
- **THEN** its value MUST be JSON that parses, and MUST carry at least the agent's name, role, description, and declared capabilities

#### Scenario: Endpoints are reachable claims, not decoration

- **WHEN** an endpoint record is published
- **THEN** its value MUST be a syntactically valid URL, and the system MUST NOT advertise a protocol whose endpoint does not exist

#### Scenario: Optional records are absent rather than empty

- **WHEN** an agent has no A2A or web endpoint
- **THEN** the record MUST be unset, and consumers MUST render the capability as absent rather than as an empty string

### Requirement: The Agent Manifest is a view, not a record

The combined identity surface SHALL be assembled per request from ENS records and linked registry state. The system SHALL NOT persist it as an authoritative object.

#### Scenario: Manifest fields name their source

- **WHEN** the manifest is presented
- **THEN** each field MUST be attributable to the system it was read from — ENS, the ERC 8004 registry, the Graph, or Privy

#### Scenario: A changed record changes the manifest

- **WHEN** a text record is updated on chain and the manifest is requested again
- **THEN** the manifest MUST reflect the new value without any application-side invalidation step

#### Scenario: The manifest is never served from the store

- **WHEN** the manifest is assembled
- **THEN** its identity, endpoint, and trust fields MUST come from their authoritative systems, and MUST NOT be read from the coordination store

### Requirement: ERC 8004 registration binds to the ENS name

At least one demo agent SHALL hold an ERC 8004 registration in the Sepolia IdentityRegistry whose registration claims that agent's ENS name.

#### Scenario: Registration exists on chain

- **WHEN** the identity registry is queried for the demo agent
- **THEN** it MUST return a registration, and its transaction hash MUST be recorded as evidence

#### Scenario: Registration claims the ENS name

- **WHEN** the registration is read
- **THEN** the ENS name it claims MUST equal the agent's subname under the parent namespace

#### Scenario: Registry addresses are confirmed before use

- **WHEN** an ERC 8004 registry address is used to construct a key or send a transaction
- **THEN** `getCode` MUST have returned non-empty for that address on that chain, because the addresses are sourced from a repository rather than from chain

### Requirement: ENSIP 25 binding is written under organization authority

The ENSIP 25 verification record SHALL be written from the organization key only. The agent controller SHALL NOT hold a grant for that key.

#### Scenario: The key is constructed to specification

- **WHEN** the ENSIP 25 key is built
- **THEN** it MUST be `agent-registration[<registry>][<agentId>]` with `<registry>` an ERC 7930 v1 interoperable address as a lowercase `0x` hex string, `<agentId>` a minimal decimal string with no leading zeros, and no whitespace anywhere in the key

#### Scenario: The chain reference is minimal, not padded

- **WHEN** the ERC 7930 registry component is encoded
- **THEN** the chain reference MUST be minimal big-endian bytes — Sepolia is `0xaa36a7` with length 3 — because zero-padding produces a valid-looking key that resolves to empty

#### Scenario: The record value is non-empty

- **WHEN** the binding is written
- **THEN** the value MUST be non-empty and SHOULD be `"1"`, since the meaning is carried by the key and its presence

#### Scenario: The controller cannot rewrite the binding

- **WHEN** the agent controller attempts `setText` on the ENSIP 25 key
- **THEN** the transaction MUST revert, and the denial MUST come from the absence of a grant rather than from an application check

### Requirement: Verification runs at runtime and reports a specific state

The system SHALL verify the ENSIP 25 association by starting from the registry entry, constructing the key, and resolving it on the claimed name. The result SHALL be one of the defined states and SHALL NOT collapse distinct failures into a single unverified value.

#### Scenario: A valid binding verifies

- **WHEN** the registry claims the name and the constructed key resolves to a non-empty value
- **THEN** the status MUST be `verified`

#### Scenario: Failure modes stay distinguishable

- **WHEN** verification fails
- **THEN** the status MUST identify which step failed — `registry_claim_missing`, `ens_record_missing`, `mismatch`, or `rpc_error` — and MUST NOT report a generic failure

#### Scenario: A mis-encoded key is not reported as an unverified agent

- **WHEN** a key is constructed with a checksummed registry address, a padded chain reference, or a non-canonical agent id
- **THEN** the resulting empty read MUST be treated as a construction fault in tests, because it is indistinguishable at runtime from an honest `ens_record_missing`

#### Scenario: Verification carries a read time

- **WHEN** a verification result is returned
- **THEN** it MUST include the time it was read from chain

#### Scenario: A cached result is never presented as current

- **WHEN** the owner of the agent subname has changed since a verification was observed
- **THEN** the system MUST re-verify before reporting the name as verified, because ENSIP 25 states that a transfer leaves the record intact while invalidating the attestation it stood for

### Requirement: Identity verification is not a trust claim

The system SHALL distinguish identity verification from endpoint availability and from trust signals, and SHALL NOT imply that a verified ENS binding makes an agent safe to use.

#### Scenario: Labels stay separate

- **WHEN** identity, endpoint, and trust state are displayed together
- **THEN** they MUST carry distinct labels, and a verified binding MUST NOT be presented as an endorsement of the agent's behaviour
