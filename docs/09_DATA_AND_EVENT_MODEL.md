# Data and Event Model

## Principle

The application database coordinates the product.

It is not the source of truth for identity, trust, or policy.

## Entities

### Organization

```ts
type Organization = {
  id: string
  displayName: string
  parentEnsName: string
  chainId: 11155111
  createdAt: string
}
```

### Agent

```ts
type Agent = {
  id: string
  organizationId: string
  slug: string
  ensName: string
  controllerAddress: string
  erc8004AgentId?: string
  erc8004Registry?: string
  privyWalletId?: string
  createdAt: string
  updatedAt: string
}
```

Do not store live ENS records as authoritative values.

They may be cached, but label them as cache.

### Agent identity snapshot

Useful for UI caching:

```ts
type AgentIdentitySnapshot = {
  agentId: string
  fetchedAt: string
  owner: string
  resolver: string
  context?: string
  mcpEndpoint?: string
  a2aEndpoint?: string
  webEndpoint?: string
  ensip25Status: string
}
```

### Graph snapshot

```ts
type GraphSnapshot = {
  agentId: string
  chainId: number
  fetchedAt: string
  graphAgentKey: string
  registrationFile: unknown
  feedbackCount?: number
  validationCount?: number
}
```

### Financial authority reference

```ts
type FinancialAuthorityRef = {
  agentId: string
  privyWalletId: string
  walletAddress: string
  policyId?: string
  policyLabel?: string
}
```

Never store private authorization key material in the normal app database.

## Unified activity event

```ts
type ActivityEvent = {
  id: string
  agentId?: string
  organizationId: string
  source: "ens" | "erc8004" | "graph" | "privy" | "app"
  type: ActivityType
  status: "pending" | "success" | "denied" | "failed"
  occurredAt: string
  actor?: string
  txHash?: string
  externalId?: string
  summary: string
  metadata?: Record<string, unknown>
}
```

## Activity types

```ts
type ActivityType =
  | "agent.created"
  | "ens.resolver.attached"
  | "ens.permission.granted"
  | "ens.permission.revoked"
  | "ens.record.updated"
  | "ens.action.denied"
  | "erc8004.registered"
  | "ensip25.verified"
  | "ensip25.failed"
  | "graph.indexed"
  | "graph.discovery.executed"
  | "privy.wallet.created"
  | "privy.payment.executed"
  | "privy.payment.denied"
  | "privy.approval.requested"
```

## Event provenance

Every event needs evidence.

### ENS

* tx hash
* block number
* contract address

### Graph

* chain
* Graph entity ID
* query timestamp
* subgraph ID

### Privy

* request ID or transaction hash
* policy decision

## State transitions

### Agent provisioning

```text
draft
  |
  v
ens_pending
  |
  v
ens_active
  |
  v
identity_binding_pending
  |
  v
identity_verified
  |
  v
graph_pending
  |
  v
discoverable
```

Financial setup is orthogonal:

```text
no_wallet
  |
  v
wallet_created
  |
  v
policy_configured
  |
  v
financially_active
```

Do not force one global “active” status that hides which integration is incomplete.
