# Frontend State Machine

## Principle

The UI must distinguish pending, denied, failed, and unverified states.

A policy denial is not a system failure.

An EAC denial is not a system failure.

They are proof that the control plane works.

## Agent identity state

```ts
type IdentityState =
  | "idle"
  | "loading"
  | "active"
  | "partial"
  | "rpc_error"
```

### Partial

Use when the ENS name exists but one linked component is missing.

Examples:

* no resolver
* no MCP record
* no ENSIP 25 binding

## Permission action state

```ts
type PermissionActionState =
  | "checking"
  | "allowed"
  | "denied"
  | "submitting"
  | "confirmed"
  | "reverted"
  | "rpc_error"
```

### Expected denial

When an intentionally unauthorized transaction reverts:

Render:

`Blocked by ENSv2 authority`

Do not render:

`Something went wrong`

## ENSIP 25 state

```ts
type VerificationState =
  | "unchecked"
  | "checking"
  | "verified"
  | "registry_claim_missing"
  | "ens_record_missing"
  | "mismatch"
  | "rpc_error"
```

## Graph state

```ts
type GraphState =
  | "idle"
  | "querying"
  | "results"
  | "empty"
  | "indexing_pending"
  | "provider_error"
```

## Financial action state

```ts
type FinancialState =
  | "idle"
  | "preparing"
  | "submitting"
  | "executed"
  | "denied"
  | "pending_approval"
  | "failed"
```

## Create agent wizard

### State 1

`identity_input`

Fields:

* label
* controller
* endpoints

### State 2

`registry_transaction`

Show transaction status.

### State 3

`resolver_setup`

### State 4

`permissions_setup`

Show exact records that will be delegated.

### State 5

`verify_chain_state`

Read everything back.

### State 6

`complete`

Do not mark complete based only on transaction submission.

## Discover flow

```text
input
  |
  v
parsing_intent
  |
  v
querying_graph
  |
  +--> empty
  |
  v
ranking
  |
  v
verifying_ens
  |
  v
results
```

The Graph source state should remain visible in the result card.

## Activity timeline state

Sort by actual occurrence time.

Pending external operations may update in place from pending to success.

Keep failed and denied events rather than removing them.
