## 1. Setup

Depends on the `scaffold-monorepo` change, which has landed. The workspace, `turbo.json`, `.env.example`, `tsx`, and the four domain packages all exist, so this section extends them rather than creating them.

What the scaffold already left in `@nymspace/ens`, and what remains for the spike:

| Already there | State | What the spike does |
| --- | --- | --- |
| `src/chain.ts` | Reads validated addresses from `@nymspace/core`'s `serverEnv` | Extend with any address section 2 adds |
| `src/abis.ts` | Hand-written from `docs/05_ENSV2_IMPLEMENTATION.md`, unverified | Replace from deployment artifacts — task 1.4 |
| `src/eac.ts` | Role bitmap helpers, plus a `ResourceDeriver` port left unimplemented | Implement the deriver against the deployed helper |
| `src/ens-service.ts` | `EnsService` over a structural `ChainClient` port | Supply the viem-backed client — task 1.1 |
| `src/keys.ts` | ENSIP 25 and 26 key construction, DNS wire encoding | Confirm the ENSIP 25 registry form against the resolver |

The scaffold deliberately implemented no contract call it could not verify. Every shape above marked unverified is a shape the spike settles on Sepolia.

- [x] 1.1 Add `viem` to `@nymspace/ens`. The repository has no web3 dependency at all yet
- [x] 1.2 Add the two keys the spike needs — organization and agent controller — to `.env.example`. The ENSv2 block from `docs/19_ENV_AND_CONFIG.md` is already there; `docs/19` lists neither key. Declare both in `turbo.json` in the same edit, or `pnpm env:check` fails
- [x] 1.3 Extend `packages/ens/src/chain.ts` with any address section 2 introduces. It already reads validated values from `@nymspace/core`'s `serverEnv`, so a missing variable fails on load rather than mid-transaction
- [x] 1.4 Replace the placeholder fragments in `packages/ens/src/abis.ts` with real ABIs (`.eth` registry, PermissionedRegistry, PermissionedResolver, VerifiableFactory, ETHRegistrar), sourced from the deployment artifacts. What the scaffold left is hand-written from the docs and is explicitly marked unverified
- [x] 1.4a Reconcile the addresses in section 2 against the canonical ENS Deployments page before sending any transaction, and record which source won. The `namechain` repository carries three Sepolia-ish deployment sets and the docs treat the Deployments page as authoritative
- [ ] 1.5 Fund both the organization and controller addresses with Sepolia ETH, and confirm balances before writing any code that spends
- [ ] 1.6 Create `packages/ens/scripts/spike-ensv2.ts`, runnable as `pnpm --filter @nymspace/ens spike`, with an assertion helper that prints one pass/fail line per check and records every transaction hash. It imports `EnsService` from the package it sits in, so the spike and the route handlers share one implementation. Declare it as `tsx --conditions=react-server ...`; `pnpm conditions:check` fails the moment the script exists without the flag, and without it the spike dies at import on `server-only` with a message about Client Components
- [x] 1.7 Implement the `ResourceDeriver` port in `packages/ens/src/eac.ts` against the deployed contract helper. The scaffold left it injected rather than guessed, because a wrong derivation returns `false` from every role check with nothing in the logs to explain it

## 2. Namespace prerequisites (U1–U3)

**Task 1.4a is resolved, and every address this section originally listed was stale.**

The `ensdomains/namechain` addresses above were superseded twice. The canonical
source is `ensdomains/contracts-v2` at commit
`97a57293f3b4279d94b571e678edb53ce62638f4` — the commit `ensdomains/docs` itself
pins in `scripts/ensv2-deployments.ts` to build the ENSv2 Deployments page, which
`docs/20_SOURCES.md` treats as authoritative. `namechain` carries two Sepolia
sets (`sepolia-official-v1-20260525-r2` and `sepolia`) and *every* address in
both differs from the canonical set. Do not mix them.

Live addresses (`contracts/docs/addresses/sepolia.md`, deployed 2026-07-30, each
confirmed non-empty with `eth_getCode` on Sepolia). They live in `.env.example`,
not in source:

