## 1. Prepare organization writes without a signer

- [x] 1.1 Add `EnsService.prepareAuthorizeTextRole`, encoding the same call `authorizeTextRole` makes and returning `{ to, data, chainId }`. It must build its arguments through the same path, so the signed and prepared forms cannot encode different transactions
- [x] 1.2 Add `POST /v1/agents/:id/permissions/prepare`, returning the transaction, the `expectedSigner`, and the intent it represents. No signer is consulted, so it answers with no organization key configured
- [x] 1.3 Confirm it 404s for an unknown agent rather than 500ing

## 2. The browser wallet

- [x] 2.1 Add `lib/wallet.ts` over EIP-1193 through viem — no connector library. Connect, read the account and chain, switch chains, send a prepared transaction
- [x] 2.2 Handle EIP-1193 4001 and MetaMask's `ACTION_REJECTED` as a normal rejection rather than an error to log
- [x] 2.3 Handle 4902 by offering `wallet_addEthereumChain`, so an operator whose wallet does not know Sepolia is not told to configure a network by hand
- [x] 2.4 Re-check the connected account inside `sendPrepared` against `expectedSigner`. The account can change in the wallet between render and click, and a mismatch costs gas to learn from a revert what a string comparison answers for free
- [x] 2.5 Subscribe to `accountsChanged` and `chainChanged` so the header does not go stale

## 3. Surface it in the console

- [x] 3.1 Add `OrganizationWallet` to the console header: connect, show the account, and say whether it is the organization
- [x] 3.2 Expose `NEXT_PUBLIC_ORGANIZATION_ADDRESS` through `publicEnv` so the browser can make that comparison. Public address, never a key
- [x] 3.3 Render nothing until the provider has been probed, so the UI does not flash "no wallet" at someone who has one
- [x] 3.4 Declare the variable in `.env.example` and `turbo.json` so `pnpm env:check` stays green

## 4. Wiring

- [x] 4.1 Route the Inspector's grant/revoke controls through the prepare path when a wallet is connected, falling back to the server-signed route when it is not. The plumbing exists; the buttons are not wired to it yet
- [x] 4.2 Return 503 from the server-signed `POST /:id/permissions` when no organization key is configured, naming the prepare route. It currently surfaces `NoSignerError` as a 500
- [x] 4.3 Record the signing account and wallet-vs-server on the activity event, so the log cannot later be read as though the server acted. Requirement "The signer is recorded" is unmet until this lands
- [x] 4.1b `describeDenial` rethrows `NoSignerError` instead of describing it. It was reporting a missing key as `source: "ensv2"` with a contract address — an infrastructure failure presented as a permission verdict, which is the exact shape this codebase is supposed to never produce

## 5. Still open

- [x] 5.0 Simulate the prepared transaction before asking anyone to sign it. `pnpm --filter @nymspace/ens verify:prepared` runs `eth_call` from the organization and from an outsider, and writes `packages/ens/evidence/prepared-tx.json`. It asserts **both** outcomes — success from the organization, `EACCannotGrantRoles` from anyone else — because a check that can only pass is not evidence. Verified falsifiable by pointing the outsider at the organization: exit 1
- [ ] 5.1 Exercise the whole path against Sepolia with a real wallet: connect, grant, watch the permission matrix flip, revoke. Cannot be done from this machine — it needs the organization account in a wallet. 5.0 narrows what is unproven to the browser leg alone: the calldata is known-good and the authority gate is known to be enforced on chain, so what remains untested is MetaMask, the confirm route, and the receipt path — not whether the transaction is correct
- [ ] 5.2 Decide whether the controller's server-held key stays. This change assumes it does, because the unattended agent write is the product's claim
