# API Contract

## Conventions

Base:

```text
/api
```

JSON responses.

Every external operation should return normalized status and evidence.

### Errors and the request id

Every response carries an `X-Request-Id` header. A request that sends one gets
it back when it is at most 255 characters of `[A-Za-z0-9_=-]`; otherwise the API
generates a UUID. Both CORS policies expose the header, so a browser can read
it. The id names the request's lines in the process log (`docs/22_DEPLOYMENT.md`,
"Finding a request in the logs").

Every failure the API shapes itself is JSON carrying the same id:

```json
{ "error": "internal error", "requestId": "9f1c2d7e-…" }
```

- A 404 for an unknown path adds `path`.
- A handled failure (an unknown agent, an unreachable provider) carries its own
  `error` message and its `status`.
- A 500 carries only the generic message and the id. The error's detail goes to
  the process log under that id, never into the body.

Validation failures (400) keep the shape `@hono/zod-validator` gives them and
carry the id in the header only. A denial is not a failure: it is a 200
describing the denial.

## GET `/api/agents`

Returns local agent list plus light live status.

Response:

```json
{
  "agents": [
    {
      "id": "agent_research",
      "ensName": "research.example.eth",
      "controllerAddress": "0x...",
      "identityStatus": "verified",
      "graphStatus": "indexed",
      "financialStatus": "policy_configured"
    }
  ]
}
```

## POST `/api/agents`

Creates provisioning request.

Request:

```json
{
  "label": "research",
  "controllerAddress": "0x...",
  "context": {
    "role": "research",
    "description": "Research agent"
  },
  "endpoints": {
    "mcp": "https://..."
  }
}
```

Response:

```json
{
  "agentId": "agent_research",
  "status": "ens_pending",
  "transactions": []
}
```

If wallet signing occurs client side, the backend may instead return transaction call data.

## GET `/api/agents/:id/identity`

Returns live ENS data.

```json
{
  "ensName": "research.example.eth",
  "chainId": 11155111,
  "owner": "0x...",
  "controller": "0x...",
  "registry": "0x...",
  "resolver": "0x...",
  "records": {
    "agent-context": "...",
    "agent-endpoint[mcp]": "https://..."
  },
  "ensip25": {
    "status": "verified",
    "registry": "0x...",
    "agentId": "1842"
  },
  "fetchedAt": "..."
}
```

## GET `/api/agents/:id/permissions`

Query:

```text
?controller=0x...
```

Response:

```json
{
  "controller": "0x...",
  "recordPermissions": {
    "agent-context": true,
    "agent-endpoint[mcp]": true,
    "agent-endpoint[a2a]": true,
    "agent-registration[...][1842]": false
  },
  "registryPermissions": {
    "setResolver": false,
    "setSubregistry": false,
    "unregister": false
  },
  "source": "ensv2"
}
```

## POST `/api/agents/:id/permissions`

Owner only.

Request:

```json
{
  "controller": "0x...",
  "recordKey": "agent-endpoint[mcp]",
  "grant": true
}
```

Response:

```json
{
  "status": "pending",
  "transaction": {
    "hash": "0x..."
  }
}
```

## POST `/api/agents/:id/records`

For server controlled controller signing only.

For browser wallet mode, build the transaction client side instead.

Request:

```json
{
  "key": "agent-endpoint[mcp]",
  "value": "https://new.example/mcp"
}
```

## POST `/api/agents/:id/verify`

Runs ENSIP 25 verification.

Response:

```json
{
  "status": "verified",
  "ensName": "research.example.eth",
  "registry": "0x...",
  "agentId": "1842",
  "recordKey": "agent-registration[...]",
  "recordPresent": true
}
```

## POST `/api/discover`

Request:

```json
{
  "query": "Find a trustworthy research agent with MCP support",
  "chains": [11155111]
}
```

Response:

```json
{
  "query": "...",
  "results": [
    {
      "graphId": "11155111:1842",
      "ensName": "research.example.eth",
      "mcpEndpoint": "https://...",
      "signals": {
        "feedbackCount": 18,
        "completedValidations": 2,
        "ensip25": "verified"
      },
      "reason": "..."
    }
  ],
  "dataSource": {
    "provider": "the-graph",
    "fetchedAt": "..."
  }
}
```

