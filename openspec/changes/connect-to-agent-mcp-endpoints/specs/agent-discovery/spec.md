## ADDED Requirements

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
