# Nymspace

Programmable identity and permission infrastructure for autonomous agent organizations.

## One sentence

Nymspace lets an organization create AI agents under an ENSv2 namespace, delegate exactly which identity records each agent can control, verify their ERC 8004 identity and live trust data through The Graph, and gate financial actions with Privy policies.

## Core product thesis

The product is not “ENS names for agents.”

The product is:

> ENSv2 is the programmable authority layer for an agent’s public identity and namespace.

An agent can control the records it needs to operate, while the organization retains higher authority over verification, registry configuration, transfers, and financial policy.

## Partner responsibilities

| Layer | Partner | Question answered |
| --- | --- | --- |
| Identity and authority | ENSv2 | Who is this agent and what identity state may it control? |
| Discovery and trust | The Graph Agent0 | What can this agent do and what live reputation or validation state exists? |
| Financial authority | Privy | What may this agent do with money? |

## MVP vertical slice

Use exactly three demo agents:

* `research.<parent>.eth`
* `trader.<parent>.eth`
* `deploy.<parent>.eth`

The required working flow is:

1. Create one agent subname on ENSv2 Sepolia.
2. Give a separate agent controller key permission to update only selected ENSIP 26 text records.
3. Read those permissions from ENSv2 EAC and show them in the UI.
4. Let the agent update `agent-endpoint[mcp]`.
5. Attempt an unauthorized identity action and show the real onchain revert.
6. Bind the ENS name to an ERC 8004 registration using ENSIP 25.
7. Query the live Agent0 ERC 8004 Subgraph on Ethereum Sepolia.
8. Let an AI discovery flow reason over the live Graph result instead of merely printing it.
9. Create or use a Privy wallet for the selected agent.
10. Execute one small allowed payment.
11. Attempt one payment outside the policy and show it being blocked or routed to an approval path.

## Non goals for the hackathon

Do not build:

* A full marketplace
* A full organization management suite
* A custom reputation protocol
* A custom indexer
* Complex swaps
* Multichain financial execution
* More than three demo agents
* Large autonomous orchestration systems
* A decorative ENS profile page with hardcoded permissions

## Most important implementation rule

Before polishing UI, prove this four step ENSv2 spike:

1. Create an agent subname on Sepolia ENSv2.
2. Give a separate controller permission to edit a specific text key.
3. Successfully update that key from the controller.
4. Fail a different unauthorized action from the same controller.

If this does not work, stop and fix ENSv2 before building the rest.

## Docs index

| Doc | Purpose |
| --- | --- |
| `01_PRD.md` | Product requirements and scope |
| `02_PRODUCT_FLOW.md` | End to end user and system flows |
| `03_UX_SPEC.md` | Screens, components, states, interactions |
| `04_SYSTEM_ARCHITECTURE.md` | Services, boundaries, data flow |
| `05_ENSV2_IMPLEMENTATION.md` | ENSv2 registry, resolver, EAC implementation |
| `06_AGENT_IDENTITY_STANDARDS.md` | ENSIP 25, ENSIP 26, ERC 8004 model |
| `07_THE_GRAPH_INTEGRATION.md` | Agent0 queries, discovery and AI reasoning |
| `08_PRIVY_INTEGRATION.md` | Minimum B2B financial workflow |
| `09_DATA_AND_EVENT_MODEL.md` | Persistent app entities and activity events |
| `10_API_CONTRACT.md` | Backend API contract |
| `11_FRONTEND_STATE_MACHINE.md` | UI state and error model |
| `12_SECURITY_MODEL.md` | Authority separation and threat model |
| `13_TEST_PLAN.md` | Unit, integration, E2E, restart and negative tests |
| `14_EXECUTION_PLAN.md` | Five day cut list and go/no go gates |
| `15_DEMO_SCRIPT.md` | Two to four minute judge demo |
| `16_SPONSOR_QUALIFICATION.md` | ENS, Graph, Privy requirements mapping |
| `17_RISKS_AND_FALLBACKS.md` | Scope traps and fallback decisions |
| `18_IMPLEMENTATION_CHECKLIST.md` | Build checklist |
| `19_ENV_AND_CONFIG.md` | Environment variables and runtime config |
| `20_SOURCES.md` | Current technical references checked on 2026 09 08 |

## Product name

Working name: **Nymspace**

Suggested positioning:

> One namespace. Many agents. Explicit authority.

Alternate long term positioning:

> The programmable identity control plane for autonomous agents.