```
VerifiableFactory          0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef
RootRegistry               0x8115186e8f2e0b0281e86ab91f0f48ba90364354
ETHRegistry                0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2
ETHRegistrar               0xa88553f454b77203b0d036a05c894d555eaaa2cc
UserRegistryImpl           0x624a25d67b59d587752ebec8dded8827dae52050
PermissionedResolverImpl   0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e
UniversalResolverV2        0x4a1817d13e9cf196f471725176355c1234b63c70
StandardRentPriceOracle    0x8914b66260eb8c4fff795650c3ae8cd335958987
MockUSDC (payment token)   0x768f42455a2d082e23ceef7d51e5787c82d67a39
MockDAI  (payment token)   0x5472c5725a00b7ba11f0794a79d08ade6f4683bd
```

Three ABI shapes this section assumed are also wrong against the deployed
contracts, and the tasks below are corrected accordingly:

- `hasRoles(uint256 resource, ...)` and `roles(uint256 resource, ...)` — the
  resource is a `uint256`, not a `bytes32`.
- `getSubregistry(string label)` and `getResolver(string label)` take the label
  string, not a labelhash.
- `setSubregistry(uint256 tokenId, address)` and `setResolver(uint256 tokenId,
  address)` take a token id, from `findTokenId(label)`. Token ids change when
  roles change, so read it immediately before use.

- [ ] 2.1 **U1** Decide the parent label, then choose how to obtain it. Acquiring a fresh name is not a lookup: `ETHRegistrar` is commit-reveal, so `commit(bytes32)` must land, then age past `MIN_COMMITMENT_AGE` and be consumed before `MAX_COMMITMENT_AGE`. Read both immutables from the contract and plan around the wait
- [ ] 2.1a **U1** Registration is priced in an ERC 20, not ETH: `getRegisterPrice(label, duration, paymentToken)` returns `(base, premium)` — two values, not one. The accepted tokens are resolved: MockUSDC and MockDAI ship in the same deployment and both expose `mint(address,uint256)`, so they are the faucet. Mint, then `approve` the registrar for `base + premium` before the reveal
- [ ] 2.1b **U1** Evaluate the migration path first. `LockedMigrationController`, `UnlockedMigrationController`, and `MigrationHelper` exist in the same deployment, so an ENSv1 Sepolia name already held may be migrated instead of purchased. This is the concrete answer to Risk 2 in `docs/17_RISKS_AND_FALLBACKS.md`, which only says the two are not the same thing
- [ ] 2.1c **U1** Confirm ownership of the chosen parent label on the ENSv2 `.eth` registry, or on explorer.ens.dev. Blocks everything below
- [ ] 2.2 **U2** Read `getSubregistry(parentLabel)` on the `.eth` registry — the label string, not a labelhash. If non-zero, skip 2.3–2.5 and record the existing UserRegistry address
- [ ] 2.3 **U3** Use `deployProxy(address implementation, uint256 salt, bytes data)` on the VerifiableFactory with `UserRegistryImpl` as the implementation. The address arrives in the `ProxyDeployed(sender, proxyAddress, salt, implementation)` event. The init data encodes `initialize(address rootAccount, uint256 roleBitmap)` — **two** parameters. Do not reuse the resolver's three-parameter `initialize(admin, roleBitmap, bytes[] setters)` shape from task 4.1; they are different contracts with different signatures
- [ ] 2.4 **U3** Compose the UserRegistry `initialize()` role bitmap as a reviewed constant with a per-bit justification comment. It MUST include `ROLE_REGISTRAR_ADMIN` and `ROLE_RENEW_ADMIN` so roles can be granted later, and — because an admin role confers only grant and revoke authority, never the action itself — it MUST also include `ROLE_REGISTRAR` for the organization to call `register()` directly under D1. From `RegistryRolesLib.sol`: `ROLE_REGISTRAR = 1 << 0`, `ROLE_RENEW = 1 << 16`, `ROLE_SET_SUBREGISTRY = 1 << 20`, `ROLE_SET_RESOLVER = 1 << 24`, `ROLE_SET_PARENT = 1 << 8`, each admin at `role << 128`. A wrong bitmap costs a redeploy
- [ ] 2.5 **U3** Deploy the UserRegistry proxy via the VerifiableFactory and capture the address from the `ProxyDeployed` event
- [ ] 2.6 Call `setSubregistry(findTokenId(parentLabel), userRegistryAddress)` on the `.eth` registry and confirm `getSubregistry(parentLabel)` now returns it. The first argument is a token id, not a labelhash, and it changes whenever roles change — read it immediately before the call
- [ ] 2.7 Record the resulting addresses into local env and `.env.example` as documented outputs, not as blanks to guess

## 3. Subname registration (U6)

