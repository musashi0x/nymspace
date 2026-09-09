## 0. The gate contract

Every gate below states the same six things. A gate that cannot be run is not a gate, it is a hope.

- **Run** — one command, one exit code.
- **Passes when** — numbered assertions, each true or false without interpretation.
- **Lies by** — the specific way this gate passes while the thing it guards is broken. Every gate here has one, and it is always a false *positive*: a proof that succeeded for the wrong reason.
- **Control** — the extra assertion that catches the lie. Cheap to skip, expensive to have skipped.
- **Evidence** — a committed artifact, so the decision survives the session and the recollection.
- **On fail** — stop, cut, or fork. Decided now, in daylight, rather than at the gate under time pressure.

The recurring hazard across all six gates is the same one: **a negative result that has more than one cause.** A revert, a denial, and a timeout all render as failure, and three of this project's five headline proofs *are* negative results. So every negative assertion below is paired with a differential control that eliminates the boring explanation.

## 1. Prerequisites

Nothing in sections 2 onward starts until this section is clear. Two of these three items are someone else's queue, not ours.

- [ ] 1.1 Archive `ensv2-authority-spike` so `ensv2-authority` lands in `openspec/specs/`. This change's delta modifies that capability and cannot apply while it lives only in a pending change
- [ ] 1.2 Obtain `GRAPH_API_KEY` from The Graph Studio and set it. Every task in section 4 is blocked on it
- [ ] 1.3 Obtain Privy credentials — `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY_ID`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`. Every task in section 5 is blocked on them
- [ ] 1.4 Confirm the spike's deployed proxies still respond: `getCode` on `ENSV2_PARENT_REGISTRY_ADDRESS` and `ENSV2_PERMISSIONED_RESOLVER_ADDRESS`, and `getSubregistry` for `nymspace` on the `.eth` registry returns the parent registry
- [ ] 1.5 Re-fund the organization and controller keys with Sepolia ETH. Three subname registrations, an ERC 8004 registration, and the permission-proof writes all spend
- [ ] 1.6 Decide the persistence engine and the LLM provider (design.md, Open Questions), and add every variable either introduces to `.env.example` **and** `turbo.json` in the same edit, or `pnpm env:check` fails
- [ ] 1.7 Write `scripts/check-credentials.ts`, wired as `pnpm check:credentials`, implementing Gate 0

**Gate 0 — Credentials are real.**

- **Run**: `pnpm check:credentials`
- **Passes when**:
  1. A Graph query for any known-indexed agent returns 200 with a `data` body, using `GRAPH_API_KEY`.
  2. An authenticated Privy read returns the app's own wallet list.
  3. `getCode` is non-empty on the parent registry, the resolver, and the ERC 8004 identity registry.
  4. The organization and controller private keys derive **different** addresses, and both hold more Sepolia ETH than the run will spend.
- **Lies by**: a variable being non-empty. `GRAPH_API_KEY=changeme` satisfies `pnpm env:check` and fails four hours later inside Gate B, where it reads as a schema problem.
- **Control**: every check is a real authenticated round trip to the provider. No length checks, no truthiness checks.
- **Evidence**: one line per provider in the run log, with the provider's own response code.
- **On fail**: the blocked section does not start. Chase the credential — it is the only work on that path.

## 2. Coordination store

The smallest thing that makes the rest addressable. Written first because every later section needs somewhere to record an id.

- [ ] 2.1 Implement the entity shapes from `docs/09_DATA_AND_EVENT_MODEL.md`: organization, agent, identity snapshot, graph snapshot, financial authority reference
- [ ] 2.2 Implement the unified `ActivityEvent` with source, type, status, occurrence time, and per-source evidence fields
- [ ] 2.3 Enforce the boundary in types: a snapshot type carries `fetchedAt` and cannot be constructed without it
- [ ] 2.4 Implement per-integration provisioning status. No single `active` flag
- [ ] 2.5 Assert in a test that no entity holds a permission decision, a trust score, or key material as an authoritative value
- [ ] 2.6 Restart durability test: write an agent and an event, restart the process, read both back

## 3. Identity gate (Day 2, first half)

- [ ] 3.1 Register the three demo subnames — `research`, `trader`, `deploy` — under `nymspace.eth` through `EnsService.registerSubname`, with the resolver attached
- [ ] 3.2 Read back owner, resolver, and registry for each, and record the transaction hashes as activity events
- [ ] 3.3 Define the `agent-context` JSON shape and write it from the organization key for all three agents
- [ ] 3.4 Write `agent-endpoint[mcp]` for the research agent. A2A and web stay unset until an endpoint actually exists
- [ ] 3.5 Grant the research agent's controller record-scoped `ROLE_SET_TEXT` on its operational keys via `authorizeTextRole`, one resource per key. No name-level grant
- [ ] 3.6 Assert the wildcard resource is empty for every granted key, across all three names
- [ ] 3.7 Assert grants do not leak: the research controller's roles on the trader name's MCP key read absent
- [ ] 3.8 **Register the research agent in the ERC 8004 IdentityRegistry on Sepolia now.** Indexing latency is the one risk with no engineering mitigation — this is the earliest point it can start
- [ ] 3.9 Confirm the registration claims the agent's ENS name, and record the transaction hash
- [ ] 3.10 Construct the ENSIP 25 key with the existing ERC 7930 encoder, and assert: lowercase registry, minimal chain reference (`0xaa36a7`), canonical decimal agent id, no whitespace
- [ ] 3.11 Write the ENSIP 25 record from the **organization** key with value `"1"`
- [ ] 3.12 Assert the controller cannot write that key — the transaction must revert
- [ ] 3.13 Implement runtime verification in the registry-to-ENS direction, returning the seven-state `Ensip25Status`, with the read time attached
- [ ] 3.14 Negative verification tests: wrong agent id, checksummed registry address, zero-padded chain reference — each must fail, and each must be distinguishable from an RPC failure
- [ ] 3.15 Implement manifest assembly as a per-request read-through view. No stored manifest, no manifest cache surviving the request
- [ ] 3.16 Assert a record changed on chain changes the assembled manifest with no invalidation step

- [ ] 3.17 Write the gate runner as `pnpm --filter @nymspace/ens verify:identity`, emitting `evidence/gate-a.json`

**Gate A — Identity.**

- **Run**: `pnpm --filter @nymspace/ens verify:identity`
- **Passes when**:
  1. `research.nymspace.eth` resolves through the Universal Resolver.
  2. The controller's `setText` on `agent-endpoint[mcp]` confirms, and the read-back equals the written value **and differs from the value before the write**.
  3. The controller's `setText` on the ENSIP 25 key reverts.
  4. The controller's `setResolver` reverts.
  5. An ERC 8004 registration exists whose claimed ENS name string-equals the agent's name after normalization.
  6. Verification returns `verified`, carrying a read time.
  7. Verification of a deliberately mis-encoded key, in the same run, returns `ens_record_missing`.
- **Lies by**: a revert with the wrong cause. Out of gas, a stale nonce, an empty balance, and a malformed call all revert, and all render as an authorization denial in a pass/fail line. The second lie is quieter: if `ENSV2_ORGANIZATION_PRIVATE_KEY` and `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY` derive the same address, every allowed write passes and the delegation proof is vacuous.
- **Control**:
  - assert the two keys derive different addresses before anything is sent (also Gate 0.4, asserted again here because this is the gate it invalidates);
  - run the denied calls from the same signer, in the same block window, with the same gas settings as the write that succeeded in (2);
  - decode the revert and assert it is the resolver's own unauthorized error, not a generic failure;
  - assert (7) **before** trusting (6). A verifier that has never returned a negative has not been shown to work, and every mis-encoding in this path fails as an empty read that is indistinguishable from an honest absence.
- **Evidence**: `evidence/gate-a.json` — every transaction hash, every assertion, both signer addresses, and the decoded revert reason for each denial. Committed.
- **Deadline**: end of the Day 2 first half.
- **On fail**: no fallback exists. `docs/17` Risk 1 says solve ENSv2, and section 4's ranking cites the verification result, so a partial identity gate poisons discovery rather than merely delaying it.

## 4. Discovery gate (Day 2, second half)

Blocked on 1.2.

- [ ] 4.1 Introspect the live Agent0 subgraph and correct `packages/graph/src/types.ts` against the real schema. The stub was written deliberately thin because the doc's query is conceptual
- [ ] 4.2 Implement the MCP-capable agent search query against the corrected schema
- [ ] 4.3 Implement the full-profile query for one agent id
- [ ] 4.4 Extend `normaliseAgent` for feedback and validation: exclude revoked feedback, and represent validation as unavailable rather than zero on networks with no ValidationRegistry
- [ ] 4.5 Unit-test normalisation against every case in `docs/13`: missing MCP endpoint, missing ENS claim, no feedback, pending validation, revoked feedback excluded
- [ ] 4.6 Confirm the demo registration from 3.8 is indexed. If it is not, continue with other tasks and re-check — do not fabricate a candidate
- [ ] 4.7 Implement `search_agent0` as a server-side tool with capability, MCP-requirement, trust-model, and chain parameters
- [ ] 4.8 Implement the ranking step: derive criteria from the request, filter, rank, explain
- [ ] 4.9 Pass registration descriptions and endpoint metadata as data in the user turn. Never into system instructions
- [ ] 4.10 Validate the explanation against the candidate object — a cited field absent from the response fails the test
- [ ] 4.11 Omit validation from scoring rather than weighting it zero, and drop the row from the trust panel when there is nothing to show
- [ ] 4.12 Attach provenance to every result: provider, chain, subgraph id, query time
- [ ] 4.13 Implement the indexing-pending state with last-checked time, retry, and the registry transaction hash as evidence
- [ ] 4.14 Implement the short browse cache and an explicit refresh that bypasses it
- [ ] 4.15 Log each discovery request: query, endpoint, chain, query time, result count, selected ids, explanation, verification result
- [ ] 4.16 Provider-failure test: with the Graph unreachable, assert a provider error and assert no synthesised candidate appears

- [ ] 4.17 Write the gate runner as `pnpm --filter @nymspace/graph verify:discovery`, emitting `evidence/gate-b.json`

**Gate B — Discovery.**

- **Run**: `pnpm --filter @nymspace/graph verify:discovery`
- **Passes when**:
  1. A live query returns at least **three** candidates, so ranking had something to choose between.
  2. At least one candidate lacking MCP is present in the raw response and absent from the filtered set.
  3. Every field the explanation cites is present on the candidate it describes.
  4. The explanation validator **rejects** a deliberately corrupted explanation in the same run.
  5. The response carries provider, chain, subgraph id, and query time.
  6. With the API key removed, the identical request produces a provider error and zero candidates.
  7. Injecting a null validation field changes no score.
- **Lies by**: a single-candidate response. If the subgraph returns one agent, the filter and the ranker both pass without executing, and the demo works exactly once. The second lie is that a fixture and a live response have the same shape, so a cached or seeded result reads as live to every assertion that only inspects the body.
- **Control**: (1) forces plurality, (2) forces the filter to actually remove something, (4) mutation-tests the checker rather than the output, and (6) proves the request left the process. Assertion (7) is the one that catches invented reputation — a score that moves when a null is injected was weighting an absent dimension.
- **Evidence**: `evidence/gate-b.json` — the raw response, the filtered set, the explanation, and the validator's verdict on both the real and the corrupted explanation.
- **Deadline**: end of Day 2.
- **On fail**: The Graph is a track. Escalate the query shape against the live schema by introspection. Do not add a local index and do not read the registry directly — both forfeit the track they were meant to satisfy.
- **Deliberately not required**: that *our* demo agent is indexed. That is task 4.6, it depends on an indexer we do not run, and a gate blocked on someone else's queue stops being a decision.

## 5. Financial gate (Day 3)

Blocked on 1.3. `docs/14` sets a hard mid-Day-3 decision point; `docs/17` Risk 6 names the fallback.

- [ ] 5.1 Wire the Privy server SDK behind the existing `PrivyWalletPort`, so no route handler touches a credential
- [ ] 5.2 Create or load the research agent's wallet; persist only the wallet id and address
- [ ] 5.3 Choose the ownership model by trying one, and record which and why in the repository
- [ ] 5.4 Configure exactly one amount-based control using Privy's current API
- [ ] 5.5 Fund the wallet with the demo token
- [ ] 5.6 **Run the denied payment first.** A policy that permits everything demos as a success and must not be discovered on stage
- [ ] 5.7 Run the allowed payment; assert an executed status with a transaction hash
- [ ] 5.8 Normalise provider errors into `denied`, `pending_approval`, and `failed`, and unit-test the mapping
- [ ] 5.9 Read the displayed limit from the configured policy, never from a constant
- [ ] 5.10 Assert the agent signer cannot alter its own policy
- [ ] 5.11 Assert no response body contains the app secret, the authorization key id, the authorization private key, or signing material
- [ ] 5.12 Frontend-tampering test: alter the displayed limit client-side, submit an over-limit payment, assert Privy still denies
- [ ] 5.13 Wallet mapping restart test: restart, inspect the agent, assert the same wallet loads

- [ ] 5.14 Write the gate runner as `pnpm --filter @nymspace/privy verify:policy`, emitting `evidence/gate-c.json`

**Gate C — Financial.**

- **Run**: `pnpm --filter @nymspace/privy verify:policy`
- **Passes when**:
  1. The wallet loads by agent id, and its balance **exceeds the denied amount**.
  2. The over-limit payment returns `denied` with a policy reason, and no transaction was broadcast.
  3. The under-limit payment returns `executed` with a transaction hash — same wallet, same token, same recipient, same run.
  4. Raising the policy limit above the denied amount and resubmitting the **identical** request returns `executed`. Restoring the limit and resubmitting returns `denied` again.
  5. The displayed limit is read from the policy, and changing the policy changes the displayed value.
  6. No response body contains a credential.
- **Lies by**: a denial with a cause that is not the policy. An underfunded wallet, a bad recipient, a malformed amount, and an expired credential all produce a rejection that normalises to `denied`. The mirror failure is worse and quieter: a policy that denies nothing demos as a clean success, and nobody looks at a green run.
- **Control**: (1) removes the funding explanation, (3) holds token and recipient constant so neither can explain the difference, and **(4) is the only assertion that proves the policy is the binding constraint.** Without it the gate cannot separate an enforced limit from a broken integration that happens to reject everything. Run the denied case *before* celebrating the allowed one.
- **Evidence**: `evidence/gate-c.json` — both request bodies, both results, the policy value before and after the raise, and the restore confirmation.
- **Deadline**: middle of Day 3, per `docs/14`.
- **On fail**: stop expanding Privy the same hour. Raise the Bazantic fork as its own change proposal rather than editing this one — it replaces a capability, not a task. Do not half-mock a policy: `docs/08` forbids it, and a simulated control is worse than an absent one because it cannot be spotted from the outside.

## 6. Product API

- [ ] 6.1 Agent list route with per-integration status
- [ ] 6.2 Agent identity route returning live ENS state, records, and the verification result
- [ ] 6.3 Permissions route: per text key and per registry action, naming the source
- [ ] 6.4 Permission grant and revoke routes, organization-authorised
- [ ] 6.5 Record write route for server-signed controller writes
- [ ] 6.6 Verification route running the runtime check
- [ ] 6.7 Discovery route returning candidates, signals, explanation, and data source
- [ ] 6.8 Wallet route returning safe metadata only
- [ ] 6.9 Payment preview and payment routes with the four typed outcomes
- [ ] 6.10 Activity route with filters by agent, source, type, and status
- [ ] 6.11 Attach a read time to every externally-derived payload, and test that one without it fails
- [ ] 6.12 Return authority and policy denials as described outcomes, not 500s
- [ ] 6.13 Extend the typed `hono/client` surface in `apps/web/lib/api.ts` so a renamed route is a typecheck failure
- [ ] 6.14 Assert every new environment variable appears in both `turbo.json` and `.env.example`

## 7. Console (Day 4)

- [ ] 7.1 Fleet screen: parent name, agent count, chain, and per-agent cards showing the five integration states separately
- [ ] 7.2 Agent inspector: identity, manifest, authority, trust, and financial sections
- [ ] 7.3 Label every chain-derived field with its chain and read time
- [ ] 7.4 Permission matrix computed from role reads — one cell, one query
- [ ] 7.5 Evaluate the resolver's full fallback chain via `setTextResourceAlternatives`, so a name-level grant is not shown as an absence
- [ ] 7.6 Use the effective-authority predicate that ORs root roles, never the raw per-resource read, so the organization is not displayed as unauthorised
- [ ] 7.7 Assert a positive control in the same request before rendering any denied cell
- [ ] 7.8 Live-mutation test: revoke a grant on chain, refresh, assert the matrix changed with no cache step
- [ ] 7.9 Permission proof interaction: permitted write showing old value, new value, hash, actor, and the permission that allowed it
- [ ] 7.10 Permission proof: unauthorised write showing the real revert, attributed to the resolver's access control
- [ ] 7.11 Discover screen with the conversational input, result card, and evidence drawer listing the exact ranking fields
- [ ] 7.12 Task request screen with the policy preview read from the live policy
- [ ] 7.13 Policy denial screen stating the requested amount, the limit, the decision, and that no funds moved
- [ ] 7.14 Implement the state machines from `docs/11`: identity, permission action, verification, graph, financial
- [ ] 7.15 Implement the error taxonomy — identity policy, financial policy, RPC unavailable, indexing pending — each distinct from the others
- [ ] 7.16 Loading states that name the system being read; no placeholder content behind a spinner
- [ ] 7.17 Empty states that explain; no disabled fake balance, no seeded score
- [ ] 7.18 Activity timeline sorted by occurrence, with provenance per event, retaining denied and failed events and resolving pending ones in place
- [ ] 7.19 Provisioning completes only after chain read-back confirms name, resolver, grants, and absence of protected authority
- [ ] 7.20 Link the landing page to the console
- [ ] 7.21 Write the gate runner as `pnpm test:matrix-live`, emitting `evidence/gate-d.json`

**Gate D — Authority is contract-derived.**

The gate `docs/17` Risk 10 exists for, and the one guarding success metric one in `docs/01`.

- **Run**: `pnpm test:matrix-live`
- **Passes when**:
  1. A grant revoked on chain flips the corresponding cell on the next refresh, with no application cache step.
  2. Re-granting flips it back.
  3. Every rendered cell has a corresponding role query in that request's own trace.
  4. A positive control cell rendered allowed in the same request as any denied cell.
  5. A grant made at name scope renders as allowed, not denied.
  6. The wildcard resource reads empty for every granted key, across all three agents.
- **Lies by**: a matrix that is correct today by coincidence. The intended policy in `docs/03_UX_SPEC.md` is a table someone typed, so a console that hardcodes that table passes every visual inspection perfectly and fails the moment chain state and intent diverge. That divergence is exactly what a judge probes.
- **Control**: (1) and (2) mutate chain state and require the interface to follow — nothing hardcoded survives a live mutation. (5) catches the narrower bug where only `resource(node, part)` is checked and the resolver's other two fallback resources are ignored, which renders a real grant as a denial.
- **Evidence**: `evidence/gate-d.json` — the matrix before, the revoke transaction hash, the matrix after, and the role queries behind each cell.
- **On fail**: not cuttable. `docs/01` success metric one is that 100 percent of displayed permission state is contract derived, and this is the only assertion that tests it.

## 8. Hardening and submission (Day 5)

- [ ] 8.1 ENS integration tests E1–E6 from `docs/13`, including E6: revoke a grant, assert the next controller write reverts
- [ ] 8.2 ENSIP 25 tests I1–I4, including I4: after an ownership change, re-verify rather than reusing a cached result
- [ ] 8.3 Graph tests G1–G4, including G4: with the provider disabled, assert a provider error and no fake score
- [ ] 8.4 Discovery end-to-end test against live data
- [ ] 8.5 Privy tests P1–P4
- [ ] 8.6 Restart test: complete setup, stop, restart, inspect — ENS, Graph, and wallet state all reload
- [ ] 8.7 Fresh-browser test: new session, no storage, discovery and inspection still work
- [ ] 8.8 Rehearse the demo three times; record transaction confirmation delay, Graph query delay, and the failure points
- [ ] 8.9 Write `pnpm verify:acceptance`, chaining Gates A through D, and run Gate E
- [ ] 8.10 Secret audit: no key material, no provider secret, nothing in a client bundle or a response body
- [ ] 8.11 README with the architecture, the sponsor mapping, and the transaction evidence
- [ ] 8.12 Architecture diagram
- [ ] 8.13 Demo video
- [ ] 8.14 Re-verify the ENSv2 addresses against the canonical Deployments page before submitting — the deployment is beta and `docs/20_SOURCES.md` requires the recheck
- [ ] 8.15 State the unemancipation point in the demo narrative: the organization retains root roles and can reclaim any agent subname, deliberately
- [ ] 8.16 Confirm the build pool and each partner's prize requirements
- [ ] 8.17 Freeze contracts and integrations several hours before recording. After the freeze, fix only a broken demo, a security issue, or a submission requirement

**Gate E — Acceptance.**

- **Run**: `pnpm verify:acceptance`, which chains Gates A through D end to end.
- **Passes when**: **three consecutive clean runs**, covering the five proofs — allowed ENS write, denied ENS write, live Graph discovery, allowed payment, denied payment — plus one run after a full process restart and one from a browser session with no storage.
- **Lies by**: counting a retry as a pass. Three attempts of which two succeeded is a flow that works on stage only if the judge waits, and a rehearsal run under no time pressure is not a rehearsal. The restart and fresh-browser runs exist because in-memory state is the failure that looks identical to success until the moment it does not.
- **Control**: consecutive, tracked by the runner itself. A failed run resets the count to zero rather than being re-attempted into the tally.
- **Evidence**: three `evidence/gate-e-<n>.json`, plus the timings recorded in task 8.8.
- **Deadline**: before the pre-demo freeze, not after it.
- **On fail**: the freeze does not start. Cut from section 9 in order until three consecutive runs pass. Cutting scope to reach three clean runs is the correct trade; recording on two of three is not.

## 9. Cut list

Adopted verbatim from `docs/14_EXECUTION_PLAN.md`. If behind, cut from the top.

- [ ] 9.1 Deploy agent
- [ ] 9.2 Trader agent interactions
- [ ] 9.3 Activity timeline polish
- [ ] 9.4 A2A live connection
- [ ] 9.5 Cross-chain Graph stretch (Base Sepolia — leave the config entry, do not claim the track)
- [ ] 9.6 Approval escalation
- [ ] 9.7 Discovery UI polish

Never cut: the EAC proof, the live Graph query, live financial enforcement, and runtime evidence.
