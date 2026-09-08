## Context

The repo has 4384 lines of specification in `docs/` and zero implementation. `package.json` contains no web3 dependency; the only shipped feature is a landing page. Day 1 of the five-day plan in `docs/14_EXECUTION_PLAN.md` is a hard gate: prove the ENSv2 permission model or stop and fix ENSv2.

`docs/05_ENSV2_IMPLEMENTATION.md` describes the intended flow but hedges at the load-bearing points, labelling its own code "Conceptual TypeScript" and its permission read "the current contract helper path". Checking the live ENSv2 documentation confirmed the central primitive and contradicted the surrounding assumptions.

**Confirmed by docs.ens.domains:**

- `authorizeTextRoles(toName, key, account, grant)` exists exactly as written in `docs/05`. First parameter is a DNS-encoded name (`bytes`).
- `ROLE_SET_TEXT = 1 << 4`. Each role has an admin counterpart at `role << 128`.
- Roles are readable on chain. The documentation implies `roles(resource, account)` returns an effective bitmap; the source shows otherwise, and D4 records the correction.
- Resolver resource for a specific text key is `resource(namehash, partHash(key))`, where `partHash(key) = keccak256(bytes(key))`.
- Up to 15 accounts may hold a given role on a given resource (nybble counter).

**Contradicted or missing from `docs/`:**

- `grantRoles()` and `revokeRoles()` are **disabled** on the Permissioned Resolver. Only the `authorize*` family works for name-level and record-level permissions. `docs/05` does not mention this.
- A parent name without a subregistry cannot host resolving subnames. Names registered into an unwired registry mint tokens but never resolve, because the Universal Resolver walks `getSubregistry()` down from the root. `docs/19_ENV_AND_CONFIG.md` presents `ENSV2_PARENT_REGISTRY_ADDRESS` as a blank to fill in; it is the output of a deploy.
- Obtaining the parent `.eth` name is a commit-reveal purchase, not a lookup. `ETHRegistrar` exposes `commit(bytes32)` gated by `MIN_COMMITMENT_AGE` and `MAX_COMMITMENT_AGE`, and `getRegisterPrice(label, duration, IERC20 paymentToken)` prices it in an ERC 20 rather than ETH. `docs/14_EXECUTION_PLAN.md` budgets this as a single bullet. The same deployment also ships migration controllers, so an ENSv1 Sepolia name may be migrated instead.
- An admin role confers grant and revoke authority only, never the action itself. `withAdminRolesApplied` appears solely in `_getSettableRoles` and `_getRevokableRoles`, so `ROLE_SET_TEXT_ADMIN` does not permit `setText` and `ROLE_REGISTRAR_ADMIN` does not permit `register`. Bitmaps must carry both halves.
- The `roleBitmap` passed to `initialize()` when deploying the UserRegistry proxy is effectively one-shot. Granting a role later via `grantRootRoles()` requires already holding that role's `_ADMIN` variant, so the initial bitmap must include at least `ROLE_REGISTRAR_ADMIN` and `ROLE_RENEW_ADMIN`.

The single most important structural finding is that the registry and the resolver are **separate EAC domains**:

```
PermissionedRegistry              PermissionedResolver
  labelhash-based resources         resource = keccak256(node, partHash(key))
  ROLE_REGISTRAR                    ROLE_SET_TEXT        (1 << 4)
  ROLE_SET_RESOLVER                 ROLE_SET_TEXT_ADMIN  (1 << 4) << 128
  ROLE_SET_SUBREGISTRY              grantRoles() DISABLED
  ROLE_UNREGISTER                   authorize* only
        |                                   |
        +--- register() roleBitmap --X------+
             grants REGISTRY roles.   NOTHING BRIDGES THESE.
             Resolver roles live      Resolver authority comes only
             on another contract.     from roles held on the resolver.
```

Confirmed by reading `ensdomains/namechain`, `contracts/src/resolver/PermissionedResolver.sol`. `authorizeTextRoles` calls `_checkCanGrantRoles(resource(node, 0), ROLE_SET_TEXT, msg.sender)`, and the contract's own documentation states the caller requires `ROLE_SET_TEXT_ADMIN` on `resource(<namehash>, 0)`. The file contains no `_getRoles` override; its only `_checkRoles` override exists to skip checks during initialization. Registry ownership therefore confers no resolver authority at all.

The consequence is that U4 is a deployment decision rather than a discovery. Whoever initializes a resolver holds `ROOT_RESOURCE` roles, and an EAC role at root covers every resource beneath it. An organization that deploys its own resolver proxy satisfies the admin requirement for every subname it will ever create. An organization whose names point at a resolver someone else initialized can never delegate on it.

## Goals / Non-Goals

