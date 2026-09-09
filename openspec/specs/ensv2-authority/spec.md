# ensv2-authority Specification

## Purpose

The organization's authority over its own ENSv2 namespace — how a parent name is owned and wired to a subregistry, how agent subnames are registered beneath it, how a single named text record is delegated to a separate controller address while every undelegated action stays denied by the contract, and how all of that permission state is derived from chain reads rather than from a local database or a hardcoded table. Proven end to end on ENSv2 Sepolia by `packages/ens/scripts/spike-ensv2.ts`, which passed 30/30 assertions plus a 3/3 fresh-process re-read.

## Requirements

### Requirement: Parent namespace hosts resolving subnames

The organization SHALL control a parent name on ENSv2 Sepolia whose subregistry is wired into the ENS hierarchy, such that subnames registered under it resolve through the Universal Resolver.

#### Scenario: Parent name is owned

- **WHEN** the parent label is queried on the `.eth` registry
- **THEN** the returned owner MUST be the organization address

#### Scenario: Parent has a subregistry

- **WHEN** `getSubregistry()` is called for the parent label on the `.eth` registry
- **THEN** it MUST return a non-zero UserRegistry address

#### Scenario: Subregistry is wired before any subname is trusted

- **WHEN** a subname is registered while the parent's subregistry is the zero address
- **THEN** the system MUST treat that subname as unresolvable and MUST NOT report it as a working agent identity

#### Scenario: Registry retains its own grant authority

- **WHEN** the UserRegistry proxy is initialized
- **THEN** the role bitmap passed to `initialize()` MUST include `ROLE_REGISTRAR_ADMIN` and `ROLE_RENEW_ADMIN`, so that registrar and renewal roles can be granted later without redeploying

### Requirement: Agent subname registration

The organization SHALL register an agent subname under the parent namespace, with a resolver attached, and SHALL be the owner of that subname.

#### Scenario: Subname is registered with a resolver

- **WHEN** the organization registers a label under its UserRegistry
- **THEN** the transaction MUST succeed, the owner MUST be the organization address, and the resolver for the subname MUST be non-zero

#### Scenario: Organization retains reclaim authority

- **WHEN** an agent subname exists and the organization holds root roles on the registry
- **THEN** the organization MUST still be able to `setResolver`, `setSubregistry`, and `unregister` that name, and this retained authority MUST be stated rather than implied, because it is the product's premise and not an oversight

#### Scenario: Registration path is verified before use

- **WHEN** the organization's roles on `ROOT_RESOURCE` of its UserRegistry are read
- **THEN** the result MUST show whether `ROLE_REGISTRAR` is held, determining whether `register()` can be called directly or a registrar contract is required

### Requirement: Organization holds resolver grant authority

The organization SHALL control the resolver that its agent subnames point at, holding the admin role required to grant text-record permissions before any delegation is attempted. Resolver authority does not derive from registry ownership; it exists only as roles held on the resolver contract.

#### Scenario: Resolver is owned by the organization

- **WHEN** the resolver an agent subname points at is inspected
- **THEN** it MUST be a proxy the organization initialized, holding roles on `ROOT_RESOURCE`

#### Scenario: Grant authority is checked with the contract's own predicate

- **WHEN** grant authority is checked before delegating
- **THEN** the check MUST use `hasRoles(resource(namehash, 0), ROLE_SET_TEXT_ADMIN, organization)`, which ORs the account's `ROOT_RESOURCE` roles with its resource-specific roles, and MUST NOT use `roles()`, which returns raw per-resource storage and omits root-granted roles

#### Scenario: Missing admin authority halts the build

- **WHEN** the organization cannot grant `ROLE_SET_TEXT` on the agent subname
- **THEN** the spike MUST report a no-go result and MUST NOT proceed to downstream integration work

### Requirement: Record-level delegation to an agent controller

The organization SHALL grant an agent controller permission to set exactly one named text record, scoped to that record, using `authorizeTextRoles`. The organization SHALL NOT grant name-level `ROLE_SET_TEXT`.

#### Scenario: Single record key is delegated

- **WHEN** the organization calls `authorizeTextRoles(dnsEncodedName, "agent-endpoint[mcp]", controller, true)`
- **THEN** the transaction MUST succeed

#### Scenario: Delegation is scoped, not broad

- **WHEN** the controller's roles are read on the name-level resource for the agent subname
- **THEN** the result MUST NOT include `ROLE_SET_TEXT` at name scope

#### Scenario: The wildcard resource is never granted

- **WHEN** any text-record permission is granted
- **THEN** it MUST be scoped to `resource(namehash, partHash(key))`, and no account may hold roles at `resource(0, partHash(key))`, which would authorize that key on every name served by the resolver

#### Scenario: Broad grant helpers are not used

- **WHEN** permissions are granted on the resolver
- **THEN** the implementation MUST use the `authorize*` family, because `grantRoles()` and `revokeRoles()` are disabled on the Permissioned Resolver

### Requirement: Delegated write succeeds

The agent controller SHALL be able to write the delegated text record and the written value SHALL be readable from chain.

#### Scenario: Controller writes its endpoint

- **WHEN** the controller calls `setText(node, "agent-endpoint[mcp]", url)`
- **THEN** the transaction MUST succeed and a transaction hash MUST be recorded

#### Scenario: Written value reads back

- **WHEN** the record is read after confirmation
- **THEN** the returned value MUST equal the value the controller wrote

### Requirement: Undelegated actions are denied by the contract

