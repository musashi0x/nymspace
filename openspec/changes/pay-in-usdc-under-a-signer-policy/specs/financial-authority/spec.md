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

#### Scenario: An owned policy moves only under the owner

- **WHEN** Privy policies accept an owner
- **THEN** the agent's policy MUST be owned by the organization's key quorum, and an update to it MUST be refused when it is signed with the agent's key or carries app credentials only

#### Scenario: An unowned policy says who can move it

- **WHEN** Privy policies do not accept an owner
- **THEN** the gate evidence and the authority description MUST state that the app secret can move the limit, and MUST NOT claim that the agent's runtime cannot

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

### Requirement: A person authorizes an approval, not reachability

An approval SHALL execute only when the person approving presents an operator credential. Being able to reach the approve route SHALL NOT be enough. The claim made on screen about an approval SHALL match the custody of the key that executes it.

#### Scenario: No credential, no approval

- **WHEN** an approve request arrives without a valid operator credential
- **THEN** it MUST be refused, and nothing MUST execute

#### Scenario: The credential comes from the person

- **WHEN** the console submits an approval
- **THEN** the credential MUST be supplied by the person for that approval, and MUST NOT be read from a server environment or a stored copy

#### Scenario: The agent's path cannot approve

- **WHEN** the code that submits the agent's payments is inspected
- **THEN** it MUST NOT hold the operator credential, and the API MUST hold only a verifier from which the credential cannot be recovered

#### Scenario: The claim matches the custody

- **WHEN** the owner's key is held by the server
- **THEN** the console and the documentation MUST describe the approval as a server-held owner key gated by an operator credential, and MUST NOT describe it as the organization's key approving

### Requirement: The server cannot impersonate a browser-held owner

Once the owner's key is held in the browser, the deployed server SHALL be unable to produce an owner approval on its own. The owner SHALL stay recoverable if the browser key is lost.

#### Scenario: The server relays and does not sign

- **WHEN** the owner's key is held in the browser
- **THEN** the deployed server MUST hold no owner key, and the approval MUST be signed in the browser over a payload the server prepared from the stored denial

#### Scenario: An altered approval is refused

- **WHEN** a relayed approval's body differs from the body that was signed
- **THEN** Privy MUST refuse it, and nothing MUST execute

#### Scenario: Losing the browser does not lose the owner

- **WHEN** the browser key is lost
- **THEN** the owner quorum MUST still be satisfiable by an ops key held outside the deployment
