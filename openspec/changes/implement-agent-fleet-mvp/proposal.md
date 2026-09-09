## Why

The Day 1 gate is passed. `ensv2-authority-spike` closed 72 of 72 tasks, `.env` carries a deployed `ENSV2_PARENT_REGISTRY_ADDRESS` and `ENSV2_PERMISSIONED_RESOLVER_ADDRESS` under the `nymspace` parent label, and both testnet keys are funded. `docs/14_EXECUTION_PLAN.md` task 9.6 says the same thing from the other side: only after the spike passes does Day 2 unblock. It has, and nothing downstream has started.

What exists is one proven mechanism and no product. `@nymspace/ens` is real — `EnsService`, EAC resource derivation, ENSIP 25/26 key construction, an ERC 7930 encoder, pinned ABIs. `@nymspace/graph` and `@nymspace/privy` are deliberately empty boundaries with comments saying the query surface and the SDK calls are settled on Day 2 and Day 3. `apps/api` serves `/health`, derived key strings, and GitHub commit activity. `apps/web` is a landing page. Every acceptance criterion in `docs/01_PRD.md` beyond the first three is unmet, and `GRAPH_API_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`, and `PRIVY_APP_SECRET` are all still empty — two of the three partner integrations cannot start until someone obtains credentials.

This change implements the remaining plan: Days 2 through 5 as one vertical slice, gated the way the execution plan gates them.

## What Changes

- **Identity standards.** Publish `agent-context` and `agent-endpoint[mcp]` (A2A and web optional) on three agent subnames under `nymspace.eth`. Register the research agent in the ERC 8004 IdentityRegistry on Sepolia, write the ENSIP 25 `agent-registration[<erc7930-registry>][<agentId>]` record from the organization key only, and verify it at runtime in the registry-to-ENS direction. The seven-state `Ensip25Status` from `docs/06` replaces any boolean verified flag.
- **Discovery over live Graph data.** Implement the Agent0 query surface against the live subgraph, normalise registration, feedback, and endpoint state, and expose `search_agent0` as a tool an LLM calls. Ranking explains itself from returned fields only. Validation is rendered unavailable, never zero — no ValidationRegistry is deployed on either Sepolia network.
- **One financial control.** Create a Privy wallet for the research agent, configure exactly one amount-based policy, execute one payment inside it and one outside it, and normalise the rejection into a typed `denied` result rather than an exception.
- **The console.** Five screens from `docs/03_UX_SPEC.md` — Fleet, Agent inspector, Discover, Task request, Policy denial — plus the activity timeline. The permission matrix is computed from `hasRoles` reads through the resolver's own fallback chain; no UI constant participates in an authority answer.
- **Product API.** The routes in `docs/10_API_CONTRACT.md` on `apps/api`, each returning normalised status plus evidence, with `fetchedAt` on every chain- or Graph-derived payload.
- **Coordination store.** A minimal persistence layer for agent slugs, ENS names, ERC 8004 ids, Privy wallet ids, and activity events — explicitly not the authority for identity, permissions, trust, or policy.
- **Hardening.** The restart test, the fresh-browser test, the six ENS integration tests, the four ENSIP 25 tests, and the acceptance gate's five repeatable proofs.

## Capabilities

### New Capabilities

- `agent-identity`: publishing an agent's standardised public identity on ENS and binding it to an ERC 8004 registration — ENSIP 26 records, the Agent Manifest as a read-through view rather than a stored object, the ENSIP 25 key construction, and runtime verification with a status model that distinguishes a missing registry claim from a missing ENS record from a mismatch.
- `agent-discovery`: finding and ranking agents from live Agent0 subgraph data — the query surface, normalisation of absent fields, an AI ranking step grounded only in returned values, provenance on every result, and the indexing-delay states that follow a fresh registration.
- `financial-authority`: constraining what an agent may spend through Privy — wallet provisioning, one enforceable policy, a payment inside the boundary, a payment outside it, and the separation between policy authority and signing authority.
- `agent-console`: the operator-facing web application — the five screens, the chain-derived permission matrix, the permission-proof interaction, the state machines from `docs/11`, and the error taxonomy that renders a denial as a product state rather than a failure.
- `coordination-store`: the application's own persistence — which entities it may hold, which values it must never treat as authoritative, and the unified activity event with per-source provenance.

### Modified Capabilities

- `api-server`: gains the product route contract from `docs/10_API_CONTRACT.md` — identity, permissions, records, verification, discovery, wallet, payments, activity — plus two requirements the existing spec does not state: every externally-derived response carries the time it was read, and no response may contain a Privy secret, an authorization key, or a server signing key.
- `ensv2-authority`: extends the spike's single throwaway subname to repeatable fleet provisioning — three named agents under one parent, each with its own record grants — and adds revocation through the product, since `docs/13_TEST_PLAN.md` E6 requires that a revoked grant make the next controller write revert.

## Impact

- **Depends on**: archiving `ensv2-authority-spike` first, so `ensv2-authority` exists in `openspec/specs/` for this change to modify. Its 72 tasks are complete and the spec is unchanged since.
- **Blocked on credentials**: `GRAPH_API_KEY` gates every task in the discovery gate; `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY_ID`, and `PRIVY_AUTHORIZATION_PRIVATE_KEY` gate the financial gate. Both are external sign-ups, both are on the critical path, and neither is code. Obtain them before the gate they block, not during it.
- **New**: query and ranking implementations in `@nymspace/graph`; Privy SDK wiring in `@nymspace/privy`; an ERC 8004 registration path and manifest assembly in a new or extended package; product routes in `apps/api`; the console in `apps/web`; a persistence module and its migrations.
- **New dependencies**: the Privy server SDK, an LLM provider client for the discovery reasoning step, and a persistence library. `@nymspace/graph` needs none — it already queries through `fetch`.
- **Modified**: `apps/web/app/page.tsx` gains navigation to the console; `.env.example` and `turbo.json` gain any variable the LLM provider and the persistence layer introduce, in the same edit, or `pnpm env:check` fails.
- **Onchain**: registers three subnames under `nymspace.eth` and at least one ERC 8004 identity on Sepolia. Register early — `docs/17` Risk 3 is that a registration created shortly before recording has not been indexed.
- **Not affected**: the ENSv2 mechanism itself. Everything here consumes `EnsService`; nothing re-derives a resource or re-implements a role check.