The agent controller SHALL be unable to perform any action that was not explicitly delegated, and each denial SHALL originate from contract enforcement rather than application logic.

#### Scenario: Unrelated text key is denied

- **WHEN** the controller attempts `setText` on a text key it was not granted
- **THEN** the transaction MUST revert

#### Scenario: ENSIP 25 verification key is denied

- **WHEN** the controller attempts `setText` on the `agent-registration[<registry>][<agentId>]` key
- **THEN** the transaction MUST revert, proving that operational endpoint authority is separate from identity-binding authority

#### Scenario: Resolver change is denied

- **WHEN** the controller attempts `setResolver` on the agent subname
- **THEN** the transaction MUST revert

#### Scenario: Denials are not simulated

- **WHEN** a denied action is reported to a user or a judge
- **THEN** the denial MUST correspond to an actual reverted transaction or a failed contract read, and MUST NOT be produced by application-side branching

### Requirement: Permission state is derived from chain

The system SHALL derive all displayed permission state from contract reads, using the resolver's own resource scheme, and SHALL NOT read permission state from a local database or hardcoded table.

#### Scenario: Record resource is derived correctly

- **WHEN** the EAC resource for a text key is computed as `keccak256(node, partHash(key))` with `partHash(key) = keccak256(bytes(key))`
- **THEN** `hasRoles(resource, ROLE_SET_TEXT, controller)` for a key known to be granted MUST return true

#### Scenario: The UI predicate mirrors the contract's own fallback chain

- **WHEN** the UI answers "may this account set this key"
- **THEN** it MUST evaluate the same alternatives `onlyPartRoles` accepts: `hasRoles` on `resource(node, part)`, on `resource(0, part)`, or on `resource(node, 0)`, so that a name-level or wildcard grant is not displayed as an absence of permission

#### Scenario: Raw storage reads are used only to prove scoping

- **WHEN** asserting that a grant is record-scoped rather than name-scoped
- **THEN** `roles()` is the correct call, because the assertion is about what is stored at that resource and not about effective authority

#### Scenario: A negative read is trusted only after a positive control

- **WHEN** a permission read returns no roles
- **THEN** the same code path MUST have already returned a positive result for a known grant, so that a wrong resource derivation is not mistaken for a denial

#### Scenario: Permission state survives process restart

- **WHEN** the permission state is queried in a fresh process with no cached data
- **THEN** the returned state MUST match the previous result, because it is read from chain

### Requirement: Spike produces reviewable evidence

The spike SHALL emit a machine-readable and human-readable record of every assertion, so the Day 1 gate decision rests on evidence rather than recollection.

#### Scenario: Pass and fail lines are printed

- **WHEN** the spike completes
- **THEN** it MUST print one pass or fail line per assertion, including the delegated write, both denials, and the permission read-back

#### Scenario: Transaction hashes are captured

- **WHEN** any transaction is sent
- **THEN** its hash MUST be recorded in the spike output

#### Scenario: Configuration is externalized

- **WHEN** the spike runs
- **THEN** all contract addresses, the RPC URL, the parent label, and both keys MUST come from environment configuration, and no address may be hardcoded in source

### Requirement: Authority state is treated as perishable

Permission grants and identity attestations SHALL be treated as valid only relative to the current owner of the name. ENSIP 25 states that when an ENS name is transferred, existing verification text records may become stale, and clients should consider ownership changes when evaluating prior attestations. The system SHALL NOT present a cached or previously-observed authority result as current.

#### Scenario: Verification results carry a read time

- **WHEN** an ENSIP 25 verification result or a permission read is displayed
- **THEN** it MUST be accompanied by the time it was read from chain

#### Scenario: Ownership change invalidates a prior attestation

- **WHEN** the owner of an agent subname has changed since an attestation was observed
- **THEN** the system MUST re-verify before reporting the name as verified, and MUST NOT report the earlier result as current

#### Scenario: Re-registration does not carry stale permissions

- **WHEN** an expired name that had a previous owner is re-registered
- **THEN** the registry's version counters increment and the prior token is burned, so previously granted permissions MUST NOT appear in a fresh permission read

#### Scenario: Revocation is reflected without restart

- **WHEN** the organization revokes a record grant with `authorizeTextRoles(..., controller, false)`
- **THEN** the next permission read MUST show the role absent, without any cache invalidation step in the application

### Requirement: Fleet provisioning is parameterised, not enumerated

The provisioning sequence SHALL be callable with an agent's own details, and SHALL have exactly one implementation shared by every caller.

#### Scenario: The script and the product run the same code

- **WHEN** an agent is provisioned from the fleet script or from the product API
- **THEN** both MUST execute the same sequence, so no caller can drift from the delegation policy the other enforces

#### Scenario: Delegation is off unless asked for

- **WHEN** a provisioning request does not ask for delegation
- **THEN** the controller MUST receive no record grant, so a fleet retains at least one name against which grant leakage can be checked

### Requirement: A created agent's controller reaches only its endpoint keys

Provisioning SHALL grant the controller `SET_TEXT` on the agent's endpoint record keys and nothing else.

#### Scenario: The organization's own keys stay with the organization

- **WHEN** provisioning completes for a delegated agent
- **THEN** a live permission read MUST show the controller allowed on the granted endpoint keys and denied on `agent-context`, on any ENSIP 25 registration key, and on the registry capabilities

#### Scenario: Provisioning does not complete on unchecked authority

- **WHEN** the final read-back finds the controller able to write a key it was never granted
- **THEN** the ENS track MUST be reported failed rather than active
