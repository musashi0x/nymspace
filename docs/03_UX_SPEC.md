# UX Specification

## UX principle

The interface should teach the architecture without requiring the judge to know ENSv2 internals.

Avoid a generic admin dashboard with many configuration forms.

The core screen should answer:

1. Who is this agent?
2. What can this agent edit?
3. Can I trust the identity?
4. How can I reach it?
5. What financial authority does it have?

## Information architecture

Primary navigation:

* Fleet
* Discover
* Activity
* Settings

For the hackathon, `Fleet` and `Discover` are mandatory. `Activity` is recommended. `Settings` can be minimal.

## Screen 1: Fleet home

### Hero

```text
Nymspace

<parent>.eth

3 Agents
1 Pending Action
ENSv2 Sepolia
```

### Agent cards

Each card:

```text
research.<parent>.eth

Research Agent

Identity       ENS verified
Registry       ERC 8004 #<id>
MCP            Connected
Trust          Live
Wallet         Policy protected
```

Primary actions:

* Inspect
* Request Task

Secondary:

* Edit Endpoint
* Test Permission

## Screen 2: Agent inspector

Use tabs or stacked sections.

### Identity

Fields:

* Full ENS name
* Parent namespace
* Owner
* Controller address
* Resolver
* ERC 8004 registry
* Agent ID
* ENSIP 25 verification status

Every chain derived field should have:

* `Live`
* `Sepolia`
* Optional transaction or explorer action

### Agent Manifest

Read records from ENS:

* `agent-context`
* `agent-endpoint[mcp]`
* `agent-endpoint[a2a]`
* `agent-endpoint[web]`

Do not call this a database profile.

Make it explicit that ENS is the source.

### Authority

Render a permission matrix from contract reads:

| Capability | Agent controller | Organization owner |
| --- | --- | --- |
| Edit `agent-context` | Allowed | Allowed |
| Edit MCP endpoint | Allowed | Allowed |
| Edit A2A endpoint | Allowed | Allowed |
| Edit ENSIP 25 binding | Denied | Allowed |
| Change resolver | Denied | Allowed |
| Change subregistry | Denied | Owner dependent |
| Transfer identity | Denied | Owner dependent |

Important:

The exact values must come from live EAC state. The table above is the intended policy, not UI constants.

### Test Permission interaction

Button:

`Run permission proof`

Step A:

Update a permitted MCP endpoint value.

Expected status:

`Allowed by Permissioned Resolver`

Step B:

Attempt protected write.

Expected:

`Denied by EAC`

Show actual transaction result.

This is one of the best judge moments.

## Screen 3: Discover

### Input

A conversational search box:

```text
Find a trustworthy research agent with MCP support
```

### Result

```text
research.<parent>.eth

Match             High
ENS binding       Verified
ERC 8004          #1842
MCP               Available
A2A               Available
Feedback          Live
Validation        Completed

Why this agent
The agent advertises the requested capability,
has an MCP endpoint, has recent non revoked feedback,
and its ENS association verifies.
```

The explanation must be generated from live query output.

### Evidence drawer

Show exact source fields used in ranking.

Example:

* Graph chain
* Agent ID
* Registration file timestamp
* MCP endpoint
* Trust model
* Feedback count
* Validation status
* ENS claim

## Screen 4: Task request

```text
Request research task

Agent
research.<parent>.eth

Task
Review ENSv2 adoption

Budget
5 USDC
```

Policy preview:

```text
Privy policy

Requested      5 USDC
Limit          <live configured limit>
Signer         Scoped
Result         Expected to pass
```

Primary:

`Execute`

## Screen 5: Policy denial

For the out of policy request:

```text
Payment blocked

Requested      100 USDC
Policy         Amount limit
Decision       Denied

No funds moved.
```

If using an approval flow:

`Request higher authority`

Do not fake approval if the implemented Privy control is only a denial policy.

## Activity timeline

Events:

* Agent created
* Resolver attached
* Permission granted
* MCP record changed
* Unauthorized record write denied
* ENSIP 25 verified
* Agent discovered via Graph
* Payment allowed
* Payment blocked

Each activity should include provenance:

* onchain tx
* Graph query
* Privy request
* app only event

Above the timeline, an outcome summary: one stacked bar per source, one
segment per status (success, denied, failed, pending), counted by the API over
the whole log rather than from the rows the timeline loaded. Status uses the
same colours as the timeline's badges. Selecting a segment filters the
timeline through the URL (`?source=privy&status=denied`), so a filtered view
survives a reload and can be shared; the chart keeps showing every source and
mutes the segments outside the filter. The same filters are reachable from
controls beside the chart, because a chart segment is not a keyboard target.

## Loading states

Never show fake success placeholders.

Use:

* `Reading ENSv2 state`
* `Waiting for transaction`
* `Waiting for Agent0 indexing`
* `Evaluating wallet policy`

## Empty states

### No agents

Explain:

`Create your first agent identity under your ENSv2 namespace.`

### No Graph match

Explain:

`No live Agent0 result matched this request.`

Provide:

`Search all MCP agents`

### No Privy wallet

Explain:

`Financial authority has not been configured for this agent.`

Do not show a disabled fake balance.

## Error taxonomy

### Permission denied

This is a product state, not a generic red error.

Use:

`Blocked by identity policy`

### RPC error

Use:

`Sepolia RPC unavailable`

### Indexing delay

Use:

`ERC 8004 registration exists but is not indexed yet`

### Policy denied

Use:

`Blocked by financial policy`
