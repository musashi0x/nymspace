## ADDED Requirements

### Requirement: MCP reachability is checked on demand

The console SHALL offer a Connect action wherever it shows an MCP endpoint, on discovery results and on the inspector's MCP record. It SHALL render the returned outcome without upgrading or softening it.

#### Scenario: Connect is offered only where an endpoint exists

- **WHEN** a discovery result or inspected agent has an MCP endpoint
- **THEN** a Connect action MUST be shown, and when it has none the console MUST show the absence and no Connect action

#### Scenario: A connected endpoint shows its tools

- **WHEN** connect returns `connected`
- **THEN** the console MUST show the protocol version, the server's reported name, each tool's name and description as plain text, and the read time

#### Scenario: Self-reported identity is not shown as verification

- **WHEN** the identity comparison is `matches`
- **THEN** the console MUST label it as self-reported and MUST NOT use the treatment reserved for ENSIP 25 or onchain verification

#### Scenario: Failures are findings about the endpoint

- **WHEN** connect returns `unreachable`, `timeout`, `not_mcp`, or `blocked`
- **THEN** the console MUST show the outcome and its stage or rule as a statement about that agent's endpoint, distinguishable from a failure of Nymspace's own API

#### Scenario: Advertised is not reachable

- **WHEN** a discovery result has an MCP endpoint that has not been connected to
- **THEN** its badge MUST say the endpoint is advertised, and MUST NOT say it is available or connected

### Requirement: Claimed tools are shown against served tools

When a connect response carries a comparison between the agent's claimed tools and its served tools, the console SHALL render that comparison as the API returned it, and SHALL NOT compute a comparison of its own.

#### Scenario: Differences are shown in both directions

- **WHEN** a `connected` outcome carries tools claimed but not served, or served but not claimed
- **THEN** the console MUST show both groups, each labelled by direction, alongside the served tool list

#### Scenario: No claim, no comparison

- **WHEN** a `connected` outcome carries no comparison
- **THEN** the console MUST show the served tools alone and MUST NOT present them as matching or contradicting any claim

### Requirement: The chat proposes a connect and does not perform one

The chat SHALL answer a question about an agent's MCP server with a plan naming `POST /v1/mcp/connect`, and SHALL send no outbound request to the endpoint until the operator runs the plan.

#### Scenario: An MCP question is answered with a plan

- **WHEN** the operator asks what a fleet agent's MCP server serves
- **THEN** the chat MUST answer with a one-step plan targeting that agent, and no connect MUST have been performed

#### Scenario: The step is shown as unsigned

- **WHEN** the plan is rendered
- **THEN** the step MUST state that no key signs it, rather than naming the organization, the controller, or the agent wallet

#### Scenario: A failed connect is not reported as done

- **WHEN** a run of the plan returns `unreachable`, `timeout`, `not_mcp`, `blocked`, or `no_endpoint`
- **THEN** the run's outcome MUST show that status and MUST NOT show the step as done

#### Scenario: The endpoint write still wins its own question

- **WHEN** the operator asks to set an agent's MCP endpoint
- **THEN** the chat MUST answer with the record-write plan, not the connect plan
