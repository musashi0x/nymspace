# Agent Identity Standards

## Goal

Use ENS standards as the public identity surface and ERC 8004 as the onchain agent registration and trust system.

## ENSIP 26

Status: Draft.

ENSIP 26 standardizes agent discovery through ENS text records.

### Required record

`agent-context`

Purpose:

A single entry point describing the agent and how to interact with it.

Format can be text, Markdown, YAML, JSON, or another agent suitable format.

For Nymspace, use JSON because the UI and agent runtime can parse it deterministically.

Suggested MVP value:

```json
{
  "name": "research.<parent>.eth",
  "role": "research",
  "description": "Research agent for protocol analysis",
  "capabilities": [
    "protocol-analysis",
    "web-research"
  ],
  "standards": [
    "ENSIP-25",
    "ENSIP-26",
    "ERC-8004"
  ]
}
```

### Endpoint records

Use:

* `agent-endpoint[mcp]`
* `agent-endpoint[a2a]`
* `agent-endpoint[web]`

Values should be valid URLs.

MVP requires MCP.

A2A and web are recommended.

## Agent Manifest concept

Nymspace may call the combined identity surface the **Agent Manifest**.

Important product wording:

The Agent Manifest is not a separate authoritative database object.

It is a UX representation of standardized ENS records plus linked registry state.

### Manifest source map

| Manifest field | Source |
| --- | --- |
| Name | ENS |
| Agent context | ENSIP 26 text |
| MCP endpoint | ENSIP 26 text |
| A2A endpoint | ENSIP 26 text |
| ERC 8004 identity | Registry |
| ENS association | ENSIP 25 |
| Reputation | ERC 8004 through Graph |
| Validation | ERC 8004 through Graph |
| Wallet policy | Privy |

## ENSIP 25

Status: Draft.

ENSIP 25 defines a parameterized ENS text key:

```text
agent-registration[<registry>][<agentId>]
```

The registry component is an ERC 7930 interoperable address representation.

The text value must be non empty.

Recommended value:

```text
1
```

The semantic meaning is in the key and presence, not the literal value.

## Correct verification model

Do not describe this as two independent cryptographic signatures.

The useful verification flow is:

1. Start from an agent registry entry.
2. Obtain its claimed ENS name, registry address, and agent ID.
3. Construct the ENSIP 25 text key.
4. Resolve that key on the claimed ENS name.
5. If the resolved value is non empty, the ENS association verifies according to ENSIP 25.

Conceptually:

```text
ERC 8004 registration
claims:
research.<parent>.eth
        |
        v
construct ENSIP 25 key
        |
        v
resolve record on
research.<parent>.eth
        |
        v
non empty
        |
        v
Verified
```

## Authority policy for verification record

The operational agent controller should not automatically control the ENSIP 25 record.

Reason:

If an agent can rewrite its own registration binding without higher authority, the organization loses an important identity boundary.

Recommended:

* Organization owner controls ENSIP 25 binding.
* Agent controller controls operational endpoint records.

## ERC 8004 registration

For each demo agent, keep the registration small and deterministic.

Recommended fields in the registration metadata where supported:

* name
* description
* ENS name
* MCP endpoint
* A2A endpoint
* trust model
* agent wallet
* x402 support if actually available

Do not advertise an endpoint or capability that does not work in the demo.

## Demo agent limit

Use three registrations maximum.

Suggested:

### Research

Core demo agent.

Has MCP endpoint.

Has ENSIP 25 verification.

Has Privy wallet.

### Trader

Secondary identity example.

No swap integration required.

Can demonstrate different permissions or capabilities.

### Deploy

Secondary example.

Can be present mainly to show fleet hierarchy.

## Existing scripts

If the existing project already contains:

```text
scripts/bind-ensip25.ts
scripts/verify-ensip25.ts
```

reuse only if the event rules allow reuse for your selected build pool.

Document pre existing work clearly if entering a continuity category.

If entering a from scratch category that forbids project specific prior code, reimplement the minimal logic during the event rather than silently importing it.

## Verification status model

Use:

```ts
type Ensip25Status =
  | "unchecked"
  | "checking"
  | "verified"
  | "registry_claim_missing"
  | "ens_record_missing"
  | "mismatch"
  | "rpc_error"
```

Never collapse all failures into `unverified`.
