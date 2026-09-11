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

**Built:** one `ALLOW` rule with two conditions — `ethereum_transaction.to`
equals the USDC contract, and `ethereum_calldata` `transfer.amount` is `lte` the
limit, decoded with the ERC 20 ABI. Privy defaults to `DENY` when no rule
matches, so a single `ALLOW` rule is a whitelist: this signer may transfer this
one token, up to this much, and may do nothing else — not a native transfer, not
`approve`, not a different token. A rule on the transaction's `value` field says
none of that.

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

**Built:** the affordance is derived from the configuration, not from a flag.
With `PRIVY_OWNER_KEY_ID` and `PRIVY_OWNER_PRIVATE_KEY` set, a denial carries an
escalation reference and the console offers the action; without them the denial
carries nothing and the console offers nothing. Approving re-sends the amount,
recipient and token recorded at the time of the denial — not a payload the
browser sends back — signed by the owner's key.

The denial remains in the timeline. The approval is a separate pending event
that resolves in place, because replacing the denial with a success would be a
timeline claiming the payment was always fine.

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

### Chosen: organization-owned wallet, agent as a restricted additional signer

The wallet's owner is a key quorum the organization holds. The agent is an
additional signer whose `override_policy_ids` carry the cap. Privy evaluates
only the acting signer's override policy, which makes three things true that a
wallet-level policy cannot:

* The cap is on **the agent's authority**, so "the agent cannot spend more than
  this" is literally true rather than a statement about the application
  restraining itself.
* The agent cannot reconfigure itself. Changing a signer is a wallet update, and
  wallet updates require the owner.
* The escalation below is real: the owner's key executes the identical request
  the agent's key was refused.

The cost is that every request against the wallet must now be signed — an
unsigned caller carries no authority, which is the intended outcome and also the
thing that breaks first if a deployment is missing a key. `pnpm
provision:signers` makes the change; `pnpm provision:wallet` alone leaves the
older wallet-level arrangement, which still denies correctly and claims less.

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
