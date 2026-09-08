## Why

`docs/` specifies a complete five-day build (ENSv2 + The Graph + Privy), but the entire plan rests on one unproven assumption: that the organization can delegate a single ENS text record to an agent controller and have that delegation be readable from chain. Nothing in the repo has ever touched ENSv2 on Sepolia. `docs/14_EXECUTION_PLAN.md` makes Day 1 a hard go/no-go gate on exactly this, and `docs/17_RISKS_AND_FALLBACKS.md` Risk 1 states there is no fallback — if ENSv2 does not work, ENSv2 must be solved.

Reading the live ENSv2 documentation surfaced two facts the docs do not capture, both of which can burn Day 1:

1. A parent namespace is not a config value. Before any subname can resolve, the parent name needs a subregistry: deploy a UserRegistry proxy via the Verifiable Factory, then `setSubregistry()` on the parent registry. The `roleBitmap` passed to `initialize()` is effectively one-shot — omitting `ROLE_REGISTRAR_ADMIN` / `ROLE_RENEW_ADMIN` means redeploying.
2. The registry and the resolver are two separate EAC domains, on two contracts, with two resource schemes. `docs/05_ENSV2_IMPLEMENTATION.md` treats "permissions" as one concept. Registry `roleBitmap` at registration grants registry roles; it is not established that it confers the resolver-side `ROLE_SET_TEXT_ADMIN` the organization needs in order to authorize the agent controller at all.

This change resolves those unknowns with an executable spike before any product code, UI, Graph, or Privy work begins.

## What Changes

- Add a standalone spike script that runs end to end against ENSv2 Sepolia and prints transaction hashes plus a pass/fail line per assertion.
- Establish the parent namespace prerequisite chain (own name → UserRegistry proxy → `setSubregistry`) and record the resulting addresses as configuration.
- Prove record-level delegation: grant an agent controller `ROLE_SET_TEXT` scoped to a single text key via `authorizeTextRoles`, have that controller write the key, and read the value back.
- Prove the negative cases: the same controller cannot write a different text key and cannot change the resolver.
- Establish the chain-read path for permission state (`roles(resource, account)` with the resolver's `keccak256(node, partHash(key))` resource derivation) so UI permission badges can be contract-derived later.
- Extend `.env.example` with the ENSv2 variables the spike actually needs, including the organization and agent controller keys that `docs/19_ENV_AND_CONFIG.md` omits.
- Record every answered unknown, with its evidence, so the Day 2+ build inherits verified ground rather than assumptions.

No product UI, no Graph integration, no Privy integration. Those stay blocked until this spike passes.

## Capabilities

### New Capabilities

- `ensv2-authority`: the organization's ability to own a namespace on ENSv2 Sepolia, register agent subnames under it, delegate individual text records to a separate controller address, deny everything not delegated, and read all of that permission state back from chain rather than from local state.

### Modified Capabilities

None. `openspec/specs/` is empty; this is the first capability in the project.

## Impact

- **Depends on**: the `scaffold-monorepo` change, which lands first and creates the pnpm workspace, `turbo.json`, `.env.example`, `tsx`, and the domain packages. Everything below is placed inside that layout.
- **New**: `packages/ens/scripts/spike-ensv2.ts`, ENSv2 chain configuration and pinned ABIs inside `@nymspace/ens`, ENSv2 entries appended to `.env.example`.
- **New dependencies**: `viem`, added to `@nymspace/ens`. The repo currently has zero web3 dependencies.
- **Configuration**: Sepolia RPC, ENSv2 deployment addresses, parent name label, organization key, agent controller key. Key custody for the agent controller is undecided and is called out as an open question in `design.md`.
- **Blocked until this passes**: everything in `docs/14_EXECUTION_PLAN.md` Day 2 onward. Graph, Privy, and all five UI screens depend on an agent subname existing with a live, readable permission state.
- **Onchain**: the spike deploys a UserRegistry proxy and registers at least one throwaway subname on Sepolia. It is not idempotent by default; re-runs must either reuse or unregister prior state.
- **Not affected**: the existing landing page (`app/page.tsx`, `components/`). It shares no code with this work.