- [ ] 3.1 **U6 — resolved from source.** `_register` performs `_checkRoles(ROOT_RESOURCE, ROLE_REGISTRAR, msg.sender)`, and `hasRoles` ORs root roles in, so the organization can call `register()` directly provided task 2.4's bitmap carried the `ROLE_REGISTRAR` base bit. Confirm with `hasRoles(ROOT_RESOURCE, ROLE_REGISTRAR, organization)` on the UserRegistry before the first attempt
- [ ] 3.2 Call `register(label, owner, registry, resolver, roleBitmap, expiry)` directly. No registrar contract and no payment token are involved for subnames. `expiry` must be in the future or the call reverts with `CannotSetPastExpiry`
- [ ] 3.2a Choose `register()`'s `roleBitmap` deliberately. It grants roles to the **owner** on the **registry** resource `_constructResource(tokenId, entry)`, which is a registry-domain resource and touches nothing on the resolver. The agent controller receives no registry roles here, which is what makes the `setResolver` denial in 6.5 hold by construction
- [ ] 3.3 Register one throwaway agent label (timestamp-suffixed, not `research`) and confirm the owner is the organization
- [ ] 3.4 Register against the organization's own resolver from section 4, not a third-party one. Registry roles carry no resolver authority, so the resolver choice made here decides whether delegation is possible at all
- [ ] 3.5 Confirm the subname resolves through the Universal Resolver, proving the subregistry wiring from section 2 actually took effect

## 4. Resolver deployment and grant authority (U4, U5)

U4 is a deployment decision, not a discovery. `PermissionedResolver.sol` requires the caller of `authorizeTextRoles` to hold `ROLE_SET_TEXT_ADMIN` on `resource(namehash, 0)`, and the contract has no `_getRoles` override: registry ownership grants no resolver authority whatsoever. Whoever initializes a resolver holds `ROOT_RESOURCE` roles, and an EAC role at root covers every resource beneath it. So the organization must own the resolver its names point at.

- [ ] 4.1 Deploy a PermissionedResolver proxy through the Verifiable Factory using `PermissionedResolverImpl` as the implementation. Init data is `initialize(address admin, uint256 roleBitmap, bytes[] setters)` with the organization as admin and the documented `ALL_ROLES` bitmap `0x1111111111111111111111111111111111111111111111111111111111111111`, which carries every regular bit and every admin bit. The documented salt scheme is `keccak256(abi.encode(keccak256("OwnedResolver"), owner, version))`, which makes the resolver address predictable before deployment
- [ ] 4.2 Point the agent subname at that resolver. Either pass it as the `resolver` argument to `register()`, or call `setResolver` on the UserRegistry afterwards
- [ ] 4.3 **U5** Read the resolver address for the parent name and the agent subname and record whether they share one proxy. Grants are keyed by `resource(namehash, part)`, so one shared resolver serves every agent, and `toName` distinguishes them
- [ ] 4.4 **U4** Verify before delegating with `hasRoles(resource(namehash(agentName), 0), ROLE_SET_TEXT_ADMIN, organization)`, where `ROLE_SET_TEXT_ADMIN` is `(1 << 4) << 128`. Confirmed in `EnhancedAccessControl.sol`: `hasRoles` evaluates `_effectiveRoles = _getRoles(ROOT_RESOURCE, account) | _getRoles(resource, account)`, so a root-scoped grant satisfies it. Do **not** use `roles()` here; it returns `_roles[resource][account]` verbatim and reports zero for an organization holding everything at root
- [ ] 4.5 If 4.4 fails, do not proceed to section 5. The organization does not control the resolver and cannot delegate anything on it
- [ ] 4.6 Record the resolver address and the verified admin result in the spike output

## 5. Record-level delegation (U7)

