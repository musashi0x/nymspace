## ADDED Requirements

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

#### Scenario: Approval status is returned only when implemented

- **WHEN** a pending-approval status would be returned
- **THEN** it MUST correspond to an implemented provider flow

### Requirement: Externally-derived responses carry a read time

Any response field read from a chain, a subgraph, or a provider SHALL be accompanied by the time it was read.

#### Scenario: Chain and Graph payloads are timestamped

- **WHEN** a response contains ENS state, verification results, or Graph results
- **THEN** it MUST include the time that state was read

#### Scenario: A response without a read time is incomplete

- **WHEN** an externally-derived payload omits its read time
- **THEN** the response MUST be treated as incomplete, because a permission or verification result without a read time cannot be evaluated for staleness

### Requirement: Responses never carry secret material

The API SHALL NOT return provider secrets, authorization keys, or server signing material in any response.

#### Scenario: Financial metadata is filtered

- **WHEN** wallet or policy state is returned
- **THEN** it MUST contain only the address, the provider, the agent association, and a policy summary, and MUST NOT contain credentials or configuration that reveals them

#### Scenario: Configuration endpoints expose only public values

- **WHEN** demo configuration is served
- **THEN** it MUST contain only values safe for the browser — the parent name, the chain, public addresses, and public provider identifiers

#### Scenario: A missing secret fails before the external call

- **WHEN** a route requiring a provider secret is invoked without it
- **THEN** the failure MUST name the absent variable and MUST occur before any external request is made

### Requirement: Denials are responses, not errors

An authority or policy denial SHALL be returned as a successful response describing the denial.

#### Scenario: An EAC revert is a described outcome

- **WHEN** a write is rejected by the resolver's access control
- **THEN** the API MUST return a denied outcome naming the source, rather than a generic server error

#### Scenario: A provider denial is a described outcome

- **WHEN** a payment is rejected by policy
- **THEN** the API MUST return a denied status with its reason, and MUST NOT surface it as an internal error
