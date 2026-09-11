# Design

## D1 — The control is a calldata rule, not a value rule

Privy evaluates `ethereum_calldata` conditions against the decoded arguments of the transaction's `data`, given an ABI. The rule this change configures carries two conditions and one action:

```text
to             eq    <token contract>
transfer.amount lte  <limit in base units>       (decoded with the ERC 20 transfer ABI)
action         ALLOW
```

Privy's policy engine defaults to `DENY` when no rule matches, and `DENY` beats `ALLOW`. So a single `ALLOW` rule is a whitelist: this signer may call `transfer` on this one contract for at most this much, and may do nothing else at all — not a native transfer, not `approve`, not another token. A rule on native `value` cannot say any of that.

The cost is that the rule now depends on the ABI shape. The demo's token is USDC, whose `transfer` is the standard one, and the ABI travels in the policy itself rather than being looked up.

## D2 — Base units, never a float, and the unit travels with the number

`maxValueWei` is renamed to `maxAmount`, and `PolicyLimit` carries the token it is denominated in. This is not tidying. USDC has six decimals and ETH has eighteen; a demo that shows `100` and sends `100` base units moves one ten-thousandth of a cent and reports success, and the screen is not wrong in any way a reviewer can see. Every conversion goes through `@nymspace/core`'s `toBaseUnits`/`fromBaseUnits` with decimals read from the configured token, and no amount is ever a `number`. They live in the unguarded package rather than in `@nymspace/privy` because the console parses the input and formats the limit in the browser, and two implementations of the same scaling is how a screen and a wire stop agreeing. Integer string arithmetic, not viem: `@nymspace/core` has no viem dependency, and adding one to the package a client component imports buys nothing here — the scaling is twenty lines and the test is the specification.

`token: null` means native, which keeps the ETH path — and Gate C's existing evidence — meaningful rather than deleted.

## D3 — The token is configuration, not stored state

`financial_authority` gains no column. The token address is deployment configuration (`DEMO_PAYMENT_TOKEN_ADDRESS`), and the limit is read from the live policy on every request, as it already is. The store keeps holding identifiers and nothing that could answer a policy question, which is the property `ALLOWED_COLUMNS` exists to defend.

## D4 — An unrecognised token is rejected, not reinterpreted

`POST /payments` accepts `token`. If it is absent, the configured demo token is used. If it names anything other than the configured token, the request is a 400. The alternative — ignore what you do not recognise — is what the current code does with `tokenAddress`, and it turns "pay 5 USDC" into "send 5 wei of ETH" with no error anywhere.

## D5 — The cap binds the signer, not the wallet

Privy evaluates *only the acting signer's* override policy. So:

```text
wallet owner        organization key quorum        no cap
additional signer   agent authorization key        override policy: transfer USDC <= limit
unsigned request                                   refused — the wallet has an owner
```

Three consequences the demo can show, none of which the current wallet-level policy can:

1. The agent's authority is what is capped, so "the agent cannot spend more than this" is literally true rather than a statement about the application's self-restraint.
2. The agent cannot alter its own constraints: changing `additional_signers` is a wallet update, which requires the owner's signature. Gate C's assertion 10 currently proves this with an unauthenticated request, which only shows that anonymous callers are refused; signing the same request with the agent key is the assertion that means something.
3. The escalation is real. The owner key executes the identical request that the agent key was denied.

The migration risk is stated in the proposal: once the wallet has an owner, every request must be signed, and an unsigned path that used to work stops working.

## D6 — Escalation is offered only when it exists

A denial returns `status: "denied"` always. The response carries an escalation reference only when an owner signer is configured, and the console renders `Request owner approval` only when the response carries one. With no owner key configured the product behaves exactly as it does today: a real denial, no affordance, nothing claimed. `docs/08` forbids simulating an approval system that is not implemented, and the way to obey that under configuration drift is to derive the affordance from the configuration rather than from a feature flag someone forgets to turn off.

The approved payment re-submits the *stored* request — amount, recipient and token as recorded when the denial happened — not a payload the client sends back. An approval flow whose amount comes from the client is an approval of whatever the client says it approved.

## D7 — Request signing is implemented here

Privy authorizes a signer by a `privy-authorization-signature` header: an ECDSA P-256 signature over the RFC 8785 canonicalisation of `{version, method, url, body, headers}`, where `headers` carries `privy-app-id`. The key arrives as a `wallet-auth:`-prefixed base64 DER PKCS8 string.

Canonicalisation is implemented directly rather than pulled in as a dependency. The payload is a closed shape of strings, one integer and nested objects — the subset of RFC 8785 it needs is "sort keys recursively, no whitespace", and `JSON.stringify` with a sorted replacer produces exactly that for this shape. A dependency whose version moves is one more thing to re-verify before a demo, which is the same reason this package speaks REST rather than the SDK.

## D8 — Approval: gate the route now, move the key later

This closes OQ2. The escalation has to prove two different things. First, that execution needs an authority the agent's path does not hold. Second, that a person from the organization made the decision. Today's route proves neither against a caller on the public API. The fix comes in two phases, and phase 1 is shaped so that it does not rule out phase 2.

**Phase 1 — an operator credential on the approve route. The owner key stays on the server.**

- The person supplies the credential at approval time, for each approval. The web server never holds it in its environment and never forwards a stored copy. If it did, anyone who could reach the console could approve, and the hole would just move one hop.
- The API keeps only a verifier for the credential and compares in constant time. The verifier cannot be used to approve, so keeping it on the same server as the agent's key costs nothing. What must never hold the credential is anything that submits the agent's payments.
- What this stops: an unauthenticated caller. What it does not stop: a compromised API server, which holds the agent key, the owner key and the app secret in one environment.
- The claim on screen and in the README is the phase 1 claim: *a server-held owner key, with approval gated by an operator credential*. It is not "the organization's key approved". `docs/08` forbids overstating an approval path, and this is the same rule applied to its strength.

