## Context

The spike answered the question the whole plan rested on. Record-level delegation works on ENSv2 Sepolia: the organization owns `nymspace.eth`, a UserRegistry proxy at `0xd0D823…` is wired under it, a PermissionedResolver proxy at `0x45DaD5…` is initialized with the organization at `ROOT_RESOURCE`, and `authorizeTextRoles` scopes a controller to one text key while every undelegated action reverts from the contract.

What is left is four integrations that have never run, three of which are ordinary product work and one of which is not. The unusual one is the ordering constraint: the ERC 8004 registration must exist before the Graph can index it, the Graph must return the demo agent before discovery can rank it, and indexing latency is not under our control. `docs/17` Risk 3 states the failure directly — a registration created shortly before recording is a registration the demo cannot find.

Two facts from the spike shape everything below and are easy to lose:

- **`hasRoles`, never `roles`.** `roles(resource, account)` returns raw per-resource storage. The organization holds everything at `ROOT_RESOURCE` and therefore reads as zero through `roles()` while being fully authorized. A permission matrix built on `roles()` shows "denied" for actions that succeed. `roles()` is correct only for the narrow question of what is stored at one resource — proving a grant is record-scoped rather than name-scoped.
- **A wrong resource derivation is indistinguishable from a denial.** Both return false. Every negative permission read displayed to a user must sit behind a positive control from the same code path. The spike's `setTextResourceAlternatives` already encodes the resolver's own fallback chain; the console must evaluate all three alternatives, not just `resource(node, part)`.

The credential position is the other real constraint. `GRAPH_API_KEY` and the four Privy variables are empty. They are external sign-ups on the critical path of two of the three sponsor tracks.

## Goals / Non-Goals

**Goals:**

- Meet every acceptance criterion in `docs/01_PRD.md`, and make the five proofs in `docs/13_TEST_PLAN.md`'s acceptance gate repeatable rather than lucky.
- Keep authority answers contract-derived end to end. A judge who greps the console for a hardcoded permission finds none.
- Make each partner integration independently demonstrable, so a failure in one does not take the demo with it.
- Preserve the package boundary the scaffold established. Route handlers orchestrate; packages hold domain logic; neither server reimplements the other's.
- Survive a restart and a fresh browser, because `docs/17` Risk 9 says local state is the failure mode that looks like success right up until the demo.

**Non-Goals:**

- Cross-chain Graph queries against Base Sepolia. ADR 009 calls the standardized track a stretch and says not to claim it on one subgraph; the code is written so adding a second network is a config entry, and it stays unclaimed until it actually runs.
- An approval escalation path for denied payments. `docs/08` is explicit: do not simulate an approval system that is not implemented. The denial is the deliverable.
- A general agent execution environment. The research agent's "task" is a payment with a memo.
- Production key management, multisig admin, or delayed admin actions. `docs/12` names these as production mitigations and not MVP.
- More than three agents, per ADR 008.

## Decisions

**D1: One change, five gates, and the gates are real.**
The MVP is a single vertical slice whose parts have no standalone value — `docs/14` gates Day 2 on Day 1, and cuts scope from the bottom of a fixed list rather than dropping a partner. Splitting this into four changes would create three artifacts that cannot be archived until the last one lands. Instead, `tasks.md` is sectioned by the execution plan's own gates, each ending in a check that decides whether to continue. *Alternative considered:* one change per partner. Rejected for the artifact overhead, with one caveat recorded in Open Questions: if Privy is abandoned for the Bazantic fallback, that fork becomes its own proposal rather than an edit to this one.

**D2: The Agent Manifest is a read-through view, never a stored object.**
`docs/06` says it plainly and `docs/04` repeats it: the manifest is a UX representation of ENS records plus linked registry state. So there is no `manifest` table, no manifest cache that outlives a request, and the inspector's manifest panel labels each field with the system it was read from. *Alternative considered:* materialise the manifest on write and serve it from the store. Rejected — it is the exact failure the product argues against, and it would survive a record changing underneath it.

