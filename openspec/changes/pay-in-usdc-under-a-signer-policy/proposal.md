## Why

Gate C passes, and it passes on the wrong asset.

`evidence/gate-c.json` records a real policy-controlled transaction: 0.0001 ETH executed, 0.01 ETH denied, the limit moved and the identical request changed outcome. That is the proof `docs/14_EXECUTION_PLAN.md` gates Day 3 on, and it is genuinely earned.

But every document that describes the demo says something else. `docs/08_PRIVY_INTEGRATION.md` scripts `Pay research.<parent>.eth 5 USDC` and `100 USDC`. `docs/03_UX_SPEC.md` screens 4 and 5 render `5 USDC` and `100 USDC`. `docs/15_DEMO_SCRIPT.md` scene 3 says `5 USDC`. `docs/10_API_CONTRACT.md` puts `"token": "USDC"` in both payment request bodies. The implementation sends native ETH, the API accepts no token at all, and `PaymentRequest.tokenAddress` is a field the type declares and `sendPayment` silently ignores — a caller that passes a token address gets a native transfer and no error.

The gap is not cosmetic. An amount cap on native `value` constrains one field of one transaction shape. The B2B story the sponsor category asks for — an organization's agent spending the organization's money inside an enforceable boundary — is a stablecoin story, and the control that matches it pins the token contract *and* the transferred amount, read out of calldata. That is a strictly stronger claim, and Privy's policy engine supports it directly.

The second gap is who the limit binds. Today the policy is attached to the wallet, and the wallet is owned by the application, so "the agent cannot exceed the limit" is really "the application configured itself a limit". Privy's per-signer override policies express the intended shape exactly: the organization owns the wallet, the agent is an additional signer, and the cap is attached to *the agent's signing authority*. That mirrors the ENS side one-for-one — the organization holds root roles, the controller holds a record-scoped grant — which `docs/08` calls the strongest part of the pitch and the code does not yet demonstrate.

It also makes an approval escalation real rather than simulated. With the cap on the agent's signer, a denied payment can be re-submitted under the owner's key and execute. `docs/08` permits `Request owner approval` only if that path is actually implemented; this is the version that is.

## What Changes

- **Payments move to USDC.** `sendPayment` builds `transfer(address,uint256)` calldata for a configured ERC 20 and sends a zero-value transaction to the token contract. Native transfers remain supported for the case where no token is configured, and the two are distinguished by the request rather than by a mode flag.
- **The policy constrains the token and the amount.** One rule, two conditions: `ethereum_transaction.to` equals the token contract, and `ethereum_calldata` `transfer.amount` is `lte` the limit, decoded with the ERC 20 ABI. Privy's default action is `DENY`, so the rule is also what makes every other transaction shape unavailable to the signer.
- **Amounts are base units end to end.** A token's decimals arrive with the token, never as a constant, and no amount is ever a float. `maxValueWei` becomes `maxAmount` plus the token it is denominated in, because a number whose unit is implied by its variable name is the demo's easiest way to show 100 USDC and send 100 wei.
- **`token` becomes part of the API contract.** `POST /payments` and `/payments/preview` accept it, validate it against the configured token, and reject an unrecognised one instead of falling through to a native transfer.
- **Authority is split across two keys.** The wallet's owner is a key quorum the organization holds. The agent is an additional signer whose `override_policy_ids` carry the cap. Requests are signed with the P-256 authorization key of whichever authority is acting, so an unsigned request is refused and a signature identifies which policy applies.
- **Escalation is implemented, not claimed.** A denial returns `denied` and, only when an owner signer is configured, an escalation reference. Approving re-submits the identical request under the owner's key. With no owner signer configured the denial stays a denial and no approval affordance appears.

## Capabilities

### Modified Capabilities

- `financial-authority`: the control becomes a token-and-amount rule bound to the agent's signer rather than an amount rule bound to the wallet; adds the requirement that the signer's own authority cannot alter its constraints, and that an approval path exists only when a distinct higher authority actually executes it.
- `api-server`: payment routes gain the token field from `docs/10_API_CONTRACT.md`, an approval route, and the rule that an unrecognised token is rejected rather than reinterpreted.
- `agent-console`: screens 4 and 5 denominate in the token, and the denial screen offers the approval action only when the API reports one.

## Impact

- **Blocked on**: Privy credentials, which are absent from `.env` in this checkout — `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY_ID`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` are all empty. Nothing live can be verified until they are restored. Unit tests and typechecking are not blocked; the gate is.
- **Blocked on**: Base Sepolia test USDC in the agent wallet, from Circle's faucet. Gate C's first assertion exists to remove "the wallet was empty" as an explanation for a denial, and it cannot be satisfied by code.
- **Onchain**: ERC 20 transfers on Base Sepolia from the existing agent wallet. The wallet and its ETH balance are reused; gas still comes from native ETH.
- **Risk**: setting an owner on an existing wallet is a one-way change in practice — every later request must be signed. If Privy refuses the migration, the fallback is a new wallet, re-funded, with the old one left in the evidence trail.
- **Cut line**: `docs/08` is unchanged and still binding. If the signed per-signer path does not verify, the change falls back to the wallet-level policy that already passes Gate C, keeps USDC, and drops the escalation rather than simulating it.