**Phase 2 — the owner signs in the browser.**

- The owner is a key quorum with a threshold of 1 of 2. One key is a browser P-256 key: WebCrypto, non-extractable, generated in the browser and registered by its public half. The other is an ops key kept in a local `.env` and never deployed.
- The deployed server holds only the agent key. Approval becomes prepare/submit. The server builds the request from the stored denial (D6) and returns the canonical payload; the browser signs it; the server relays the body unchanged. Any change the server made to the body would break the signature, so a compromised server cannot forge an approval, and the agent's cap holds even then.
- Canonicalisation and payload construction move into `@nymspace/core`'s unguarded root export, so the browser and the server sign one implementation. This is the same reasoning as `toBaseUnits` in D2.
- The ops key keeps Gate C headless, and it is the recovery path if browser storage is cleared. Without it, losing the browser key means losing the owner, and wallet updates need the owner.
- If 7.2 applies, OQ3's policy owner is this same quorum.

**What phase 1 has to keep possible.** The owner key that 3.5 provisions (`PRIVY_OWNER_*`) becomes phase 2's ops key, so it must be kept as a key the operator holds, not treated as disposable server configuration. Phase 2 then reaches the 1-of-2 quorum in one of two ways, both of which are currently unverified:

1. Add the browser key to the existing quorum, if Privy allows a key quorum to be updated.
2. Create a new 1-of-2 quorum and move the wallet's `owner_id` to it. That is a wallet update signed by the current owner, which is exactly the authority phase 1 keeps.

Either way the wallet is not re-provisioned or re-funded. Phase 2 ends by removing the owner key from the deployed environment.

**Why not phase 2 now.** It carries key lifecycle, a two-step approval, browser-side canonicalisation, and a Gate C change for an owner that no longer lives on the server. The previous attempt at browser signing, #3, was reverted within the hour. Phase 1 closes the hole a curious caller can reach today. Phase 2 closes the one that needs a compromised server.

**Rejected:** keeping the route ungated and disclosing it on screen. That is the simulated approval `docs/08` forbids, with one indirection added.

## Open questions

### OQ1 — Can an owner be set on a wallet that has none

Whether `PATCH /v1/wallets/<id>` can set `owner_id` on a wallet that currently has none. If it cannot, the wallet is recreated and re-funded, and the old wallet stays in the evidence trail rather than being deleted.

### OQ2 — The approval route authenticates no caller

**Resolved by D8**: phase 1 gates the route with an operator credential, and phase 2 moves the owner key into the browser. The problem statement below is kept as the record of why.

`POST /v1/agents/:id/payments/:requestId/approve` executes under the owner key for anyone who can reach the API, and the API authenticates no route. The cap on the agent's signer therefore bounds the agent *key*, not the *caller*: deny, then approve, and the payment executes up to the owner ceiling (`OWNER_LIMIT_UNITS` in `scripts/provision-signers.ts`, 1000 USDC) with no person in the loop. D5's third consequence is true of the mechanism and false of the authorization. Nothing distinguishes the organization approving from anyone approving.

Options:

1. Gate the approve route behind an operator credential that nothing on the agent's path holds.
2. Take the owner signature off the server: the owner signs in the browser with a client-side key. This is close to the reverted "Sign organization writes with the operator's wallet" (#3).
3. Keep the route as it is and say on screen that approval is server-held and ungated. That is the simulated approval `docs/08` forbids, one indirection removed, so it is not really an option. It is listed to rule it out.

Until one of the first two lands, the escalation demonstrates *distinct signer authority*, not *organizational approval*, and the console copy and README must claim only the former. Gate C gains an assertion that an approve request without the operator credential is refused.

### OQ3 — The policy has no owner, so the app secret can move the cap

`createTokenPolicy` sets no `owner_id` on the policy. Gate C assertion 5 raised and restored the limit with app credentials alone, and it passed. The API process holds `PRIVY_APP_SECRET` beside the agent's key, so the agent's own runtime can raise its cap by patching the *policy* without touching the *wallet*. Assertion 11 proves only the signer-configuration half of D5's second consequence ("the agent cannot alter its own constraints").

Unverified: whether Privy policies accept an `owner_id` and then require the owner's signature to update. If they do, create the policy owned by the organization quorum, move `updatePolicyLimit` onto the owner client (Gate C assertion 5 included), and add assertions that a policy update signed by the agent key, or carrying app credentials only, is refused. If they do not, narrow D5's second consequence in the proposal to what is true: the agent key cannot reconfigure its signer, and whoever holds the app secret can still move the limit.

### OQ4 — Which policy Privy applies when the owner signs

`scripts/provision-signers.ts` names the owner quorum as `owner_id` *and* lists it as an additional signer carrying `PRIVY_OWNER_POLICY_ID`. It leaves the wallet-level `policy_ids` in place, and those still hold the agent's cap. D5 assumes Privy evaluates only the acting signer's override policy. Nothing read so far says whether an owner-signed request matches the owner's additional-signer entry or falls through to the wallet-level `policy_ids`.

If it falls through, the owner is capped at the agent's limit and assertion 12 fails. The gate reports that correctly, but the likely reading would be "Privy broke" rather than "the configuration assumed a semantic".

Resolve live, after `provision:signers`, before trusting assertion 12's result either way. One candidate is clearing the wallet-level `policy_ids` in the same `setWalletSigners` call, so that every request is governed by exactly one signer's override policy. It has an inverse risk: if the owner's additional-signer entry does *not* match owner-signed requests, the owner becomes uncapped instead of over-capped. Choose it only after the live read shows which entry applies.
