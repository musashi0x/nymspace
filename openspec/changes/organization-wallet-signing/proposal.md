## Why

Every write in the product is signed by a private key the server holds. `buildDeps` loads `ENSV2_ORGANIZATION_PRIVATE_KEY` and `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY`, and `authorizeTextRole` signs `as: "organization"`. For the agent's own writes that is the design and should stay: the product's claim is that an agent acts unattended, and a controller key on the server is what makes the demo run without a human at the keyboard.

For the organization's writes it is the wrong shape, for three reasons.

The organization is a person. Granting and revoking an agent's authority is the human decision the product exists to demonstrate, and it currently happens because a key sitting in a `.env` file signed it. A judge cannot tell the difference between an organization that authorised a revocation and a server that did it on their behalf, because there is no difference.

It also blocks everyone but the key holder. Until this change's sibling split, a missing key broke every read route; now reads work, but no one can exercise a single organization action without being handed a funded signer. That is the whole team, CI, and anyone evaluating the submission.

And it contradicts the security position the repository already states. `docs/12_SECURITY_MODEL.md` and the prize strategy both say to keep the organization signing path out of routine agent execution and expose only narrowly scoped write operations. One process holding both keys is the opposite: a compromise of the server is a compromise of the organization.

## What Changes

- Add an `organization-signing` capability: organization-authority writes are prepared unsigned by the API and signed in the browser by the operator's wallet. The agent controller's writes are unchanged and remain server-signed.
- Add `POST /v1/agents/:id/permissions/prepare`, returning the unsigned transaction — `to`, `data`, `chainId` — for a grant or revoke, with no signer involved. The existing server-signed `POST /v1/agents/:id/permissions` stays for the unattended path and for environments that do configure an organization key.
- Add a browser wallet surface to `apps/web`: connect, report the connected account, require Sepolia, send a prepared transaction, and wait for its receipt.
- Show whether the connected account is actually the organization. A wallet connected as the wrong account must be told so before it signs, not after the contract refuses.
- Record which signer performed a write in the activity log, so "the organization revoked this" and "the server revoked this on a key it holds" are distinguishable after the fact.

No new dependency. `viem` is already in the workspace and EIP-1193 is the interface every injected wallet exposes, so a connector library, its React bindings and a query cache would be three dependencies bought for an interface we can call directly. The Astryx design rule requires asking before adding a primitive; this change adds none.

## Capabilities

### New Capabilities

- `organization-signing`: which authority signs which write, how an unsigned organization transaction is prepared and returned, what the browser must verify before signing, and how the two paths coexist so the unattended agent demo keeps working.

### Modified Capabilities

- `ensv2-authority`: the requirement that organization-authority operations are performed by the configured organization key gains the alternative that they may be signed by a connected wallet proving control of the organization account. The authority model itself does not change — the contract still checks `hasRoles` against the same address, and nothing about EAC is relaxed. What changes is who holds the key that produces the signature.

## Non-Goals

- Replacing the controller's server-held key. The unattended agent write is the product claim; moving it into a browser wallet would require a human click for something the product says needs none.
- WalletConnect, mobile deep links, or hardware wallets. An injected EIP-1193 provider covers the demo and the judging path.
- Account abstraction, session keys, or gasless flows.
- Changing any read path. Reads take addresses, not signers, and already work without a key.
