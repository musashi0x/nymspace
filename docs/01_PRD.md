# Product Requirements Document

## Product

Nymspace

## Problem

Autonomous agents increasingly need persistent identities, machine discoverable endpoints, reputation, and wallets. Today those pieces are usually disconnected.

A human or organization may know that an agent has:

* an ENS name
* an ERC 8004 registration
* an MCP endpoint
* a wallet
* some reputation

But there is often no explicit authority model connecting them.

The core problem is not only naming an agent. It is proving who controls its identity and limiting which parts of that identity the agent itself is allowed to change.

## Product thesis

ENSv2 can act as the organizational identity and authority layer for agent fleets.

A parent namespace represents the organization.

Agent subnames represent agents.

ENSv2 Enhanced Access Control determines which identity records each agent controller may edit.

ENSIP 26 makes endpoints and agent context discoverable.

ENSIP 25 connects the ENS identity to an ERC 8004 registration.

The Graph makes ERC 8004 identity, capability, feedback, and validation state queryable in real time.

Privy applies programmable financial controls to the agent wallet.

## Target user

### Primary

A developer or team building multiple autonomous agents.

Needs:

* Stable human readable identities
* Explicit delegation
* Machine discovery
* Trust inspection
* Financial guardrails

### Secondary

Another agent or app trying to select a service agent.

Needs:

* Resolve an agent identity
* Find its protocol endpoints
* Inspect live trust signals
* Know whether an identity is verified
* Know what financial workflow is available

## Jobs to be done

### Organization owner

“When I create an agent, I want to give it enough authority to operate without giving it authority to rewrite its entire identity.”

### Agent operator

“When my agent endpoint changes, I want the agent to publish the new endpoint by itself without asking the root organization owner.”

### Agent consumer

“When I discover an agent, I want to inspect live identity and trust information before interacting with it.”

### Financial controller

“When an agent spends funds, I want the wallet infrastructure to enforce a real policy rather than trusting application UI.”

## Core scenarios

### Scenario A: Delegated identity update

Owner creates `research.<parent>.eth`.

Owner assigns a separate controller address.

Owner grants that address resolver permission for:

* `agent-context`
* `agent-endpoint[mcp]`
* `agent-endpoint[a2a]`

The controller updates `agent-endpoint[mcp]`.

The transaction succeeds.

The controller attempts to edit an ENSIP 25 verification record or registry configuration.

The transaction reverts.

### Scenario B: Discover and verify

User asks:

> Find a trustworthy research agent with MCP support.

Backend queries live Agent0 data from The Graph.

An AI ranking step evaluates candidates using real fields such as endpoint availability, feedback, validation, ENS claim, capability data, and supported trust model.

Validation is the exception on testnet: no ValidationRegistry is deployed on
Ethereum Sepolia or Base Sepolia, so that field will be empty for every agent
in the demo. Rank without it, or show it as unavailable — never as a zero
score. See `docs/07_THE_GRAPH_INTEGRATION.md`.

UI displays the selected candidate and provenance.

For the demo agent, the application additionally verifies the ENSIP 25 association.

### Scenario C: Policy gated payment

User requests a small payment to the selected agent.

The agent wallet or organization wallet uses Privy.

A limited signer or policy allows the normal amount.

A second request exceeds the configured constraint.

Privy rejects it or the application switches to an explicit approval flow.

## MVP requirements

### ENS

Must:

* Run on ENSv2 Sepolia
* Use the actual ENSv2 hierarchical registry model
* Use Permissioned Resolver
* Use Enhanced Access Control
* Read permissions from contracts
* Delegate at least one record level permission
* Demonstrate at least one successful delegated update
* Demonstrate at least one unauthorized operation that fails

### Identity standards

Must:

* Publish `agent-context`
* Publish at least `agent-endpoint[mcp]`
* Support optional A2A and web endpoint records
* Bind a demo agent to ERC 8004 using ENSIP 25
* Verify the binding at runtime

### The Graph

Must:

* Query a live Graph provider
* Use the Agent0 ERC 8004 Subgraph on Ethereum Sepolia
* Use Graph data as a load bearing input to discovery
* Perform reasoning, ranking, or automation with returned data
* Never use static scores in the judge path

### Privy

Must:

* Create or use at least one Privy wallet
* Demonstrate a business or organization use case
* Implement one functional B2B financial action
* Apply at least one Privy control such as a policy, signer, quorum, or intent
* Show one action inside the control boundary
* Show one action outside the boundary

### MCP

* Every fleet agent's `agent-endpoint[mcp]` names a real MCP server: `/mcp/<label>` on the API, stateless and read-only, reporting its own ENS name as its server identity.
* A Connect action on the inspector and on discovery results performs a read-only handshake (`initialize`, then `tools/list`) through an outbound guard, and never calls a tool.
* A failed connect is a typed finding about the endpoint, not an empty tool list, and every attempt is recorded in the activity log.

## Nice to have

* Query the same Agent0 schema on Ethereum Sepolia and Base Sepolia to demonstrate cross network schema reuse for The Graph standardized data track.
* Activity timeline with transaction hashes.
* Permission simulator before signing.
* Revocation flow for an agent controller.
* A lightweight Agent Manifest viewer.

## Out of scope

* Production organization billing
* Fiat rails
* Full treasury dashboard
* Custom reputation algorithm deployed onchain
* ERC 8004 marketplace
* General purpose wallet
* Full agent task execution environment
* Token swaps
* Bridging
* Complex approval organizations

## Success metrics for the hackathon

### Technical

* 100 percent of displayed ENS permission state is contract derived.
* Zero hardcoded trust scores in judge path.
* All core flows have transaction or query evidence.
* Core demo works after a fresh application restart.
* A denied action is visibly caused by contract or Privy policy enforcement.

### Demo

A judge should understand the project in under 45 seconds:

1. Parent ENS namespace is the organization.
2. Agent subname is the identity.
3. ENSv2 decides what the agent can edit.
4. The Graph supplies live trust and capability data.
5. Privy decides what the agent can spend.

## Acceptance criteria

The MVP is complete only when all of the following are true:

* `research.<parent>.eth` resolves on ENSv2 Sepolia.
* A separate agent controller can update `agent-endpoint[mcp]`.
* The same controller cannot edit a protected verification key or change the resolver.
* Permission badges in UI match live EAC reads.
* An ERC 8004 registration claims the ENS name.
* ENSIP 25 runtime verification returns verified.
* Agent0 live query returns the demo registration.
* AI discovery consumes live Graph data.
* A Privy controlled payment succeeds inside policy.
* A second payment is denied or requires an explicit stronger authorization path.
