# Demo Script

## Target length

Two to four minutes.

Aim for about three minutes.

## Opening

### 0:00 to 0:20

Show Fleet.

Say:

> AI agents have wallets and endpoints, but identity authority is usually all or nothing. Nymspace uses ENSv2 as the programmable control plane for an agent organization.

Show:

```text
<parent>.eth
research.<parent>.eth
trader.<parent>.eth
deploy.<parent>.eth
```

## Scene 1: ENSv2 authority

### 0:20 to 1:10

Open research agent.

Show permission matrix.

Explain:

> The organization owns the namespace, but this controller is allowed to edit only the operational records it needs.

Show live permission read.

Action:

Update `agent-endpoint[mcp]`.

Wait for success.

Read value back.

Then click:

`Run protected write`

Try to modify the ENSIP 25 binding or another unauthorized record.

Show revert.

Say:

> The same key can update its MCP endpoint but cannot rewrite the higher authority identity binding.

This is the ENS hero moment.

### Say the registry is unemancipated, before you are asked

The organization keeps root roles on its own UserRegistry, so it can
`setResolver`, `setSubregistry`, or `unregister` any agent subname regardless
of what `register()` granted the owner. ENSv2 calls the opposite state
emancipation, reached by revoking those roles on `ROOT_RESOURCE`.

Nymspace is deliberately unemancipated. State it rather than let it be
discovered:

> The organization can still reclaim any of these agents. That is the product,
> not an oversight — an organization that could not revoke a compromised
> agent's identity would be a worse product, not a purer one. What the agent
> controller cannot do is act outside the one record it was granted.

A judge who knows ENSv2 will ask whether the registry is emancipated. Having
the answer ready turns the question from a gap into a design decision.

## Scene 2: Discovery and trust

### 1:10 to 2:00

Open Discover.

Type:

> Find a trustworthy research agent with MCP support.

Show query state.

Result appears.

Explain:

> This is not a local agent directory. The selection is based on live ERC 8004 data indexed by The Graph Agent0 Subgraph.

Open evidence.

Show:

* ERC 8004 ID
* ENS claim
* MCP endpoint
* feedback
* validation
* Graph timestamp

Show ENSIP 25 verified.

Say:

> The registry claims this ENS name, and the ENS name confirms that specific registry entry.

## Scene 3: Financial authority

### 2:00 to 2:45

Open Request Task.

Task:

`Research ENSv2 adoption`

Budget:

`5 USDC`

Execute.

Show success.

Then change amount above policy.

Execute.

Show Privy denial.

Say:

> ENS controls what the agent can say about its identity. Privy controls what the agent can do with money.

## Close

### 2:45 to 3:05

Return to agent inspector.

Say:

> Nymspace gives each autonomous agent a name, machine discoverable endpoints, verifiable trust context, and scoped authority under one organization namespace.

Final screen should show:

```text
Identity     ENSv2
Trust        The Graph / ERC 8004
Finance      Privy
```

## What not to show

Do not spend demo time on:

* login
* environment setup
* database schema
* long code walkthrough
* token swap
* generic chatbot conversation
* unused settings pages

## Backup plan

Record core transactions ahead of time as evidence but perform at least one live write and one live query during the final recorded demo if stable.

If Sepolia is slow:

Show pending state and transition to the already confirmed transaction evidence.

Do not fake a transaction.