**D3: Verification is a seven-state model, and every state is reachable in the UI.**
`Ensip25Status` distinguishes `registry_claim_missing`, `ens_record_missing`, `mismatch`, and `rpc_error`. Collapsing these to `unverified` hides the difference between "this agent never claimed the name" and "the RPC timed out". The negative tests in the spike's task 8.11 already prove three distinct mis-encodings each fail as an empty read — which means `ens_record_missing` is the state a bug lands in, and the console must not present it as a settled fact about the agent.

**D4: The discovery LLM gets a tool, not a transcript.**
`search_agent0` runs server-side, returns normalised candidates, and the model ranks and explains over that array. Registration descriptions and endpoint metadata are untrusted text (`docs/12`, prompt injection) and go into the user turn as data, never into the system instruction. The explanation is checked against the candidate fields it cites — a reason mentioning a field absent from the response is a bug, not a stylistic issue.

**D5: Absent trust data is rendered absent.**
No ValidationRegistry exists on Ethereum Sepolia or Base Sepolia. A ranking that weights a missing dimension at zero has invented reputation, which `docs/04` forbids in the same breath as inventing capabilities. The ranking omits the dimension and the trust panel drops the row. *Alternative considered:* show `Validation 0 completed`. Rejected — an agent with no validation data is not an agent that failed validation, and a judge who knows the testnet will read the zero as a lie.

**D6: A denial is a typed result, never a thrown error.**
Both denial paths — EAC revert and Privy policy rejection — resolve into a status the caller renders. `@nymspace/privy` already types `PaymentResult` this way. The ENS side needs the same: a reverted `setText` is `{ status: "denied", source: "ensv2" }`, and it reaches the timeline and stays there. `docs/11` is the reason: an EAC denial is not a system failure, it is proof the control plane works.

**D7: The store holds ids and events, and nothing that has an authority elsewhere.**
Agent slug, ENS name, controller address, ERC 8004 agent id, Privy wallet id, UI labels, activity events. Anything read from ENS, the Graph, or Privy is fetched per request. Where caching is unavoidable for latency, the cached value carries `fetchedAt` and the UI labels it as a cache — `docs/09` permits caching and forbids treating the cache as truth. The restart test in `docs/13` is what enforces this: if the demo survives a restart, nothing load-bearing was in memory.

**D8: Register the ERC 8004 identity on the first day of this change, not the last.**
Indexing latency is the one risk with no engineering mitigation. Registering early converts it from a demo-day gamble into a wait that happens while other work proceeds. The indexing-pending state gets built anyway, because a judge may create their own agent.

**D9: The permission matrix evaluates the resolver's full fallback chain.**
`onlyPartRoles` accepts a grant at `resource(node, part)`, `resource(0, part)`, or `resource(node, 0)`. A console that checks only the first would display "denied" for a name-level grant that in fact succeeds. `setTextResourceAlternatives` exists for this; the matrix calls it. Separately, the wildcard `resource(0, part)` must read as empty for every key — one shared resolver serves all three agents, so a wildcard grant would let one agent's controller rewrite that key on every name.

**D10: The console reads through the API, and the API reads through the packages.**
No component calls a package that imports `server-only` from a client boundary, and no route handler derives an EAC resource itself. This is already enforced structurally — the guard plus `pnpm conditions:check` — and it is what keeps the "one blast radius when the ENSv2 beta moves" claim in `docs/17` true rather than aspirational.

**D11: Every negative proof carries a differential control.**
Three of the five headline proofs are negative results — a denied ENS write, a denied payment, an absent trust dimension. A negative result is the weakest kind of evidence, because it has many possible causes and they all render identically: a revert from access control looks like a revert from gas, a policy rejection looks like an empty wallet, and a validation dimension that is absent looks like one scored zero. So each negative assertion in `tasks.md` is paired with a control that eliminates the boring explanation — decode the revert, over-fund the wallet, raise the limit and watch the same request succeed. *Alternative considered:* assert the negative and move on, which is what the docs' test plan does. Rejected because the whole product argument rests on denials, and a denial nobody can attribute is a claim rather than a proof. The controls also protect against the opposite failure, which is worse and quieter: a permission model that denies everything, or a policy that denies nothing, both pass an unpaired assertion and demo as a clean success.

## Risks / Trade-offs