- [x] 5.1 DNS-encode the agent subname for the `toName` parameter and unit-test the encoder against a known vector
- [ ] 5.2 Call `authorizeTextRoles(dnsName, "agent-endpoint[mcp]", controller, true)` from the organization and confirm success
- [x] 5.3 **U7 — resolved from source.** `PermissionedResolverLib.resource` stores `node` at offset 0 and `part` at offset 32 and hashes 64 bytes, documented in-source as `uint256(keccak256(abi.encode(node, part)))`. For two `bytes32` values packed and non-packed encoding are identical, so either viem helper is correct. Implement it with `partHash(key) = keccak256(bytes(key))` and note that `resource(0, 0)` is `ROOT_RESOURCE`
- [ ] 5.4 **U7** Positive control: assert `hasRoles(derivedResource, ROLE_SET_TEXT, controller)` is true for the key just granted. A false here means the derivation is wrong, not that permission is missing
- [x] 5.4a Build the permission predicate to mirror `onlyPartRoles`: true when `hasRoles` holds on `resource(node, part)`, on `resource(0, part)`, or on `resource(node, 0)`. Anything narrower will display a name-level grant as "denied" while the transaction succeeds
- [ ] 5.4b The organization needs `ROLE_SET_TEXT` **as well as** `ROLE_SET_TEXT_ADMIN` to write records itself. `withAdminRolesApplied` appears only in `_getSettableRoles` and `_getRevokableRoles`, so an admin role confers grant and revoke authority, not the ability to perform the action. Initializing the resolver with the documented `ALL_ROLES` bitmap (`0x1111...1111`, every regular bit and every admin bit) covers both; a bitmap of admin bits alone would let the organization delegate the ENSIP 25 key but never write it
- [ ] 5.5 Assert the controller does NOT hold `ROLE_SET_TEXT` at name scope, proving the grant is record-scoped per ADR 002
- [ ] 5.6 Confirm the `authorize*` path is used throughout and no call site attempts `grantRoles()`, which is disabled on the resolver
- [ ] 5.7 Guard against the wildcard resource. `onlyPartRoles` accepts a grant on `resource(0, part)` as an alternative to the name-scoped one, which authorizes that key on **every** name in the resolver. Assert no account holds roles at `resource(0, partHash(key))` for any delegated key, and never construct that resource in a grant path
- [ ] 5.8 Build the permission matrix from the `NamedTextResource(resource, name, keccak256(key), key)` event, emitted on the first grant for a key. It carries the human-readable key, so the UI can enumerate which records actually carry delegations instead of iterating a hardcoded key list

## 6. Proofs

- [ ] 6.1 From the controller key, call `setText(node, "agent-endpoint[mcp]", url)` and assert success
- [ ] 6.2 Read the record back and assert the value equals what the controller wrote
- [ ] 6.3 Negative: from the controller, attempt `setText` on an undelegated text key and assert revert
- [ ] 6.4 Negative: from the controller, attempt `setText` on the ENSIP 25 key built in section 8 and assert revert. This is Option A in `docs/05_ENSV2_IMPLEMENTATION.md`, the proof that identity-binding authority is separate from endpoint authority
- [ ] 6.5 Negative: from the controller, attempt `setResolver` on the subname and assert revert, proving the boundary holds in the registry domain as well as the resolver domain
- [ ] 6.6 Stretch: organization revokes with `authorizeTextRoles(..., controller, false)`, controller retries the write, assert revert. This is the emergency-revocation story from `docs/05`

## 7. Evidence and gate decision

- [ ] 7.1 Print the three-line Day 1 deliverable from `docs/14_EXECUTION_PLAN.md`: MCP write success, protected write denied, resolver change denied
- [ ] 7.2 Emit a JSON evidence file with every transaction hash, resolved address, and assertion result
- [ ] 7.3 Re-run the spike's read path in a fresh process and confirm identical permission state, proving nothing depends on in-memory state
- [ ] 7.4 Decide and record idempotency: timestamped labels or unregister-first. Do this before the second run, not during it
- [ ] 7.5 Write the answers to U1–U8 back into `docs/05_ENSV2_IMPLEMENTATION.md`, replacing its "Conceptual TypeScript" sections with verified calls
- [ ] 7.6 Confirm no key material or RPC credential is committed

## 8. ENSIP 25 key construction (U8)

U8 is resolved by specification, not deferred. ENSIP 25 defines the key as `agent-registration[<registry>][<agentId>]`, where `<registry>` is an ERC 7930 interoperable address as a `0x`-prefixed hex string and `<agentId>` is a registry-defined string that must not contain `[` or `]`. The record value must be non-empty and should be `"1"`. The remaining work is a converter and a set of canonicalization rules, because every failure mode here is a silent empty read that looks identical to "not verified".

