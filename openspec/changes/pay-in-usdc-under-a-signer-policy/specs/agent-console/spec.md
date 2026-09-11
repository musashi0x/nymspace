## MODIFIED Requirements

### Requirement: Denial is a product state, not an error

The interface SHALL distinguish pending, denied, failed, and unverified, and SHALL render authority and policy denials as successful enforcement.

#### Scenario: An EAC denial reads as policy

- **WHEN** an intentionally unauthorised transaction reverts
- **THEN** the interface MUST attribute it to identity policy, and MUST NOT render a generic failure message

#### Scenario: A policy denial reads as policy

- **WHEN** a payment is denied by the financial control
- **THEN** the interface MUST attribute it to financial policy, MUST state that no funds moved, and MUST show the denied amount and the limit in the units of the token they are denominated in

#### Scenario: The approval action follows the API

- **WHEN** a payment denial is displayed
- **THEN** the interface MUST offer `Request owner approval` only when the response carries an escalation reference, and MUST offer no approval action otherwise

#### Scenario: Infrastructure failures stay distinguishable

- **WHEN** an RPC or provider call fails
- **THEN** the interface MUST report that specific failure, and MUST NOT present it as a denial

#### Scenario: Partial identity is not failure

- **WHEN** an agent's name exists but a linked component is missing
- **THEN** the state MUST be partial, naming the missing component, rather than failed

## ADDED Requirements

### Requirement: Amounts are shown in the token they move

The payment screens SHALL take and display amounts in the units of the token the payment moves, with that token's symbol and decimals supplied by the API.

#### Scenario: Input is in token units

- **WHEN** an operator enters a payment amount
- **THEN** the input MUST be in whole-token units, and it MUST be converted to base units with the decimals the API reported for that token

#### Scenario: No denomination is a constant

- **WHEN** a limit, an amount, or a token symbol is rendered
- **THEN** it MUST come from the API response, and MUST NOT come from a constant in the console

### Requirement: The operator supplies the approval credential each time

The console SHALL ask the person for the operator credential at each approval, and SHALL keep no copy of it.

#### Scenario: The credential is asked for, not remembered

- **WHEN** the operator chooses `Request owner approval`
- **THEN** the console MUST ask for the operator credential, MUST send it only with that approve request, and MUST NOT write it to browser storage or reuse it for a later approval

#### Scenario: A refused credential is not a denial

- **WHEN** the API refuses an approve request for a missing or wrong credential
- **THEN** the interface MUST say the approval was not authorized, and MUST NOT present it as a policy denial or as a failed payment

#### Scenario: The approval names its custody

- **WHEN** an executed approval is displayed
- **THEN** it MUST appear as the same request, approved by a different authority, and its wording MUST match where the owner's key is held — a server-held owner key gated by an operator credential in phase 1, and the organization's browser-held key in phase 2

### Requirement: Phase 2 — the console holds the owner's browser key

In phase 2 the console SHALL hold the owner's P-256 key and sign approvals with it. That key is the one piece of client-side state the console holds, and the console SHALL state when it is absent.

#### Scenario: The key never leaves the browser

- **WHEN** the owner's browser key is generated
- **THEN** it MUST be generated with WebCrypto as non-extractable, and only its public half MUST leave the browser

#### Scenario: The browser signs what the server prepared

- **WHEN** the operator approves in phase 2
- **THEN** the console MUST sign the payload the API prepared from the stored denial, and MUST submit that signature without changing the payload

#### Scenario: A missing key disables approval rather than rerouting it

- **WHEN** the browser holds no owner key
- **THEN** the console MUST state that this browser cannot approve and MUST offer no approval action, and MUST NOT fall back to an approval signed on the server