**Goals:**

- Answer eight named unknowns (U1–U8) with chain evidence, not documentation reading.
- Produce a repeatable script whose output is a pass/fail line per assertion plus transaction hashes.
- Establish the exact resource-derivation used for permission reads, so UI badges can be contract-derived from the start.
- Leave behind pinned ABIs and chain configuration inside `@nymspace/ens`, and `.env.example` entries, that the product build consumes unchanged.
- Fail loudly and early. A no-go answer on Day 1 is a successful outcome of this change.

**Non-Goals:**

- Any UI. No screens, no components, no API routes.
- The Graph, ERC 8004 registration, and Privy. All are downstream and stay untouched.
- ENSIP 25 is partly in scope. The key construction, the ERC 7930 encoder, and runtime verification are included, because the key is a resolver resource and therefore part of the authority model. Minting an ERC 8004 identity and indexing it is not.
- The three named demo agents. The spike registers throwaway labels.
- Production key management. The spike uses testnet keys and says so.
- Gas optimisation, retry logic, indexer support, or anything resembling polish.

## Decisions

**D1: Direct `register()` on an owned UserRegistry, not a SimpleRegistrar.**
The ENS contract-developer tutorial routes registration through a registrar contract with ERC-20 `approve()` for pricing. That exists to sell names to third parties. The organization owns its own UserRegistry and can hold `ROLE_REGISTRAR` on `ROOT_RESOURCE` there, calling `register(label, owner, registry, resolver, roleBitmap, expiry)` directly. *Alternative considered:* deploy SimpleRegistrar and acquire the payment token. Rejected because it adds a contract, a token faucet dependency, and an approval step to a demo that sells nothing. U6 is now confirmed from source: `_register` checks `ROLE_REGISTRAR` on `ROOT_RESOURCE`, and root roles are ORed into every check, so the organization registers directly as long as task 2.4's bitmap carried the base bit.

**D2: Record-level grants only. Never name-level `ROLE_SET_TEXT`.**
`authorizeNameRoles(toName, ROLE_SET_TEXT, account, true)` would let the controller write *every* text key, including the ENSIP 25 verification record the security model protects. `authorizeTextRoles(toName, key, account, true)` scopes to one key. This is also the entire visual argument of the product, per `docs/21_ARCHITECTURE_DECISIONS.md` ADR 002. *Alternative considered:* name-level grant with an application-layer key filter. Rejected — moves the boundary out of the contract and into the UI, which is exactly what the product argues against.

**D3: Negative proofs come from absence of grant, not from an explicit deny.**
EAC has no deny list. The controller is granted one resource and holds nothing else, so an unrelated text key and any registry operation both revert by construction. Assert two: an unrelated text key (resolver domain) and `setResolver` (registry domain). Together they show the boundary holds across both contracts. Now that U8 is resolved, add the real ENSIP 25 key as a third denied write. It costs nothing: the key is a string, and the controller's attempt reverts whether or not an ERC 8004 registration exists yet. This is Option A in `docs/05_ENSV2_IMPLEMENTATION.md`, the strongest negative proof, because it separates operational endpoint authority from identity-binding authority in one transaction.

**D4: Compute the EAC resource in application code, and read authority with `hasRoles`, never `roles`.**
`EnhancedAccessControl.sol` draws a sharp line the ENS documentation does not: `roles(resource, account)` returns `_roles[resource][account]` verbatim, while `hasRoles(resource, bitmap, account)` evaluates `_getRoles(ROOT_RESOURCE, account) | _getRoles(resource, account)`, and `_checkRoles` — the enforcement path — uses `hasRoles`. An organization holding every role at `ROOT_RESOURCE` therefore reads as zero through `roles()` and as fully authorized through `hasRoles()`. A permission matrix built on `roles()` would show "denied" for actions that succeed. `roles()` is correct only when the question is what is stored at one resource, such as proving a grant is record-scoped rather than name-scoped.
Permission reads need the resource `keccak256(node, partHash(key))`. The exact byte packing of that hash (`abi.encodePacked` versus `abi.encode`) is not something to guess: a wrong derivation returns `0` silently and reads as "no permission", which would look identical to a genuine denial and could mislead the whole build. Derive it, then prove the derivation by reading back a grant known to exist. The packing question is settled from source: `PermissionedResolverLib.resource` hashes `node` and `part` as two adjacent 32-byte words, which packed and non-packed encoding produce identically, and `resource(0, 0)` is `ROOT_RESOURCE`. The positive control stays, because the remaining failure mode is passing a raw key string where `partHash(key)` belongs.

