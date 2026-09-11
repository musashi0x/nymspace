## MODIFIED Requirements

### Requirement: The API serves the product contract

The API SHALL expose the agent, permission, record, verification, discovery, wallet, payment, and activity operations the console needs, under the existing version prefix.

#### Scenario: Agent listing carries per-integration status

- **WHEN** the agent list is requested
- **THEN** each entry MUST carry its identity, discovery, and financial status separately

#### Scenario: Identity returns live ENS state

- **WHEN** an agent's identity is requested
- **THEN** the response MUST include owner, resolver, registry, the published records, and the verification result, each read for that request

#### Scenario: Permissions are returned per record and per registry action

- **WHEN** permissions are requested for a controller
- **THEN** the response MUST answer per text key and per registry action, and MUST name the system the answers were derived from

#### Scenario: Discovery returns candidates with their evidence

- **WHEN** a discovery request is served
- **THEN** the response MUST include the ranked candidates, the signals used, the explanation, and the data source

#### Scenario: Payment responses are typed

- **WHEN** a payment is attempted
- **THEN** the response MUST be one of executed, denied, pending approval, or failed, and a denial MUST carry its reason

#### Scenario: Payments name their token

- **WHEN** a payment or a payment preview is requested
- **THEN** the request MAY carry a `token` address, an absent token MUST mean the configured payment token, and the amount MUST be read as base units of that token

#### Scenario: An unrecognised token is refused

- **WHEN** a payment or a payment preview names a token other than the configured one
- **THEN** the response MUST be 400, and the request MUST NOT be sent as a native transfer or as a transfer of any other token

#### Scenario: The limit arrives with its denomination

- **WHEN** wallet state or a payment preview is returned
- **THEN** the limit MUST carry the address, symbol, and decimals of the token it constrains, read from the live policy, so the console never supplies either from a constant

#### Scenario: Approval status is returned only when implemented

- **WHEN** a pending-approval status would be returned
- **THEN** it MUST correspond to an implemented provider flow

#### Scenario: A denial offers escalation only when an owner exists

- **WHEN** a payment is denied
- **THEN** the response MUST carry an escalation reference only when an owner signing authority is configured, and MUST carry none otherwise

### Requirement: Responses never carry secret material

The API SHALL NOT return provider secrets, authorization keys, server signing material, or the operator credential in any response.

#### Scenario: Financial metadata is filtered

- **WHEN** wallet or policy state is returned
- **THEN** it MUST contain only the address, the provider, the agent association, and a policy summary, and MUST NOT contain credentials or configuration that reveals them

#### Scenario: Configuration endpoints expose only public values

- **WHEN** demo configuration is served
- **THEN** it MUST contain only values safe for the browser — the parent name, the chain, public addresses, and public provider identifiers

#### Scenario: A missing secret fails before the external call

- **WHEN** a route requiring a provider secret is invoked without it
- **THEN** the failure MUST name the absent variable and MUST occur before any external request is made

#### Scenario: The operator credential never leaves the request

- **WHEN** an approve request carrying an operator credential is handled, whether it succeeds or fails
- **THEN** neither the credential nor its verifier MUST appear in a response body, a recorded event, or the server log

## ADDED Requirements

### Requirement: Approval requires an operator credential

The approve route SHALL execute only for a caller that presents a valid operator credential. The API SHALL hold a verifier for the credential and never the credential itself.

#### Scenario: A request without the credential is refused first

- **WHEN** an approve request carries no operator credential, or a wrong one
- **THEN** the response MUST be 401 with the shared JSON error shape, and it MUST be returned before any event is recorded and before any provider call is made

#### Scenario: The comparison does not leak the credential

- **WHEN** a presented credential is checked
- **THEN** it MUST be compared against the verifier in constant time

#### Scenario: The approval carries no payment of its own

- **WHEN** an approve request is received
- **THEN** the route MUST NOT accept an amount, a recipient, or a token from the request, and MUST re-submit the request recorded when the denial happened

#### Scenario: Nothing on the agent's path holds the credential

- **WHEN** the configuration that the agent's payment path reads is inspected
- **THEN** it MUST NOT contain the operator credential

### Requirement: Phase 2 approval is prepared by the server and signed in the browser

Once the owner's key is held in the browser, the API SHALL prepare the approval and relay the browser's signature, and SHALL hold no owner key.

#### Scenario: Prepare builds the payload from the stored denial

- **WHEN** an approval is prepared
- **THEN** the API MUST return the canonical authorization payload built from the request recorded at the time of the denial, and no field of that payload MUST come from the client

#### Scenario: Submit relays what was prepared

- **WHEN** a signed approval is submitted
- **THEN** the API MUST relay the prepared body unchanged with the browser's signature, and MUST NOT accept a replacement body from the client

#### Scenario: The deployed API cannot approve alone

- **WHEN** the deployed API's environment is inspected in phase 2
- **THEN** it MUST contain no owner key, so no approval can execute without a signature made in the browser
