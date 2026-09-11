## 0. Prerequisites — external, and neither is code

- [x] 0.1 Restore the Privy credentials in `.env`: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY_ID`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`. All four are present as of 2026-09-11. That was a presence check only; 0.5 is the proof that they work
- [ ] 0.2 Fund the agent wallet with Base Sepolia USDC from Circle's faucet, at least `2 × denied + allowed`. Gate C assertion 1 exists to eliminate "the wallet was empty" as the cause of a denial and cannot be satisfied by code
- [ ] 0.3 Confirm the wallet still holds Base Sepolia ETH for gas. An ERC 20 transfer is not gasless
- [ ] 0.4 Set `DEMO_PAYMENT_TOKEN_ADDRESS` in `.env` to Circle's Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, as `.env.example` has it. It is absent from `.env`, so `demoToken()` returns `null` and every payment takes the native path. A gate run today would re-prove native ETH and read as a USDC run
- [ ] 0.5 Run `pnpm check:credentials`, so the restored Privy credentials are proven by a round trip rather than by being non-empty

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
- [ ] 3.5 Set the owner quorum and the agent signer on the demo wallet, live: `pnpm provision:signers --create-keys`, then put the printed `PRIVY_OWNER_KEY_ID`, `PRIVY_OWNER_PRIVATE_KEY` and `PRIVY_OWNER_POLICY_ID` in `.env`. All three are absent today, so the API offers no escalation. Keep the owner key as a key the operator holds, not as disposable server configuration: D8 makes it phase 2's ops key. Closes design OQ1
- [ ] 3.6 Assert live that an unsigned request is refused once the wallet has an owner
- [ ] 3.7 Confirm that `PRIVY_AUTHORIZATION_KEY_ID` is a key quorum id Privy accepts as a `signer_id`, or set `PRIVY_AGENT_SIGNER_ID`. `provision:signers` falls back to the key id without checking it
- [ ] 3.8 Read the wallet live after 3.5 and record which policy governs an owner-signed request: the owner's additional-signer override, or the wallet-level `policy_ids` that still carry the agent's cap. Decide whether to clear the wallet-level `policy_ids` only after that read. Closes design OQ4, and must land before Gate C assertion 12's result is trusted in either direction

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

## 6. Who may approve — design D8

- [x] 6.1 Choose how approval is authorized. Decided in design.md D8, which closes OQ2: gate the route now, move the owner key into the browser after

**Phase 1 — an operator credential on the route; the owner key stays on the server**

- [ ] 6.2 Require an operator credential on the approve route. The API keeps only a verifier for it and compares in constant time. Nothing that submits the agent's payments holds the credential
- [ ] 6.3 Have the console ask the person for the credential at each approval. The web server never keeps it in its environment and never forwards a stored copy
- [ ] 6.4 Test against injected fakes that an approve request with no credential, or the wrong one, is refused and executes nothing
- [ ] 6.5 Limit the console copy and the README to the phase 1 claim: a server-held owner key, with approval gated by an operator credential

**Phase 2 — the owner signs in the browser**

- [ ] 6.6 Establish which route to a 1-of-2 owner quorum Privy supports: adding a key to the existing quorum, or creating a new quorum and moving the wallet's `owner_id` to it under the current owner's signature. Record the answer in D8
- [ ] 6.7 Move canonicalisation and authorization-payload construction into `@nymspace/core`'s unguarded root export, with `@nymspace/privy` signing on top of it. The existing canonicalisation tests pass unchanged against the moved code
- [ ] 6.8 Generate the browser P-256 key with WebCrypto, non-extractable, and register its public half
- [ ] 6.9 Reach the 1-of-2 owner quorum, the browser key plus the ops key, by whichever route 6.6 found. Neither re-provision nor re-fund the wallet
- [ ] 6.10 Split approval into prepare and submit. The server builds the request from the stored denial and returns the canonical payload; the browser signs it; the server relays the body unchanged
- [ ] 6.11 Remove the owner key from the deployed environment so that the deployed server holds only the agent key, and move the console copy and the README to the phase 2 claim

## 7. Who may move the limit — design OQ3

- [ ] 7.1 Establish whether a Privy policy accepts an `owner_id` and then requires the owner's signature to update. Record the answer in design.md, closing OQ3
- [ ] 7.2 If it does: create the agent's policy owned by the organization's quorum, and move `updatePolicyLimit` onto the owner client, Gate C's limit move included
- [ ] 7.3 If it does not: narrow D5's second consequence in proposal.md to what is true. The agent key cannot reconfigure its signer, and anyone holding the app secret can still move the limit

## 8. Gate C, again

- [ ] 8.1 Re-run the gate on USDC: denied first, allowed second, limit moved, limit restored. Blocked on 0.2–0.5, 3.5, 3.8, phase 1 of section 6, and section 7
- [x] 8.2 Add the assertion that the agent key cannot change its own signer configuration. Present in `verify-policy.ts` as assertion 11; it has not passed until 8.1 runs
- [x] 8.3 Add the assertion that the owner key executes the request the agent key was denied. Present as assertion 12; same caveat, and 3.8 decides what its result means
- [ ] 8.4 Add the assertion that an approve request without the operator credential is refused
- [ ] 8.5 Under 7.2, add the assertions that a policy update is refused when signed by the agent key and when it carries app credentials only. Under 7.3, the evidence records instead that the app secret can move the limit
- [ ] 8.6 For phase 2, add the assertion that an approval whose body is altered after signing is refused. The gate signs with the ops key from the local `.env`, alters the body, and relays it
- [ ] 8.7 Run the gate again once phase 2 lands. The ops key keeps it headless
- [ ] 8.8 Commit `evidence/gate-c.json` after each run
- [ ] 8.9 Update the README's sponsor mapping and transaction-evidence table from the USDC run. Until it runs, the README keeps describing the native-ETH gate that actually passed — a claim about an unrun gate is the one thing the evidence table cannot carry

**Gate C — Financial, on USDC.**

- **Run**: `pnpm --filter @nymspace/privy verify:policy`
- **Passes when**: the wallet holds more USDC than the whole run spends; the over-limit transfer is denied with a policy reason and no hash; the identical-except-amount transfer executes; raising the limit executes the previously denied request and restoring it denies again; the agent key cannot alter its own signer configuration; the owner key executes what the agent key could not; an approval without the operator credential is refused; under phase 2, an approval whose body was altered after signing is refused; the agent key cannot move its own limit, or, under 7.3, the evidence says who can; no credential appears in any evidence payload.
- **Lies by**: a denial with a cause that is not the policy. An empty USDC balance denies on chain, not in the enclave, and reads identically in the console. Also a run with `DEMO_PAYMENT_TOKEN_ADDRESS` unset, which passes on native ETH and looks like a USDC run.
- **Control**: assertion 1 requires a balance above the whole run's spend, and assertion 4 moves the limit and restores it — the only observation that distinguishes an enforced cap from an integration that rejects large numbers.
- **Evidence**: `packages/privy/evidence/gate-c.json`, committed.
- **On fail**: drop the signer split and the escalation, keep USDC on the wallet-level policy that already passes, and do not render an approval affordance. `docs/08`'s cut line is unchanged.
