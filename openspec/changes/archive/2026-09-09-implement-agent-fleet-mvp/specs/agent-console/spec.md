## ADDED Requirements

### Requirement: The console presents a fleet and an inspector

The web application SHALL provide a fleet view listing the organization's agents and an inspector for a single agent. Both SHALL identify the parent namespace and the chain.

#### Scenario: The fleet identifies the organization

- **WHEN** the fleet view loads
- **THEN** it MUST show the parent ENS name, the agent count, and the chain the state was read from

#### Scenario: Each agent shows its four integration states

- **WHEN** an agent is listed
- **THEN** its card MUST show identity state, registry state, endpoint state, trust state, and financial state as separate values rather than one aggregate status

#### Scenario: The inspector answers the five questions

- **WHEN** an agent inspector loads
- **THEN** it MUST present who the agent is, what it may edit, whether its identity verifies, how to reach it, and what financial authority it has

#### Scenario: Chain-derived fields are labelled live

- **WHEN** a field read from chain is displayed
- **THEN** it MUST be labelled with its chain and the time it was read

### Requirement: The permission matrix is computed from chain

Every cell of the authority matrix SHALL be derived from contract reads. No cell SHALL be a UI constant, a stored value, or an inference from another cell.

#### Scenario: Cells come from role reads

- **WHEN** the matrix renders
- **THEN** each cell MUST be the result of a role query against the resolver or the registry for that account and that resource

#### Scenario: The full fallback chain is evaluated

- **WHEN** the matrix answers whether an account may set a text key
- **THEN** it MUST evaluate every alternative the resolver accepts — the record resource, the wildcard record resource, and the name resource — so that a name-level grant is not displayed as an absence

#### Scenario: Effective authority is read with the contract's own predicate

- **WHEN** authority is evaluated
- **THEN** it MUST use the predicate that ORs root-granted roles with resource-specific roles, so that an account holding roles at the root resource is not displayed as unauthorised

#### Scenario: A negative cell follows a positive control

- **WHEN** any cell renders as denied
- **THEN** the same code path MUST have produced an allowed result for a known grant in that request, so that a wrong resource derivation is not displayed as a denial

#### Scenario: An onchain permission change is reflected on refresh

- **WHEN** a grant is added or revoked on chain and the matrix is refreshed
- **THEN** the matrix MUST change accordingly, with no application-side cache invalidation step

### Requirement: The permission proof is a first-class interaction

The console SHALL provide an interaction that performs a permitted write and an unauthorised write, and SHALL display the real outcome of each.

#### Scenario: The permitted write succeeds visibly

- **WHEN** the permitted step runs
- **THEN** it MUST show the previous value, the new value, the transaction hash, the acting account, and the permission that allowed it

#### Scenario: The denied write shows a contract denial

- **WHEN** the unauthorised step runs
- **THEN** it MUST show that the transaction reverted, attributed to the resolver's access control

#### Scenario: The denial is not simulated

- **WHEN** a denial is displayed
- **THEN** it MUST correspond to an actual reverted transaction, and MUST NOT be produced by an application-side branch that skipped the call

### Requirement: Denial is a product state, not an error

The interface SHALL distinguish pending, denied, failed, and unverified, and SHALL render authority and policy denials as successful enforcement.

#### Scenario: An EAC denial reads as policy

- **WHEN** an intentionally unauthorised transaction reverts
- **THEN** the interface MUST attribute it to identity policy, and MUST NOT render a generic failure message

#### Scenario: A policy denial reads as policy

- **WHEN** a payment is denied by the financial control
- **THEN** the interface MUST attribute it to financial policy, and MUST state that no funds moved

#### Scenario: Infrastructure failures stay distinguishable

- **WHEN** an RPC or provider call fails
- **THEN** the interface MUST report that specific failure, and MUST NOT present it as a denial

#### Scenario: Partial identity is not failure

- **WHEN** an agent's name exists but a linked component is missing
- **THEN** the state MUST be partial, naming the missing component, rather than failed

### Requirement: The console never fabricates state

The interface SHALL NOT display placeholder values, seeded scores, or optimistic success.

#### Scenario: Loading states name what is loading

- **WHEN** an external read is in flight
- **THEN** the interface MUST name the system being read rather than show a generic spinner over fabricated content

#### Scenario: Completion follows confirmation, not submission

- **WHEN** provisioning is reported complete
- **THEN** chain reads MUST have confirmed the name, the resolver, the intended grants, and the absence of protected authority

#### Scenario: Empty states explain rather than fake

- **WHEN** there are no agents, no discovery matches, or no configured wallet
- **THEN** the interface MUST explain the absence, and MUST NOT show a disabled placeholder implying data exists

### Requirement: The activity timeline records what happened, including failures

The console SHALL present a chronological record of identity, discovery, and financial actions with their provenance.

#### Scenario: Events carry their source and evidence

- **WHEN** an event is displayed
- **THEN** it MUST identify its source system and carry that system's evidence — a transaction hash, a query timestamp, or a provider request id

#### Scenario: Denied and failed events persist

- **WHEN** an action is denied or fails
- **THEN** its event MUST remain in the timeline rather than being removed or overwritten

#### Scenario: Ordering follows occurrence

- **WHEN** events are ordered
- **THEN** they MUST be sorted by when they occurred, and a pending event MUST update in place when it resolves

### Requirement: The console works from a fresh session

The interface SHALL function without hidden client-side state.

#### Scenario: A new browser session works

- **WHEN** the console is opened in a browser with no prior storage
- **THEN** agent inspection and discovery MUST work, because the state they need is read from their authoritative systems

#### Scenario: A server restart does not break the demo

- **WHEN** the server is restarted and an agent inspector is opened
- **THEN** identity, trust, and wallet state MUST reload from chain, the subgraph, and the provider
