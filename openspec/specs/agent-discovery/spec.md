# agent-discovery Specification

## Purpose

How agents are found and ranked from live Agent0 subgraph data — the query surface, normalisation of absent fields, a ranking step grounded only in values the query returned, provenance on every result, and the indexing-delay states that follow a fresh registration.
## Requirements
### Requirement: Discovery reads live Agent0 data

Agent discovery SHALL query the Agent0 ERC 8004 Subgraph through The Graph gateway at request time. The system SHALL NOT serve discovery results from fixtures, seeds, or a local index.

#### Scenario: The query is live

- **WHEN** a discovery request is served
- **THEN** it MUST have executed a GraphQL request against the configured Agent0 subgraph, and the response MUST be the source of every candidate returned

#### Scenario: The query surface is settled against the deployed schema

- **WHEN** a query document is written
- **THEN** its field selection MUST match the live subgraph's schema, confirmed by introspection rather than transcribed from the product docs

#### Scenario: The API key stays server-side

- **WHEN** a discovery request is served
- **THEN** the Graph API key MUST NOT appear in any client bundle or response body, and the gateway MUST be reached from the server

#### Scenario: A provider failure is reported as a provider failure

- **WHEN** the Graph gateway is unreachable or returns errors
- **THEN** the system MUST report a provider error, and MUST NOT substitute cached, seeded, or synthesised candidates

### Requirement: Absent fields stay absent through normalisation

Normalisation SHALL preserve the difference between a field that is absent and a field whose value is zero or empty.

#### Scenario: A missing endpoint is missing

- **WHEN** a registration carries no MCP endpoint
- **THEN** the normalised candidate MUST omit the endpoint rather than carry an empty string

#### Scenario: Revoked feedback is excluded

- **WHEN** feedback is counted
- **THEN** revoked feedback MUST be excluded from the count, and the count MUST state that exclusion

#### Scenario: Validation is unavailable, not zero

- **WHEN** validation state is normalised on a network with no deployed ValidationRegistry
- **THEN** it MUST be represented as unavailable, and MUST NOT be represented as a completed count of zero

#### Scenario: An unclaimed ENS name is absent

- **WHEN** a registration claims no ENS name
- **THEN** the candidate MUST carry no name rather than a placeholder

### Requirement: Ranking is grounded in returned fields

An AI step SHALL interpret the request, filter and rank the live candidates, and explain its selection. Every claim in the explanation SHALL be traceable to a field in the query response.

#### Scenario: Intent becomes selection criteria

- **WHEN** a natural-language request is submitted
- **THEN** the system MUST derive selection criteria from it and pass them to the Agent0 search tool, rather than returning an unfiltered list

#### Scenario: The explanation cites only available fields

- **WHEN** an explanation is produced
- **THEN** every field it cites MUST be present in the candidate object it describes, and an explanation citing an absent field MUST fail the discovery test

#### Scenario: Missing dimensions are omitted from scoring

- **WHEN** a ranking dimension has no data for any candidate
- **THEN** the dimension MUST be omitted from the score or shown as unavailable, and MUST NOT be weighted as zero

#### Scenario: A composite score is labelled and explained

- **WHEN** an application-level match score is displayed
- **THEN** it MUST be labelled as the application's own score and MUST show the inputs it was computed from, rather than presenting as an objective reputation number

#### Scenario: Agent metadata is treated as untrusted input

- **WHEN** registration descriptions or endpoint metadata are passed to a model
- **THEN** they MUST enter as data and MUST NOT be inserted into system instructions or used to expand the model's tool authority

### Requirement: Selection is exercised against a plural candidate set

Filtering and ranking SHALL be demonstrated against a response containing more than one candidate, including at least one the criteria exclude.

#### Scenario: Ranking has something to choose between

- **WHEN** ranking is verified
- **THEN** the underlying response MUST have carried multiple candidates, because a single-candidate response returns the same result whether or not ranking executed

#### Scenario: The filter is shown to remove something

- **WHEN** filtering is verified
- **THEN** a candidate failing the criteria MUST be present in the raw response and absent from the filtered set

#### Scenario: The explanation checker is itself tested

- **WHEN** the explanation validator is verified
- **THEN** it MUST reject a deliberately corrupted explanation citing an absent field, because a checker that has never rejected anything has not been shown to check

#### Scenario: A live path is distinguished from a replayed one

- **WHEN** liveness is verified
- **THEN** removing the provider credential MUST produce a provider error and no candidates, since a fixture and a live response are otherwise indistinguishable by shape

### Requirement: Results carry provenance

Every discovery result SHALL state where it came from and when.

#### Scenario: Source and time accompany results

- **WHEN** results are returned
- **THEN** the response MUST include the provider, the chain queried, the subgraph identifier, and the time the query ran

#### Scenario: The evidence behind a ranking is inspectable

- **WHEN** a candidate is selected
- **THEN** the exact fields used to rank it MUST be available for inspection — chain, agent id, endpoints, trust model, feedback count, validation state, and ENS claim

#### Scenario: A cached browse is distinguishable from a live read

- **WHEN** a cached result is displayed
- **THEN** it MUST carry its read time, and an explicit refresh MUST be available that bypasses the cache

### Requirement: Indexing delay is a state, not an error

A registration that exists on chain but is not yet indexed SHALL be reported as pending rather than as absent or failed.

#### Scenario: Pending is distinguishable from empty

- **WHEN** a known registration transaction has confirmed but the subgraph does not yet return the agent
- **THEN** the state MUST be indexing-pending, and MUST be distinguishable from a query that legitimately matched nothing

#### Scenario: Pending state offers evidence and a retry

- **WHEN** indexing is pending
- **THEN** the registry transaction hash MUST be shown as evidence, along with the last-checked time and a way to retry

#### Scenario: Pending never becomes fabricated data

- **WHEN** indexing is pending
- **THEN** the system MUST NOT display placeholder trust signals or a synthesised candidate in place of the unindexed agent

### Requirement: Discovery requests are logged with their evidence

Each discovery request SHALL record what was asked, what was queried, and what was returned.

#### Scenario: A request leaves an auditable trace

- **WHEN** a discovery request completes
- **THEN** the log MUST contain the user query, the endpoint and chain used, the query time, the result count, the selected candidate ids, the explanation, and any ENS verification result

### Requirement: Advertised MCP tools are carried as a claim

Discovery SHALL read `mcpTools` from Agent0 registration data and carry it through normalisation as the agent's claimed tool list. The subgraph types `mcpTools` as `[String!]!` on both networks, so a registration that lists no tools and one that omits the field both arrive as an empty list; normalisation SHALL therefore treat an empty list as no claim. The claimed list SHALL NOT affect ranking.

#### Scenario: No advertised tools is absence

- **WHEN** a registration carries no `mcpTools`, or carries it as an empty list
- **THEN** the normalised candidate MUST omit the claimed tool list rather than carry an empty one

#### Scenario: Advertised tools are carried as given

- **WHEN** a registration carries a non-empty `mcpTools`
- **THEN** the normalised candidate MUST carry that list as its claimed tools

#### Scenario: Claims do not rank

- **WHEN** two candidate sets differ only in their claimed tool lists
- **THEN** discovery MUST produce the same ranking for both