**D5: The organization deploys and owns its resolver.**
Because resolver authority flows only from resolver roles, the organization deploys a PermissionedResolver proxy via the Verifiable Factory and initializes itself with every role and admin counterpart on `ROOT_RESOURCE`. One proxy serves all agents; grants are keyed by `resource(namehash, part)`, so names do not collide. *Alternative considered:* point subnames at a shared or ENS-deployed resolver. Rejected because the organization would hold nothing there and could not call `authorizeTextRoles` at all, which is the product's entire mechanism.

**D6: Never grant on the wildcard resource.**
`onlyPartRoles` treats a grant on `resource(0, part)` as sufficient, meaning "this record key on any name in this resolver". With one shared resolver across all agents, a single accidental wildcard grant would let one agent's controller rewrite that key for every agent. Grants are constructed only as `resource(namehash, part)`, and the spike asserts the wildcard is empty. *Alternative considered:* one resolver per agent, which makes the wildcard harmless. Rejected as a deployment per agent for a demo with three of them.

**D7: The registry stays unemancipated, and the demo says so.**
Holding root roles on its own UserRegistry lets the organization `setResolver`, `setSubregistry`, or `unregister` any agent subname regardless of what `register()` granted the owner. ENSv2 names the opposite state emancipation, reached by revoking those roles on `ROOT_RESOURCE`. Nymspace is deliberately unemancipated: an organization that could not reclaim a compromised agent's identity would be a worse product, not a purer one. *Alternative considered:* emancipate the registry so agents are sovereign. Rejected as the opposite of the thesis in `docs/01_PRD.md`. State it in the demo rather than leaving it to be discovered, because a judge familiar with ENSv2 will check.

**D8: One `EnsService` boundary from the first line of code.**
`docs/17` Risk 1 requires ENS integration be isolated behind one service so beta interface churn has one blast radius. The spike is written as a thin caller over functions that will become that service, not as a flat procedural script. The `scaffold-monorepo` change makes this structural rather than aspirational: the spike lives inside `@nymspace/ens` and imports the same `EnsService` the route handlers will import, so the two cannot drift.

**D9: The spike is the acceptance test.**
`docs/13_TEST_PLAN.md` asks for ENS integration and negative tests. Rather than write the spike and then write tests, the spike's assertions are the tests. The pass/fail output is the Day 1 gate artifact.

## Risks / Trade-offs

- **Subnames point at a resolver the organization does not control** → Delegation becomes impossible, because `authorizeTextRoles` requires `ROLE_SET_TEXT_ADMIN` on the resolver and registry ownership grants none. Mitigation: D5, deploy the resolver first and initialize the organization with root roles. Task 4.4 still asserts the admin role before any grant, so a misconfigured resolver fails in a read rather than in a confusing revert.
- **One shared resolver across all agents widens the blast radius of a mistake** → A wildcard grant at `resource(0, part)` would apply that key to every agent. Mitigation: D6, plus the explicit assertion in task 5.7. The trade is deliberate: per-agent resolvers would remove the risk at the cost of a deployment per agent.
- **Wrong `roleBitmap` at UserRegistry `initialize()`** → Redeploy. Mitigation: treat the bitmap as a reviewed constant with a written justification per bit, not an inline literal. Include `ROLE_REGISTRAR_ADMIN` and `ROLE_RENEW_ADMIN`.
- **Silent-zero permission reads from a wrong resource derivation** → Would produce a UI that always shows "denied" and a team that debugs contracts instead of hashing. Mitigation: D4's positive-control read. Never trust a `false` that was not preceded by a `true` from the same code path.
- **ENSv2 is beta and interfaces may change before mainnet** (stated on the ENS overview page itself) → Mitigation: pin ABIs in-repo, re-verify addresses against ENS docs before submission per `docs/20_SOURCES.md`.
- **Spike is not idempotent** → A second run hits `NameAlreadyRegistered`. Mitigation: label suffixed with a timestamp, or unregister first. Decide before the second run, not during.
- **Acquiring the parent name eats Day 1 before the interesting work starts** → A commit-reveal purchase priced in an ERC 20 means a token faucet, an approval, two transactions, and a mandatory wait, any of which can stall. Mitigation: settle the parent before anything else, prefer migrating a name already held, and treat 2.1 as the first task of the day rather than a prerequisite assumed to be done.
- **Addresses taken from a repository rather than the canonical Deployments page** → The `namechain` repository carries three Sepolia-ish deployment sets, and picking the wrong one produces transactions against stale contracts. Mitigation: task 1.4a reconciles before the first write, and records which source won.
- **Sepolia RPC flakiness or faucet drought** → Two funded keys are needed (organization and controller). Mitigation: fund both before starting; a spike blocked on a faucet is a wasted Day 1.
- **Validation data does not exist on testnet** → `docs/01_PRD.md` scenario B ranks candidates on "feedback, validation", and `docs/07_THE_GRAPH_INTEGRATION.md` fetches validation state, but the Agent0 network configs list no ValidationRegistry for Ethereum Sepolia or Base Sepolia. Mitigation: treat validation as an optional dimension from the start, and never render an empty panel as though it were a zero score. A ranking that silently weights a missing dimension is the "invent reputation" failure `docs/04_SYSTEM_ARCHITECTURE.md` forbids.
- **Time.** This change consumes Day 1 and possibly part of Day 2 for a build with no product surface at its end. Accepted deliberately: `docs/14` already budgets Day 1 for exactly this, and every downstream day is worthless if U4 is false.

