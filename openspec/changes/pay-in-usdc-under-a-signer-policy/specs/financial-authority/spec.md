## MODIFIED Requirements

### Requirement: Exactly one enforceable control is configured

The system SHALL configure at least one real Privy control that constrains what the agent's signer may do. Enforcement SHALL occur in Privy, not in application logic. When the demo transacts in a token, the control SHALL constrain the token contract and the transferred amount, read from the transaction's calldata.

#### Scenario: The control is real

- **WHEN** the control is configured
- **THEN** it MUST be a Privy policy, restricted signer, quorum, or intent, using Privy's current API, and MUST NOT be an application-side branch on the amount

#### Scenario: The limit shown matches the limit enforced

- **WHEN** a policy limit is displayed
- **THEN** the displayed value MUST be read from the configured policy rather than from an application constant, and MUST be displayed in the units of the token it constrains

#### Scenario: The control names the token

- **WHEN** the demo transacts in an ERC 20
- **THEN** the policy MUST pin the token contract as well as the amount, so that a transfer of a different token is outside the boundary rather than unconstrained by it

#### Scenario: An amount carries its unit

- **WHEN** an amount crosses a boundary — a request body, a stored event, a rendered field
- **THEN** it MUST be expressed in the token's base units with the token identified alongside it, and MUST NOT be a floating point number

#### Scenario: A policy that denies nothing fails the gate

- **WHEN** the control is verified
- **THEN** a payment outside the boundary MUST be attempted first, because a policy that permits everything demonstrates as a success

### Requirement: Policy authority is separate from signing authority

The routine agent signer SHALL NOT be able to modify its own constraints. The constraint SHALL be attached to the agent's signing authority, and a distinct higher authority SHALL own the wallet.

#### Scenario: The signer cannot raise its own limit

- **WHEN** the agent signer's authority is inspected
- **THEN** it MUST NOT include the ability to change or remove the policy that constrains it

#### Scenario: The signer cannot reconfigure itself

- **WHEN** a wallet update that would change the agent signer's policies is submitted and signed with the agent's own authorization key
- **THEN** Privy MUST refuse it, and the signer's policies MUST be unchanged afterwards

#### Scenario: An unsigned request carries no authority

- **WHEN** a wallet request is submitted with no authorization signature
- **THEN** it MUST be refused, so that the signature is what identifies which authority is acting

#### Scenario: The separation mirrors the identity model

- **WHEN** the authority model is described
- **THEN** it MUST state the same split as the identity side — a higher authority configures the boundary, a lower authority acts within it

## ADDED Requirements

### Requirement: Approval escalation exists only when a higher authority executes it

An approval affordance SHALL be offered only when a distinct higher authority is configured and actually executes the approved payment. The affordance SHALL be derived from configuration rather than from a flag.

#### Scenario: The denial is unconditional

- **WHEN** a payment outside the boundary is submitted
- **THEN** the result MUST be a denial regardless of whether an approval path exists, and MUST state that no funds moved

#### Scenario: No higher authority, no affordance

- **WHEN** no owner signing key is configured
- **THEN** the denial MUST carry no escalation reference and the console MUST render no approval action

#### Scenario: The approval executes the request that was denied

- **WHEN** a denial is approved
- **THEN** the payment submitted MUST be the amount, recipient, and token recorded at the time of the denial, and MUST be signed by the higher authority's key rather than the agent's

#### Scenario: The approval is attributable

- **WHEN** an approved payment executes
- **THEN** the activity event MUST resolve the pending request in place and MUST record which authority executed it
