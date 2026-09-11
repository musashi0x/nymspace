## 0. Prerequisites — external, and neither is code

- [ ] 0.1 Restore the Privy credentials in `.env`: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY_ID`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`. All four are empty in this checkout, so nothing in sections 4 or 5 can run
- [ ] 0.2 Fund the agent wallet with Base Sepolia USDC from Circle's faucet, at least `2 × denied + allowed`. Gate C assertion 1 exists to eliminate "the wallet was empty" as the cause of a denial and cannot be satisfied by code
- [ ] 0.3 Confirm the wallet still holds Base Sepolia ETH for gas. An ERC 20 transfer is not gasless

## 1. The token path

- [x] 1.1 Add `TokenSpec` — address, symbol, decimals — and the ERC 20 `transfer` ABI fragment the policy and the encoder share
- [x] 1.2 Build transfer calldata with viem and send a zero-value transaction to the token contract when a token is present; keep the native path for when it is not
- [x] 1.3 Rename `maxValueWei` to `maxAmount` and carry the token on `PolicyLimit`, so no number's unit is implied by its variable name
- [x] 1.4 Format and parse every amount through the token's decimals; assert in a test that six-decimal and eighteen-decimal amounts do not collide
- [x] 1.5 Unit-test the encoder against a known-good `transfer` calldata string

## 2. The policy

- [x] 2.1 Create the token policy: one `ALLOW` rule, conditions on `to` and on `transfer.amount`, with the ERC 20 ABI inline
- [x] 2.2 Read the limit back from whichever condition shape the policy carries — calldata or native value — and fail loudly if neither is present
- [x] 2.3 Update the limit in place, preserving the token conditions, so Gate C can still move the limit and restore it
- [x] 2.4 Unit-test that a policy with no limiting condition throws rather than rendering as an unconstrained limit

## 3. Signed requests and split authority

- [x] 3.1 Implement the `privy-authorization-signature` header: RFC 8785 canonical JSON over `{version, method, url, body, headers}`, ECDSA P-256, base64
- [x] 3.2 Unit-test canonicalisation against nested and out-of-order keys, and assert the signature verifies against the public key
- [x] 3.3 Give `PrivyClient` an optional authorization key, so the owner client and the agent client differ only in which key they hold
- [x] 3.4 Implement key quorum creation and wallet signer configuration — `owner_id`, `additional_signers`, `override_policy_ids`
- [ ] 3.5 Set the owner quorum and the agent signer on the demo wallet, live
- [ ] 3.6 Assert live that an unsigned request is refused once the wallet has an owner

## 4. API

- [x] 4.1 Accept `token` on both payment routes, default it to the configured token, and reject an unrecognised one with a 400
- [x] 4.2 Return the token and its decimals alongside the limit, so the console never hardcodes either
- [x] 4.3 Record the denied request — amount, recipient, token — on the pending event, so an approval re-submits what was actually denied
- [x] 4.4 Add the approval route, executing under the owner key, and return the escalation reference from a denial only when an owner signer is configured
- [x] 4.5 Add `getEvent` to the store so the approval route reads the request it is approving
- [x] 4.6 Test the four outcomes plus the approval path against injected fakes

## 5. Console

- [x] 5.1 Denominate screens 4 and 5 in the token, with the input in token units rather than base units
- [x] 5.2 Render `Request owner approval` only when the response carries an escalation reference
- [x] 5.3 Show the executed approval as the same request, approved by a different authority

## 6. Gate C, again

- [ ] 6.1 Re-run the gate on USDC: denied first, allowed second, limit moved, limit restored
- [ ] 6.2 Add the assertion that the agent key cannot change its own signer configuration
- [ ] 6.3 Add the assertion that the owner key executes the request the agent key was denied
- [ ] 6.4 Commit `evidence/gate-c.json`
- [ ] 6.5 Update the README's sponsor mapping and transaction-evidence table from the USDC run. Until it runs, the README keeps describing the native-ETH gate that actually passed — a claim about an unrun gate is the one thing the evidence table cannot carry

**Gate C — Financial, on USDC.**

- **Run**: `pnpm --filter @nymspace/privy verify:policy`
- **Passes when**: the wallet holds more USDC than the whole run spends; the over-limit transfer is denied with a policy reason and no hash; the identical-except-amount transfer executes; raising the limit executes the previously denied request and restoring it denies again; the agent key cannot alter its own signer configuration; the owner key executes what the agent key could not; no credential appears in any evidence payload.
- **Lies by**: a denial with a cause that is not the policy. An empty USDC balance denies on chain, not in the enclave, and reads identically in the console.
- **Control**: assertion 1 requires a balance above the whole run's spend, and assertion 4 moves the limit and restores it — the only observation that distinguishes an enforced cap from an integration that rejects large numbers.
- **Evidence**: `packages/privy/evidence/gate-c.json`, committed.
- **On fail**: drop the signer split and the escalation, keep USDC on the wallet-level policy that already passes, and do not render an approval affordance. `docs/08`'s cut line is unchanged.
