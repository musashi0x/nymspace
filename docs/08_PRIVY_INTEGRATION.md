# Privy Integration

## Objective

Implement the smallest real B2B financial authority flow.

Do not build a full organization treasury platform.

## Sponsor fit

The target is the B2B financial product category.

Minimum product story:

> An organization has an agent identity and a controlled wallet. The agent can execute only within an enforceable financial boundary.

## Required live pieces

* At least one Privy wallet
* A business or organization use case
* One real payment or wallet operation
* At least one Privy control
* Working source code and demo

## Recommended control model

Use an application or agent wallet with a restricted additional signer or other supported Privy control.

Privy policies can enforce constraints such as:

* transfer limits
* recipient allowlists
* contract allowlists
* network restrictions
* time windows
* calldata constraints

For the hackathon, choose one amount based constraint.

## MVP policy

Conceptually:

```text
Agent signer
can send USDC
up to demo limit
to approved test recipient
on approved network
```

Keep the limit obvious in the UI.

Example:

```text
Policy
Maximum allowed transfer: 10 USDC
```

The actual policy syntax must use the current Privy docs and APIs.

Do not hardcode a fake policy decision in the application.

## Financial flow

### Allowed case

Input:

```text
Pay research.<parent>.eth 5 USDC
```

Result:

```text
Allowed
Transaction executed
```

### Denied case

Input:

```text
Pay research.<parent>.eth 100 USDC
```

Result:

```text
Denied by Privy policy
No funds moved
```

If the chosen Privy control supports an approval escalation path and you have implemented it, show:

`Request owner approval`

Otherwise stop at a real denial.

Do not simulate an approval system that is not implemented.

## Wallet ownership

Choose one model and document it.

For the hackathon, simplest options include:

### Application owned agent wallet

Good for:

* autonomous agent
* server side execution
* clear B2B automation story

### User owned wallet with restricted server signer

Good for:

* stronger user ownership story
* agent can act offline inside policy

Pick based on whichever setup reaches a working policy controlled transaction fastest.

## Security separation

Prefer separate authority for:

* wallet or policy management
* routine transaction signing

A compromised routine agent signer should not automatically be able to change its own policy.

This mirrors the ENS architecture:

```text
Identity

Organization owner
    |
    +--> grants narrow ENS record rights
            |
            v
       agent controller


Finance

Wallet / policy owner
    |
    +--> grants narrow transaction rights
            |
            v
       agent signer
```

This symmetry is a strong pitch.

## API abstraction

Keep Privy details behind one service.

```ts
type PaymentResult =
  | {
      status: "executed"
      transactionHash: string
    }
  | {
      status: "denied"
      policyReason: string
    }
  | {
      status: "pending_approval"
      requestId: string
    }
  | {
      status: "failed"
      errorCode: string
    }
```

## UI data

Read and display:

* Wallet address
* Agent association
* Policy summary
* Signer mode
* Last action

Do not expose:

* Authorization keys
* App secrets
* Raw signing material

## Cut line

If a real policy controlled transaction is not working by the implementation gate in `14_EXECUTION_PLAN.md`, stop expanding Privy.

The fallback is Bazantic, not a half mocked Privy demo.