## Migration Plan

Not applicable. Nothing exists to migrate; the landing page shares no code with this work. Rollback is deleting the script and the dependency.

Sepolia state created by the spike (a UserRegistry proxy, one or more subnames) is disposable and carries no value.

## Open Questions

- **Agent controller key custody — resolved: server-held.** A second private key in `.env` (`ENSV2_AGENT_CONTROLLER_PRIVATE_KEY`), signed server-side, distinct from the organization key. It is scriptable, survives a restart, runs unattended in the spike and in CI, and matches the claim the product is making: the agent acts on its own, and the boundary holds because the contract refuses it rather than because a human declined to click. The rejected alternative was a second browser wallet, which is more convincing on stage but needs an account switch mid-demo under time pressure and cannot run headless. `docs/15_DEMO_SCRIPT.md` is reconciled: the demo shows the write happening with no human interaction, which is the stronger claim anyway. Production key management is explicitly out of scope; these are testnet keys and the repository says so.
- **Which parent label, and bought or migrated — resolved: `nymspace`, bought.** `nymspace.eth` is available and unowned on the ENSv2 Sepolia `.eth` registry, quoted by `getRegisterPrice` at 8.000021 MockUSDC for a year. Buying beats migrating: `MockUSDC` ships beside the registrar with an ungated `mint(address,uint256)`, so the ERC 20 price is not a real cost, and `MIN_COMMITMENT_AGE` is 60 seconds against a `MAX_COMMITMENT_AGE` of 86400. The whole acquisition is mint, approve, commit, wait 61 seconds, register. Migration through the controllers in the same deployment would first require an ENSv1 Sepolia name already held, and adds wrapper mechanics for no saving. `docs/17` Risk 2 still holds in spirit — nothing in the code hardcodes the label, which comes from `ENSV2_PARENT_LABEL`.
- **One resolver per name or one shared (U5) — no longer blocking.** Grants are keyed by `resource(namehash, part)`, so a single organization-owned proxy serves every agent and `toName` distinguishes them. The remaining choice is the trade in D6: one shared resolver with a wildcard assertion, or a proxy per agent. Task 4.3 records what the deployment actually produced.
- **ENSIP 25 key serialization (U8) — resolved by specification.** The key is `agent-registration[<registry>][<agentId>]`, with `<registry>` an ERC 7930 v1 interoperable address as a `0x`-prefixed lowercase hex string and `<agentId>` a registry-defined string containing no brackets. The value must be non-empty and should be `"1"`. The ENSIP publishes a worked example that the encoder is tested against. What remains is not a question but a converter, specified in tasks section 8. ERC 8004 names a registry as `{namespace}:{chainId}:{identityRegistry}` while ENSIP 25 requires ERC 7930 hex, and Agent0 supplies neither: it returns `Agent.id` as `chainId:agentId` and never exposes the registry address. The registry address is therefore a trusted local input keyed by chain id, not something read back from discovery. Every mis-encoding in this path fails as an empty text read, which is indistinguishable from an honest "not verified", so the negative tests in 8.11 matter more than usual.
- **ERC 8004 registry addresses on Sepolia — resolved.** From `agent0lab/subgraph` `config/networks/eth-sepolia.json`, corroborated by the repository's root `subgraph.yaml`: IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` (startBlock 9980000), ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713` (startBlock 10107135). Base Sepolia uses identical addresses. Read from a repository, not from chain, so task 8.5a confirms with `getCode` before any key is written. Agent0 subgraph IDs, also blank in `docs/19_ENV_AND_CONFIG.md`: Ethereum Sepolia `6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT`, Base Sepolia `4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u`.
- **How the demo handles absent validation data.** The ValidationRegistry is not deployed on either Sepolia network in the Agent0 config, so validation state will be empty for every testnet agent. Whether discovery ranking omits the dimension, shows it as unavailable, or the demo narrative drops it is a product decision, not a technical one.
- **Does the demo need `agent-context` and A2A on Day 1?** `docs/05` grants three keys. One key proves the model. Deferring the other two costs nothing and is reversible.
