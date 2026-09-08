# API Contract

## Conventions

Base:

```text
/api
```

JSON responses.

Every external operation should return normalized status and evidence.

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
  "policy": {
    "label": "Agent spend limit",
    "status": "active"
  }
}
```

Do not return secret policy configuration if it reveals credentials.

## POST `/api/agents/:id/payments/preview`

Request:

```json
{
  "token": "USDC",
  "amount": "5",
  "recipient": "0x..."
}
```

Response:

```json
{
  "expected": "allowed",
  "policySummary": {
    "label": "Agent spend limit"
  }
}
```

Preview is informational.

Real enforcement still happens in Privy.

## POST `/api/agents/:id/payments`

Request:

```json
{
  "token": "USDC",
  "amount": "5",
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
  "reason": "policy_limit"
}
```

### Approval path

```json
{
  "status": "pending_approval",
  "requestId": "..."
}
```

Only return approval status if the actual chosen Privy flow supports it.

## GET `/api/activity`

Filters:

* agent
* source
* type
* status

Used for the activity timeline and demo evidence.
