# financial-authority Specification

## Purpose

How an agent's spending is constrained through Privy — wallet provisioning, one enforceable policy, a payment inside the boundary, a payment outside it, and the separation between policy authority and signing authority.

## Requirements

### Requirement: An agent wallet exists under Privy

At least one demo agent SHALL have a Privy wallet, and the application SHALL be able to load it by agent without re-creating it.

#### Scenario: The wallet is addressable

- **WHEN** an agent's wallet is requested
- **THEN** the response MUST include the wallet address and the provider, and MUST be the same wallet across process restarts

#### Scenario: The ownership model is recorded

- **WHEN** the wallet is provisioned
- **THEN** the chosen ownership model MUST be recorded in the repository, because it determines who can change the policy

#### Scenario: Wallet mapping survives restart

- **WHEN** the process restarts and the agent is inspected
- **THEN** the wallet MUST be reloaded from the stored identifier rather than created again

### Requirement: Exactly one enforceable control is configured

The system SHALL configure at least one real Privy control that constrains what the agent's signer may do. Enforcement SHALL occur in Privy, not in application logic.

#### Scenario: The control is real

- **WHEN** the control is configured
- **THEN** it MUST be a Privy policy, restricted signer, quorum, or intent, using Privy's current API, and MUST NOT be an application-side branch on the amount

#### Scenario: The limit shown matches the limit enforced

- **WHEN** a policy limit is displayed
- **THEN** the displayed value MUST be read from the configured policy rather than from an application constant

#### Scenario: A policy that denies nothing fails the gate

- **WHEN** the control is verified
- **THEN** a payment outside the boundary MUST be attempted first, because a policy that permits everything demonstrates as a success

### Requirement: An in-policy payment executes

The agent SHALL be able to execute one payment inside the configured boundary.

#### Scenario: The allowed payment succeeds

- **WHEN** a payment within the configured limit is submitted
- **THEN** the result MUST be an executed status carrying a transaction hash

#### Scenario: The executed payment is evidenced

- **WHEN** a payment executes
- **THEN** its transaction hash MUST be recorded as an activity event with the Privy source

### Requirement: An out-of-policy payment is denied by Privy

A payment outside the configured boundary SHALL be rejected by Privy, and the rejection SHALL be surfaced as a typed result rather than an exception.

#### Scenario: The denial is typed

- **WHEN** a payment exceeding the limit is submitted
- **THEN** the result MUST be a denied status carrying a policy reason, and the caller MUST render it rather than treat it as a crash

#### Scenario: No funds move

- **WHEN** a payment is denied
- **THEN** no transaction MUST be broadcast, and the response MUST state that no funds moved

#### Scenario: Frontend tampering does not change enforcement

- **WHEN** a displayed limit is altered in the browser and an over-limit payment is submitted
- **THEN** Privy MUST still deny it, proving enforcement is not in the UI

#### Scenario: Approval escalation is claimed only if implemented

- **WHEN** a denial is presented
- **THEN** an approval path MUST be offered only if that Privy flow is actually implemented, and MUST NOT be simulated

### Requirement: A denial is attributable to the policy

A rejected payment SHALL be reported as a policy denial only when the policy is the binding constraint. Rejections with incidental causes SHALL NOT be presented as proof that the control works.

#### Scenario: Funding cannot explain the denial

- **WHEN** an over-limit payment is denied
- **THEN** the wallet balance MUST have exceeded the requested amount, so that insufficient funds is eliminated as the cause

#### Scenario: Recipient and token cannot explain the denial

- **WHEN** a denial is compared against an execution
- **THEN** both MUST have used the same wallet, token, and recipient, so that the amount is the only variable

#### Scenario: The constraint is proven by moving it

- **WHEN** the policy limit is raised above the previously denied amount and the identical request is resubmitted
- **THEN** the payment MUST execute, and restoring the limit MUST restore the denial, because this is the only observation that distinguishes an enforced policy from an integration that rejects everything

#### Scenario: A control that denies nothing fails

- **WHEN** the control is verified
- **THEN** the out-of-boundary case MUST be exercised before the in-boundary case is accepted, since a policy permitting everything presents as an unbroken success

### Requirement: Policy authority is separate from signing authority

The routine agent signer SHALL NOT be able to modify its own constraints.

#### Scenario: The signer cannot raise its own limit

- **WHEN** the agent signer's authority is inspected
- **THEN** it MUST NOT include the ability to change or remove the policy that constrains it

#### Scenario: The separation mirrors the identity model

- **WHEN** the authority model is described
- **THEN** it MUST state the same split as the identity side — a higher authority configures the boundary, a lower authority acts within it

### Requirement: Financial secrets never leave the server

Privy credentials SHALL be confined to the server and SHALL NOT reach a client bundle, a response body, or a model prompt.

#### Scenario: Credentials are absent from responses

- **WHEN** any wallet or payment response is produced
- **THEN** it MUST NOT contain the app secret, the authorization key id, the authorization private key, or any raw signing material

#### Scenario: Missing credentials fail before a request is served

- **WHEN** a financial route is invoked with an incomplete credential set
- **THEN** the failure MUST name the absent variable and MUST occur before any external call

#### Scenario: Only safe metadata is displayed

- **WHEN** financial state is rendered
- **THEN** it MAY show the wallet address, the agent association, a policy summary, the signer mode, and the last action, and MUST NOT show configuration that reveals credentials
