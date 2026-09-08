# Five Day Execution Plan

Prepared for the final build window beginning 2026 09 08.

The submission deadline should always be confirmed in the ETHGlobal dashboard.

## Rule

Build vertical evidence first.

Polish only after the three partner integrations have a working proof.

## Day 1: ENSv2 or nothing

### Goal

Prove the identity permission model.

### Tasks

* Configure Sepolia ENSv2 deployment addresses.
* Confirm parent namespace strategy.
* Create one agent subname.
* Attach Permissioned Resolver.
* Grant controller permission to `agent-endpoint[mcp]`.
* Update MCP endpoint from controller.
* Attempt protected write.
* Attempt registry control write.
* Read EAC permissions back.
* Commit working spike.

### Deliverable

CLI output or minimal page showing:

```text
MCP write        success
Protected write  denied
Resolver change  denied
```

### Gate

If not working by end of Day 1:

Do not build Graph or Privy UI yet.

Fix ENSv2.

## Day 2: Identity standards plus Graph

### Goal

Make agent discoverable and verifiable.

### Tasks

* Add `agent-context`.
* Add MCP endpoint record.
* Register or configure ERC 8004 demo agent.
* Create ENSIP 25 binding.
* Runtime ENSIP 25 verification.
* Configure The Graph API key.
* Query Agent0 Ethereum Sepolia.
* Confirm demo agent is indexed.
* Implement `search_agent0`.
* Implement minimal AI discovery ranking.

### Deliverable

Prompt:

`Find a research agent with MCP`

Returns live demo agent with evidence.

## Day 3: Privy gate

### Goal

One financial control.

### Tasks

* Create or load Privy wallet.
* Choose wallet ownership model.
* Configure one control.
* Fund with minimal test assets.
* Execute allowed action.
* Execute denied action.
* Normalize policy errors.
* Store safe wallet mapping.

### Gate

By the middle or end of Day 3:

If a real Privy controlled transaction is not working reliably, decide fallback immediately.

Do not spend Day 4 rebuilding Privy architecture.

## Day 4: Product UI plus evidence

### Goal

Turn the working vertical slice into judge friendly UX.

### Screens

* Fleet
* Agent inspector
* Permission proof
* Discover
* Payment

### Tasks

* Permission matrix from live EAC.
* ENSIP 25 badge.
* Graph evidence drawer.
* Financial policy panel.
* Activity timeline.
* Transaction links.
* Error states.
* Graph indexing pending state.

### Stretch

Query Agent0 on Ethereum Sepolia and Base Sepolia with the same query model.

Only do this after core path is stable.

## Day 5: Hardening and submission

### Goal

Repeatable two to four minute demo.

### Tasks

* Restart test.
* Fresh browser test.
* Negative permission tests.
* Graph live source test.
* Financial denial test.
* README.
* Architecture diagram.
* Sponsor mapping.
* Demo video.
* Open source audit.
* Remove secrets.
* Confirm selected ETHGlobal build category.
* Confirm all partner prize requirements.

## Scope cuts in order

If behind schedule, cut:

1. Deploy agent.
2. Trader agent interactions.
3. Activity timeline polish.
4. A2A live connection.
5. Cross chain Graph stretch.
6. Approval escalation.
7. Fancy AI UI.

Never cut:

* ENS EAC proof
* live Graph query
* live financial policy enforcement if keeping Privy
* runtime evidence

## Pre demo freeze

Freeze contracts and core integration several hours before recording.

Only fix:

* broken demo
* security issue
* submission requirement

Do not refactor architecture before recording.
