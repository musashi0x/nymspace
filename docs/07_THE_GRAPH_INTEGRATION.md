# The Graph Integration

## Objective

Make The Graph a load bearing live data source.

The Graph is not only a card that displays an agent score.

It powers:

* agent discovery
* capability filtering
* trust inspection
* AI ranking and explanation

## Data source

Use the Agent0 ERC 8004 Subgraph.

Ethereum Sepolia is supported.

The Agent0 schema includes:

* Agent identity
* Owner
* Registration file
* ENS
* Agent wallet
* MCP endpoint
* MCP tools
* A2A endpoint
* A2A skills
* Supported trust models
* Feedback
* Validation
* Aggregate stats
* x402 support

## Configuration

Environment:

```text
GRAPH_API_KEY=
GRAPH_AGENT0_SEPOLIA_SUBGRAPH_ID=
GRAPH_AGENT0_BASE_SEPOLIA_SUBGRAPH_ID=
```

Never expose the Graph API key in client side code if the selected access method requires secrecy.

Proxy queries through server routes.

## Core query 1: MCP compatible agents

Use the current Agent0 schema.

Conceptual query:

```graphql
query GetMCPAgents {
  agentRegistrationFiles(
    where: {
      mcpEndpoint_not: null
      active: true
    }
    first: 100
  ) {
    agentId
    name
    description
    mcpEndpoint
    mcpVersion
    mcpTools
    supportedTrusts
  }
}
```

## Core query 2: Full profile

Use an agent ID formatted for the Agent0 schema, such as:

```text
11155111:<agentId>
```

Fetch:

* chain ID
* agent ID
* owner
* registration file
* feedback
* validations
* stats if required

## Discovery AI

### Input

Natural language:

> Find a trustworthy research agent with MCP support.

### Tool

Expose a server side tool:

```ts
search_agent0({
  capability?: string,
  requiresMcp?: boolean,
  trustModel?: string,
  chainId?: number
})
```

### Reasoning pipeline

1. Parse user intent.
2. Query Agent0 live.
3. Remove incompatible agents.
4. Rank remaining candidates.
5. Explain ranking using exact live fields.
6. For candidates with ENS, run ENSIP 25 verification when relevant.
7. Return evidence with source timestamp.

## Recommended ranking model

Keep it explainable.

Example normalized inputs:

```text
endpoint_match
capability_match
feedback_signal
validation_signal
ens_binding_signal
```

Do not invent a universal “reputation 92” unless the score can be derived from actual Graph fields.

A safer UI is:

```text
Trust Signals

Feedback        18 non revoked
Validation      2 completed
ENS binding     Verified
MCP             Available
```

If you create an app level match score, label it:

`Nymspace match score`

and show how it is calculated.

## Qualification strength

For The Graph AI track:

Do not stop at:

```text
fetch GraphQL
render JSON
```

The application needs to perform meaningful work with the data.

Minimum acceptable behavior:

* AI interprets request.
* AI selects candidates using live Graph response.
* AI explains selection.
* Selected agent can feed into a downstream action.

## Standardized or composable Graph track

Treat this as a stretch goal, not guaranteed eligibility.

The ETHOnline standardized products track requires meaningful use of a standardized schema or composition.

Agent0 uses the same schema across deployed networks.

A strong low cost stretch implementation is:

1. Query Ethereum Sepolia Agent0.
2. Query Base Sepolia Agent0.
3. Use the same query shape.
4. Merge and normalize results.
5. Let discovery rank across both.
6. Show what shared schema reuse removed from the implementation.

Example UI:

```text
Search scope
Ethereum Sepolia
Base Sepolia

One query model
Two Agent0 deployments
```

This makes the standardization leverage visible.

Do not claim the track solely because one Agent0 Subgraph is queried.

## Indexing delay behavior

After ERC 8004 registration:

```text
registered_onchain
    |
    v
waiting_for_graph
    |
    v
indexed
```

UI should support:

* Retry
* Last checked
* Direct transaction evidence
* No fake fallback data

## Cache

Use a short cache for normal browsing.

For judge proof:

Add a `Refresh live` button that bypasses cache.

## Logging

For every discovery request store:

* User query
* Chain endpoint used
* Graph request time
* Number of results
* Selected candidate IDs
* Explanation
* ENS verification result
