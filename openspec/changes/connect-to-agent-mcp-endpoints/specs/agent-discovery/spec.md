## ADDED Requirements

### Requirement: Advertised MCP tools are carried as a claim

Discovery SHALL read `mcpTools` from Agent0 registration data and carry it through normalisation as the agent's claimed tool list. Normalisation SHALL preserve the difference between a registration that advertises no tools and one that advertises an empty list. The claimed list SHALL NOT affect ranking.

#### Scenario: No advertised tools is absence

- **WHEN** a registration carries no `mcpTools`
- **THEN** the normalised candidate MUST omit the claimed tool list rather than carry an empty one

#### Scenario: An empty advertised list is kept as empty

- **WHEN** a registration carries `mcpTools` as an empty list
- **THEN** the normalised candidate MUST carry an empty claimed tool list, distinct from an omitted one

#### Scenario: Claims do not rank

- **WHEN** two candidate sets differ only in their claimed tool lists
- **THEN** discovery MUST produce the same ranking for both