- [x] 8.1 Implement an ERC 7930 v1 encoder: `Version(0x0001) ‖ ChainType(0x0000 for eip155) ‖ ChainReferenceLength(1 byte) ‖ ChainReference ‖ AddressLength(0x14) ‖ Address`
- [x] 8.2 Encode `ChainReference` as **minimal** big-endian bytes, not zero-padded. Chain 1 is `0x01` (length 1); Sepolia 11155111 is `0xaa36a7` (length 3). Zero-padding produces a valid-looking, wrong key
- [x] 8.3 Lowercase the registry address in the encoded output. viem's `getAddress()` returns an EIP-55 checksummed string; interpolating it yields a key that resolves to empty
- [x] 8.4 Unit-test the encoder against the ENSIP 25 worked example: registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` on chain 1 must encode to `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432`
- [x] 8.5 Use the resolved Ethereum Sepolia registry component, verified against `agent0lab/subgraph` `config/networks/eth-sepolia.json`:

  ```
  IdentityRegistry    0x8004A818BFB912233c491871b3d84c89A494BD9e  (startBlock 9980000)
  ReputationRegistry  0x8004B663056A597Dffe9eCcC1965A193B7388713  (startBlock 10107135)
  ValidationRegistry  not deployed on Sepolia

  ERC 7930 registry component for the identity registry:
  0x0001000003aa36a7148004a818bfb912233c491871b3d84c89a494bd9e
  ```

- [ ] 8.5a Before writing any ENSIP 25 record against it, call `getCode` on `0x8004A818BFB912233c491871b3d84c89A494BD9e` on Sepolia and assert non-empty. These addresses were read from a repository, not from chain
- [x] 8.5b Note that Base Sepolia (84532) uses the identical registry addresses, so the ADR 009 cross-chain stretch changes only the chain reference, from `03aa36a7` to `03014a34`. Encode and unit-test both
- [x] 8.6 Bridge the identifier gap between the discovery source and the verification key. Agent0 returns `Agent.id` as `chainId:agentId` (e.g. `11155111:7`) plus separate `chainId` and `agentId` fields; it does not return the registry address at all. ERC 8004 names a registry as `{namespace}:{chainId}:{identityRegistry}`. ENSIP 25 needs ERC 7930 hex. So the converter maps `chainId` to a configured registry address, then encodes. Keep the chainId-to-registry table in configuration, since it is the trusted input the subgraph never supplies
- [x] 8.7 Canonicalize `agentId` as a minimal decimal string with no leading zeros and no `0x` prefix. `167` and `0167` hash to different resource ids
- [x] 8.8 Assert the constructed key contains no whitespace. The rendered ENSIP 25 page displays the example as `[ 0x... ][ 167 ]`; those spaces are an HTML artifact and would corrupt a copy-pasted key
- [ ] 8.9 Write the key from the organization key only, with value `"1"`, and confirm the agent controller was never granted this key. Protection is by construction: grants are per-record resources, so ADR 003 needs no additional enforcement
- [x] 8.10 Implement runtime verification in the registry-to-ENS direction: take the claimed ENS name, agentId, and registry from the registry entry, construct the key, resolve it, and treat any non-empty value as verified
- [x] 8.11 Negative test: verification against a wrong agentId, a checksummed registry address, and a zero-padded chain reference must each fail, proving the failure is the key and not the resolver

## 9. Handoff

- [ ] 9.1 Extract the spike's call sites into the `EnsService` interface from `docs/04_SYSTEM_ARCHITECTURE.md`, keeping ENSv2 churn behind one boundary
- [ ] 9.2 Resolve the agent controller key custody question from `design.md` (server-held key versus second browser wallet) and reconcile `docs/15_DEMO_SCRIPT.md` with the answer
- [ ] 9.3 Add the ENS-name-transfer staleness caveat to `docs/12_SECURITY_MODEL.md`, which does not currently mention it
- [ ] 9.4 Record in `docs/07_THE_GRAPH_INTEGRATION.md` and `docs/01_PRD.md` that no ValidationRegistry is deployed on Ethereum Sepolia or Base Sepolia, so validation is an optional ranking dimension on testnet and must never be rendered as a zero score
- [ ] 9.4a Add the emancipation point to `docs/15_DEMO_SCRIPT.md` per D7: the organization retains root roles on its own registry and can reclaim any agent subname, which is the product rather than an oversight. A judge familiar with ENSv2 will ask whether the registry is emancipated, and the answer should be deliberate
- [ ] 9.5 Fill the blank Graph variables in `docs/19_ENV_AND_CONFIG.md`: Ethereum Sepolia subgraph `6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT`, Base Sepolia subgraph `4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u`
- [ ] 9.6 Only after 7.1 passes, unblock Day 2 work: ENSIP 26 records, ERC 8004 registration, and The Graph
