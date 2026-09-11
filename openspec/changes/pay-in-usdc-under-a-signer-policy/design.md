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

## Open question

Whether `PATCH /v1/wallets/<id>` can set `owner_id` on a wallet that currently has none. If it cannot, the wallet is recreated and re-funded, and the old wallet stays in the evidence trail rather than being deleted.
