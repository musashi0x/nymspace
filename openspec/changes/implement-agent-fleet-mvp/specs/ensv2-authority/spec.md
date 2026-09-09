## ADDED Requirements

### Requirement: Provisioning is repeatable across a fleet

The organization SHALL provision more than one agent subname under the same parent namespace and the same resolver, each with its own record grants, without redeploying the parent registry or the resolver.

#### Scenario: Multiple agents share one parent and one resolver

- **WHEN** several agent subnames are registered
- **THEN** they MUST resolve under the same parent, MUST point at the same organization-owned resolver, and MUST NOT require a new proxy deployment per agent

#### Scenario: Grants do not leak between agents

- **WHEN** a controller is granted a text key on one agent's name
- **THEN** reading that controller's roles for the same key on another agent's name MUST show the role absent

#### Scenario: The wildcard resource stays empty for every key

- **WHEN** any granted text key is checked at the wildcard resource
- **THEN** no account MUST hold roles there, because one shared resolver means a wildcard grant would authorize that key on every agent

#### Scenario: Provisioning is complete only after read-back

- **WHEN** an agent is reported provisioned
- **THEN** chain reads MUST confirm the name exists, the resolver is set, the intended record grants are present, and the controller holds no registry authority

### Requirement: Record grants are revocable and revocation is enforced

The organization SHALL be able to revoke a previously granted text-record permission, and the revocation SHALL take effect on chain.

#### Scenario: A revoked grant disappears from the permission read

- **WHEN** the organization revokes a record grant
- **THEN** the next permission read MUST show the role absent, without any application cache invalidation

#### Scenario: A revoked controller can no longer write

- **WHEN** the controller attempts to write a key whose grant was revoked
- **THEN** the transaction MUST revert

#### Scenario: Revocation uses the resolver's authorize family

- **WHEN** a grant is revoked
- **THEN** it MUST be revoked through the resolver's authorize call with the grant flag cleared, because the generic revoke helper is disabled on the Permissioned Resolver

### Requirement: Delegation covers the operational record set

The organization SHALL grant an agent controller the operational endpoint records it needs, and SHALL grant no identity-binding or registry authority.

#### Scenario: Operational keys are delegated individually

- **WHEN** an agent's controller is configured
- **THEN** each operational key it may write MUST be granted as its own record-scoped resource, and no name-level text role MUST be granted

#### Scenario: The identity binding key is never delegated

- **WHEN** the controller's grants are enumerated
- **THEN** the ENSIP 25 verification key MUST NOT appear among them

#### Scenario: Registry authority is never delegated

- **WHEN** the controller's registry roles are read
- **THEN** it MUST hold no authority to set the resolver, set the subregistry, unregister, or transfer the name

### Requirement: A denial is attributable to authorization

A reverted transaction SHALL be reported as an authority denial only when the revert is attributable to access control. Reverts with incidental causes SHALL NOT be presented as proof that the permission model held.

#### Scenario: The revert reason is decoded

- **WHEN** a transaction reverts and is reported as denied
- **THEN** the revert MUST have been decoded and matched against the resolver's or registry's own unauthorized error, and MUST NOT be inferred from the transaction failing

#### Scenario: Incidental failures are reported as failures

- **WHEN** a transaction fails for gas, nonce, balance, or a malformed call
- **THEN** it MUST be reported as a failure, and MUST NOT be reported as an authority denial

#### Scenario: A denial is proven against a matched successful call

- **WHEN** a denial is used as evidence that delegation is scoped
- **THEN** a permitted call from the same signer, with comparable gas settings, MUST have succeeded in the same run, so that the difference between the two is the grant and not the conditions

#### Scenario: The delegating and delegated accounts are distinct

- **WHEN** delegation is demonstrated
- **THEN** the organization account and the controller account MUST be different addresses, asserted before any transaction is sent, because an identical pair makes every permitted write pass while proving nothing

### Requirement: Retained organization authority is stated, not hidden

The organization retains root roles on its own registry and can reclaim any agent subname. The product SHALL state this rather than imply agent sovereignty.

#### Scenario: Retained authority is visible

- **WHEN** the authority model is presented
- **THEN** it MUST state that the organization can set the resolver, set the subregistry, and unregister an agent subname, because the registry is deliberately unemancipated