- **Credentials are not obtained** → The Graph gate and the Privy gate cannot start. Mitigation: both sign-ups happen in section 1, before any code in the gates they block. This is the only task in this change whose duration is set by someone else.
- **Agent0 indexing does not pick up the demo registration** → Discovery has nothing live to return, and `docs/17` forbids faking it. Mitigation: D8 registers early; the indexing-pending state is a real UI state with a retry and a last-checked time; and the registry transaction hash stands as evidence in the meantime.
- **The Agent0 schema differs from the conceptual query in `docs/07`** → Every query written from the doc fails. Mitigation: the first Graph task is an introspection query against the live subgraph, and the shapes in `@nymspace/graph/types.ts` are corrected from the response before any consumer is written. The stub's own comment predicted this.
- **Privy's policy syntax has moved** → A policy configured from `docs/08`'s conceptual model silently does not enforce. Mitigation: the denied-payment test runs before the allowed one is celebrated. A policy that denies nothing is worse than no policy, because it demos as a success.
- **The LLM invents a field in its explanation** → The strongest AI-track claim becomes the weakest. Mitigation: the explanation is validated against the candidate object; an unsupported citation fails the discovery test.
- **The permission matrix reads false for a real grant** → A wrong resource derivation and a genuine denial are the same value. Mitigation: D9's fallback chain, plus a positive control asserted in the same request before any negative cell renders.
- **Time.** Four integrations, five screens, and a hardening pass. `docs/14`'s cut list is ordered and this change adopts it verbatim: deploy agent, then trader interactions, then timeline polish, then A2A, then cross-chain, then approval escalation, then AI UI. Nothing above the line — ENS EAC proof, live Graph query, live financial enforcement, runtime evidence — is cuttable.
- **The store becomes the authority by accident** → The easiest way to make a screen fast is to serve it from the database, and the second-easiest is to cache without a label. Mitigation: the restart test, and the requirement that every externally-derived value carries `fetchedAt` through the API to the UI.

## Migration Plan

Additive. Nothing built by the spike changes; this change consumes it. The landing page keeps its route and gains a link to the console.

The onchain state this change creates — three subnames under `nymspace.eth`, one or more ERC 8004 registrations, one Privy wallet — is testnet and disposable. Rollback is deleting the store and re-running provisioning against fresh labels; the parent registry and resolver proxies are reusable and should not be redeployed.

The spike's proxies are recorded in `.env` and are the reason a second `nymspace` acquisition is unnecessary. Do not lose them.

## Open Questions

- **Which LLM provider, and does the discovery step run on the API or in a Next route?** `docs/04` says "optional LLM provider" and leaves it open. The API is the better home — it already holds `GRAPH_API_KEY` behind the `server-only` guard — but the provider itself is unchosen and adds an environment variable to both `.env.example` and `turbo.json`.
- **Persistence: SQLite file, Postgres, or JSON on disk?** The store holds five entity types and an append-only event log for a demo with three agents. `docs/09` specifies the shapes and says nothing about the engine. The restart test is the only hard requirement, which a file satisfies. Decide before writing the first migration, not after.
- **Privy wallet ownership model.** `docs/08` offers application-owned or user-owned-with-restricted-server-signer and says to pick whichever reaches a working policy-controlled transaction fastest. That is an answer only the SDK can give, so this is settled in the first Privy task by trying one.
- **Does the demo show revocation?** `docs/13` E6 requires the test — a revoked grant must make the next controller write revert — but `docs/01` lists a revocation flow under nice-to-have. The test is in scope; whether the console exposes a revoke button is a scope call at the Day 4 gate.
- **If the Privy gate fails, does Bazantic become a new proposal?** `docs/17` Risk 6 sets a hard gate and names the fallback. That fork changes a capability rather than a task, so it should be its own change. Recorded here so the decision is not made under time pressure at the gate.
- **How the demo narrates unemancipation.** The organization retains root roles and can reclaim any agent subname. D7 of the spike decided this is the product, not an oversight, and `docs/15_DEMO_SCRIPT.md` was updated to say so. Whether the console surfaces it — an "organization can reclaim" row in the authority matrix — is undecided.