## GET `/api/agents/:id/wallet`

Returns safe financial metadata.

```json
{
  "address": "0x...",
  "provider": "privy",
  "token": { "address": "0x...", "symbol": "USDC", "decimals": 6 },
  "signerMode": "agent key, capped by policy; organization owner key can escalate",
  "policy": {
    "label": "Agent spend limit",
    "maxAmount": "10000000",
    "token": { "address": "0x...", "symbol": "USDC", "decimals": 6 },
    "ruleName": "Transfer at most 10000000 USDC base units",
    "status": "active"
  }
}
```

Do not return secret policy configuration if it reveals credentials.

`maxAmount` is in the token's base units and is read from the live policy on
every request. The policy's own token travels beside it rather than being
assumed from the deployment's: a policy pinning a different contract than the
one configured is a misconfiguration the screen should show, not one it should
hide.

## Amounts and tokens

Every amount in this contract is a **decimal string in the token's base
units** — 5 USDC is `"5000000"`, not `"5"`. Two reasons, and the second is the
expensive one:

* A JSON number is a float before it is anything else, and wei does not fit in
  one.
* An amount written as though it were whole tokens still executes. It returns a
  transaction hash, renders as a success, and moves a millionth of what the
  screen says.

`token` is the token's **contract address**, not its symbol. It is optional and
defaults to the configured payment token; a token the deployment is not
configured to pay in is a `400`, never a silent fallback to a native transfer.

## POST `/api/agents/:id/payments/preview`

Request:

```json
{
  "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "amount": "5000000",
  "recipient": "0x..."
}
```

Response:

```json
{
  "expected": "allowed",
  "requestedAmount": "5000000",
  "limitAmount": "10000000",
  "token": { "address": "0x...", "symbol": "USDC", "decimals": 6 },
  "limitToken": { "address": "0x...", "symbol": "USDC", "decimals": 6 },
  "policySummary": {
    "label": "Agent spend limit",
    "ruleName": "Transfer at most 10000000 USDC base units"
  },
  "enforcement": "privy",
  "informational": true
}
```

Preview is informational.

Real enforcement still happens in Privy.

The payload says so in its own body rather than only in this document, because
the preview is exactly the number a browser could lie about. A request for a
token the policy does not name previews as `denied` however small the amount
is: the policy pins the contract as well as the limit.

## POST `/api/agents/:id/payments`

Request:

```json
{
  "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "amount": "5000000",
  "recipient": "0x...",
  "memo": "Research task"
}
```

Possible responses:

### Executed

```json
{
  "status": "executed",
  "transactionHash": "0x..."
}
```

### Denied

```json
{
  "status": "denied",
  "reason": "RPC request denied due to policy violation",
  "escalation": {
    "requestId": "...",
    "authority": "organization owner"
  }
}
```

A denial is HTTP 200. It is the control plane working, and an HTTP error would
put it on the same path as an outage.

`escalation` is present only when an owner signing key is configured, and the
console renders its action only when it is present. With no authority above the
agent there is no approval path, so none is offered — the affordance follows
the configuration rather than a flag.

### Approval path

```json
{
  "status": "pending_approval",
  "requestId": "..."
}
```

Only return approval status if the actual chosen Privy flow supports it.

## POST `/api/agents/:id/payments/:requestId/approve`

Executes the payment that `requestId` was denied, under the organization
owner's key.

No request body. The amount, recipient, and token come from the recorded
denial, never from the caller: an approval that carried its own amount would
approve whatever the client said it approved.

```json
{
  "status": "executed",
  "transactionHash": "0x...",
  "approvedRequestId": "...",
  "authority": "organization owner"
}
```

`409` when no owner key is configured. `404` when `requestId` is not a denied
payment belonging to this agent.

The denial stays in the timeline. The approval is its own pending event,
resolved in place when the owner's key answers — replacing the denial with a
success would be a timeline claiming the payment was always fine.

## GET `/api/activity`

Filters:

* agent
* source
* type
* status

Used for the activity timeline and demo evidence.
