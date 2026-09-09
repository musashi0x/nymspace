# Nymspace: ENSv2 prize strategy and next build plan

**Recommendation.** Finish Nymspace as an operational identity console for agent teams. Its strongest demonstration is an agent updating its own endpoint, failing to change protected identity records, losing its permission after revocation, and being replaced without changing the ENS name consumers use. Add an independent client that resolves the name and calls a real MCP tool. Only then consider an organization-controlled service alias.

This direction extends the existing product thesis rather than replacing it. The ENS sponsor explicitly encourages hierarchical namespaces, fine-grained EAC, Permissioned Resolvers and agents with their own identities and permissions. These are an unusually close fit for Nymspace. The opportunity is to demonstrate a useful lifecycle with independently inspectable evidence. A directory of names, a permission table, or the number of sponsor integrations will not establish that lifecycle on their own. [1]

**Scope and confidence.** This assessment inspected the local checkout at `eac7493`, including the PRD, architecture, UX, security model, execution plan, sponsor mapping, demo script, OpenSpec spike checklist, ENS service and spike script, Hono routes, Graph client, Privy interfaces, and landing page. Official sources were retrieved on September 9, 2026. The review did not execute transactions, run the test suite, inspect private keys, or query the configured organization's onchain holdings. “Not demonstrated” means evidence was not found in the inspected checkout; it does not prove nobody has deployed something elsewhere. No estimate below is a prediction of winning.

**What the rules actually reward**

The Best Use of ENSv2 pool is $4,500, distributed as $1,500, $1,500, $1,000 and $500. Qualification requires ENSv2 on Sepolia, central rather than cosmetic use, a functional demonstration without hardcoded results, public source code, and a video or live-demo link. The separate $500 integration prize is restricted to Continuity Track participants. The feature examples in the bounty are opportunities, not a requirement to implement every listed feature. [1]

The general event rules additionally require a 2–4 minute demo video. The published deadline is September 13, 2026 at noon EDT: **23:00 in Asia/Ho_Chi_Minh**. Up to three partner selections are allowed, with multiple internal tracks from one partner counting as one selection. General judging covers technicality, originality, practicality, usability and impression; those are useful design priorities, not published numerical ENS-specific weights. [2]

For an ENS-focused submission, The Graph and Privy are supporting integrations. Their capabilities are not qualification requirements for the ENS track. Retain their own acceptance criteria if applying for their prizes, but do not let unfinished payment infrastructure prevent the ENS demonstration from working.

**Current state: useful groundwork, unfinished product proof**

| Area | Evidence in the checkout | Assessment |
| --- | --- | --- |
| Landing page | Animated hero, themes, repository activity and contributor UI | Implemented presentation; it does not yet demonstrate ENS authority |
| Workspace and API | pnpm/Turborepo packages, Hono routes, typed client, tests | Useful foundation; no need for another architecture pass |
| ENS contract integration | ABIs, viem client, registration/deployment helpers, record grants, permission predicates | Substantial implementation exists |
| Sepolia lifecycle | Script exists; funding, namespace ownership, deployment and core proof steps remain unchecked | Still needs a receipt-backed execution record |
| Agent application API | `/:name/keys` derives keys and DNS bytes without chain reads | Inspector and operational actions are not wired into the application |
| ENSIP-25 | Canonical key encoder and non-empty-record verification helper | Building blocks exist; no demonstrated full registration-to-resolution flow |
| Graph | Gateway client and normalization boundary | No completed discovery/ranking flow visible |
| Privy | Credential validation, request/result types and wallet port | Interface groundwork, not implemented financial enforcement |
| MCP consumption | A sample `.example` URL in the spike | Useful as a write test; not proof of a reachable agent |

Sources: [9–13]. The spike checklist mixes implementation tasks with execution tasks. A checked item that adds `--verify-only` support is not evidence that a fresh-process chain verification actually ran. Replace broad completion labels with “implemented,” “executed on Sepolia,” and “independently verified.”

**The next task: complete the ENS authority lifecycle**

The next work item should be:

> Produce a repeatable Sepolia demonstration in which the organization grants a controller one endpoint permission, the controller writes successfully, protected writes are refused for the expected reason, and revocation removes that exact permission.

First correct the evidence harness described below. Then fund distinct organization and controller test addresses, acquire or confirm the parent name, deploy and wire the UserRegistry and Permissioned Resolver, register one agent subname, and resolve it through the ENSv2 Universal Resolver.

Grant only `agent-endpoint[mcp]` to the routine controller initially. Broad `agent-context` editing is unnecessary for the first proof: capability descriptions and registry references inside context deserve a deliberate policy of their own. The organization should retain authority over the ENSIP-25 binding and registry configuration. These roles are administered in separate registry and resolver domains. [3–5]

For each successful write, wait for its receipt and verify success before reading the resulting state. Record chain ID, block number, signer address, contract address, operation, transaction hash, and the actual read-back. Negative proofs should record the expected decoded contract error and whether the result came from simulation or a mined reverted transaction.

Run this sequence twice, with the verification step in a fresh process. The output should remain inspectable after restart. Funding and namespace ownership are prerequisites in the existing checklist, but their current real-world state must be read before assuming the old availability and price observations remain valid.

**Features ranked by likely value for this submission**

These ranks are recommendations based on rule fit, usefulness, visible differentiation and the remaining implementation work. They are not sponsor scores.

| Priority | Feature | Why it earns its place | Definition of done |
| --- | --- | --- | --- |
| P0 | Live authority inspector | Makes record-level EAC understandable and inspectable | Show organization and controller permissions, current resolver, registry and block provenance |
| P0 | Allowed/denied write proof | Establishes the core product boundary | Endpoint write succeeds; protected binding and resolver-change attempts fail for the expected contract reason |
| P0 | Revocation and controller replacement | Turns a technical permission demo into an operational product | Old key loses the delegated right; new key gains it; same ENS identity continues |
| P0 | Real MCP call from an ENS name | Demonstrates why portable discovery matters | Separate consumer resolves a name, discovers MCP, and completes one harmless tool call |
| P1 | Public evidence view and verifier | Lets judges check facts without trusting the UI or holding secrets | Public addresses and RPC are sufficient to replay reads; transaction and simulation evidence are distinguished |
| P1 | Genuine ERC-8004 association | Connects the operational name with a real registry entry | Registry claims the name and runtime ENSIP-25 lookup confirms that specific registration |
| P2 | Organization-controlled service alias | Adds a second distinctive ENSv2 primitive | Same consumer-facing name resolves to a replacement worker after a real alias change |
| P2 | Cross-agent isolation demonstration | Proves namespace scope, especially on a shared resolver | A controller allowed on agent A cannot change the same key on agent B |
| Later | Expiring job namespaces, dedicated resolvers, namespace remounting | Good future product directions with more lifecycle complexity | Build only after the core flow and video are reliable |

The minimal version uses one operational agent and a replacement controller. A stronger version uses two agent identities and one service alias. Neither version needs a trading agent, deploy agent, marketplace, or several organization-management screens.

**Make revocation the main demonstration**

The current PRD calls controller revocation a nice-to-have. Promote it to core for an ENS-first submission. ENSv2's reversible permission system naturally supports the moment: an agent can act, the organization revokes the grant, and the same key can no longer act. [3–5]

A concrete walkthrough:

1. `research.nymspace.eth` advertises a real MCP endpoint.
2. Controller A updates that endpoint.
3. A attempts to change the protected registration binding; the contract refuses.
4. The organization revokes A's endpoint grant.
5. A retries the endpoint write; the expected permission error is returned.
6. The organization grants controller B the endpoint right.
7. B updates the endpoint; the consumer resolves the same name and reconnects.

The consumer has a stable identity to follow, and the organization has a controlled recovery process. No new reputation score or speculative token economy is necessary to explain the benefit.

Use precise wording: **revoking an ENS permission stops future authorized record writes**. It does not shut down the old server, erase the last endpoint value, cancel existing MCP sessions, revoke wallet authority, or undo previous actions. If the old controller already published a bad URL, the organization or replacement controller must restore the correct record as well. Existing consumers must re-resolve to observe the change.

If both private keys live in the same server process, this demonstrates protection against misuse of the scoped controller credential. It does not demonstrate protection against compromise of the entire server. Keep the organization signing path out of routine agent execution and expose only authenticated, narrowly scoped write operations. CORS alone is not authentication.

**Make the permission inspector explain the scope**

A green checkmark is less useful than “this controller can change this key on this name.” Show:

| Display | Meaning |
| --- | --- |
| Name and chain | The normalized identity and Sepolia deployment being inspected |
| Organization and controller | Distinct roles and signing addresses |
| Effective permission | Contract-derived allowed, denied, or unavailable |
| Permission source | Exact record grant, name-wide grant, wildcard grant, or root authority |
| Registry powers | Resolver change, subregistry change, unregister; include transfer only after its actual predicate is implemented |
| Evidence | Contract, resource, read block and timestamp |

Model “unknown / read failed” separately from denied. A stale UI check is not execution authority; refresh before signing and let the contract enforce the actual operation.

The existing `canSetText` helper evaluates the relevant alternative scopes and uses `hasRoles`; keep that approach. However, `NamedTextResource` logs identify historically named record resources, not necessarily every permission a controller can exercise. Name-wide and root grants can authorize keys without a corresponding per-key grant event. The UI should describe its enumeration honestly and show broader scopes explicitly. Bound log queries by deployment block and page them, rather than repeatedly querying every log from genesis. [3–5,10]

The standard registry also grants approved ERC1155 operators the owner's effective registry roles. A controller with `setApprovalForAll` approval could have broader powers than its direct grants suggest. Verify effective authority and prohibit accidental blanket approval in the narrow-controller setup. [4]

**The best stretch: an alias for a service, with explicit identity semantics**

If the core flow is working by September 11, add:

`research.nymspace.eth → worker-a.nymspace.eth`

then switch the service alias to `worker-b.nymspace.eth`.

A client uses the service name throughout. The organization controls which worker currently serves it. This directly applies the bounty's record-aliasing feature to rolling upgrades or replacement of an agent.

There are essential constraints. Resolver aliases operate within the same resolver instance, require the root-scoped alias role, and must be read through extended resolution via the Universal Resolver. Direct `text(namehash(alias), key)` reads do not perform the alias rewrite. Multi-name alias cycles are not comprehensively prevented by the resolver; reject cycles in the application. [3]

An alias shares the target's records, including potentially its registration attestations. Do not automatically treat the service alias and the worker's ERC-8004 identity as interchangeable. Display the service name and canonical worker separately, then verify the registration against the name actually claimed by that registration. An alias switch may change the worker identity; it must not carry the old worker's reputation onto the replacement.

For this release, retain the organization's shared resolver if that is what the implemented model assumes. Deploying a resolver for every agent is not required merely because the bounty mentions it, and it conflicts with the simple same-resolver alias design. Offer fully agent-controlled resolvers later for a different ownership model.

**Implementation issues to fix before calling the evidence complete**

1. **False positive denial proofs.** `checkReverts` catches every exception and marks it passed. An RPC timeout, malformed request or insufficient funding can be misreported as EAC enforcement. Accept only the expected decoded permission custom error for the specific operation; classify infrastructure errors as inconclusive or failed. Add a focused regression test proving a transport exception cannot pass this check. [10]

2. **Writes are submitted without consistently awaiting confirmation.** Record grants, endpoint updates and revocation are followed immediately by permission or value reads in several script paths. The viem write helper returns a transaction hash after simulation and submission; it does not wait for mining. Wait for a successful receipt before each dependent read or write. A successful simulation is not a successful transaction. [10]

3. **Direct reads can bypass public ENS resolution.** `EnsService.readText` reads from a configured resolver address. This is useful for diagnostics, but cannot establish that the public name currently points there, and will not implement aliases. Add a public resolution path; resolve the actual current resolver before writes, and check it against any organization policy for allowed targets. The official app guide explicitly warns that a cached resolver can accept writes nobody will read. [6,10]

4. **Verification mode overwrites the original evidence file.** `verifyOnly` loads prior evidence, performs reads and calls `finish(true)`. That function writes fresh global `facts` and `transactions` to the same path; in verification mode those collections do not contain the original deployment evidence. Save verification as a separate artifact and preserve the original evidence. A public verifier should also work from addresses without requiring both private keys. [10]

5. **The sample registration is not a complete ENSIP-25 demonstration.** The spike constructs its protected key with `agentId: "1"` and uses a `.example` endpoint. Those are adequate fixtures for testing write boundaries. They are not evidence that Nymspace owns registration 1 or operates a reachable MCP service. Register or load an actual team-controlled agent, obtain its real ID, publish its name claim, and perform the registry-to-ENS verification flow. [7,10]

6. **A new timestamp does not repair an old attestation.** The verification helper checks for a non-empty record and returns `verifiedAt`. ENSIP-25 warns that ownership changes can leave attestations stale. Re-reading the unchanged record gives it a new observation time, not a new owner's endorsement. Track relevant ownership/resolver changes and invalidate the stronger “current association” status pending the appropriate re-attestation policy. [7,10]

7. **Registry permission reset and resolver permission reset are separate.** The security document correctly notes versioned registry resources on re-registration, but its reassurance should not be generalized to resolver grants. Record permissions live in a different contract and resource scheme. Test re-registration, transfer and resolver replacement separately before claiming stale controller authority is eliminated. Until then, explicitly revoke old resolver grants or use a clean resolver under the chosen lifecycle policy. [3–5,9]

These are code-reading findings, not results from a new execution of the test suite.

**Identity, capability and trust should remain separate**

ENSIP-25 verifies an association between a claimed name and one registry entry. It does not verify that an agent is safe, honest, capable or well-reviewed. ENSIP-26 standardizes context and endpoint discovery; it does not authenticate a remote server or guarantee that a tool response is correct. Both documents currently have draft status. [7–8]

Use separate UI statements: “Registry association verified,” “MCP reachable,” “Feedback available,” and “Controller may update endpoint.” Avoid a single “Trusted 92” badge without a disclosed method and real inputs.

The current Agent0 Ethereum Sepolia configuration contains identity and reputation registries and an empty validation-registry configuration. This supports treating validation as unavailable in that configured demo network, not as a zero score or evidence of failure. It is a configuration-source observation, not an exhaustive live-chain deployment audit. [14]

The UX document still shows “Validation Completed” in an example. Reconcile it with the newer PRD and Graph notes. Add states for indexing pending, no feedback, unavailable validation and source read failure. Any AI explanation must be traceable to the returned fields.

**How to divide the remaining build window**

The schedule below starts from the inspected state on September 9. It is an execution recommendation with explicit gates, not an estimate that all integrations are guaranteed to fit.

| Date, Vietnam time | Primary outcome | Gate |
| --- | --- | --- |
| Sep 9 | Fix evidence harness; run namespace/delegation proof on Sepolia | Confirmed endpoint write plus correctly classified protected denials |
| Sep 10 | Wire a live inspector; implement revoke/replace; expose a real MCP endpoint | Fresh process and independent consumer reproduce the identity state |
| Sep 11 | Real ERC-8004 claim and ENSIP-25 verification; Graph discovery if retaining that prize | No fixture IDs, invented reputation or dead endpoint in the judge path |
| Sep 12 | Reliability, public verification, deployment and recording | Repeat the full flow twice; record a 2–4 minute video |
| Sep 13 before 23:00 | Submission, source links and final checks | Submit with a buffer; no new feature architecture |

With two builders, one can own contracts, receipts and permission predicates while the other builds the inspector and MCP consumer around agreed response types. The Graph integration can proceed once the agent ID and claimed name are real. Privy should receive a separate bounded proof slot only if its prize remains a priority; stop it from consuming the ENS demonstration budget.

If time runs short, cut the alias first, then extra agents, conversational search polish, cross-chain Graph queries and payment UI for an ENS-only submission. Keep live permissions, negative proof accuracy, public resolution, revocation and a real consumer. Do not rebuild the monorepo or start a custom reputation protocol.

**A three-minute ENS-first demonstration**

| Time | Scene | Evidence |
| --- | --- | --- |
| 0:00–0:20 | “Give agents an identity they can operate, with permissions their team can revoke.” | Organization and agent namespace |
| 0:20–0:50 | Inspect organization/controller authority | Live contract reads with block provenance |
| 0:50–1:20 | Agent changes endpoint; protected write is denied | Successful receipt and decoded permission refusal |
| 1:20–1:55 | Revoke old controller; replacement updates the same identity | Old key denied, new key succeeds |
| 1:55–2:30 | Independent client resolves ENS and calls MCP | Current endpoint and real tool result |
| 2:30–2:50 | Show registry association and optional Graph evidence | Actual registry ID, ENSIP-25 lookup and source fields |
| 2:50–3:10 | Open verification evidence and close | Public code, receipts, documented authority model |

Prepare transactions before recording and edit out waiting, as the event permits; do not substitute staged success for failed live operations. Label any simulation as simulation. If the alias is included, replace part of the explanatory section rather than lengthening the video. [2]

Keep the existing landing hero and build log, but add a clear “Open agent console” link once the console exists. Place development activity below the product entry point or on its own page. For ENS judging, runtime authority evidence should be easier to find than Git commit activity.

**Documentation and submission improvements**

Revise the PRD so revocation/replacement and one real MCP call are required. Make aliasing conditional. Revise the demo script around a single complete agent lifecycle; three named agents with only one implemented add less than one complete recovery flow. Update the sponsor mapping to link each claim to code, a receipt or query result, and a video timestamp.

Keep the organization's recovery authority explicit. The current model is deliberately not fully emancipated: the organization retains powers over agent subnames. Do not label those identities as forever names or beyond parent control. Registry emancipation, resolver administration and ancestry are separate questions, and full protection depends on more than a single local role bit. [4]

Distinguish fixed deployment configuration from hardcoded demo outcomes. Pinning the known Sepolia deployment and reviewed ABIs is legitimate; displaying “Allowed,” an owner, reputation score or endpoint as though it was read from chain when it was not is the problem. Check the configured deployment again before transactions because the beta interfaces can change.

The event asks for disclosure of how AI tools were used and for spec-driven submissions to include their specs, prompts and planning artifacts. This can be a factual submission appendix identifying actual assistance and team contributions. It does not require putting an AI co-author trailer into Git commits. Preserve the repository's existing no-co-author-trailer preference. Retain the OpenSpec history and accurately describe any reused earlier project code under the selected build category. [2]

The ENS CLI is a useful independent comparison tool for resolution and unsigned calldata. Its README describes an experimental preview, not a stable production dependency. Use a tested pinned revision if helpful; adopting another CLI is not itself the distinguishing feature. [15]

**Recommended next work package**

Name the next implementation change **“Complete the ENSv2 authority lifecycle.”**

Its acceptance criteria should be:

- A normalized agent name publicly resolves through the configured ENSv2 Sepolia hierarchy.
- Organization and controller are different addresses.
- Grant, endpoint update and revoke operations have confirmed receipts.
- Protected operations fail specifically because of EAC, not transport or funding errors.
- Old controller is denied after revocation; replacement can update the same name.
- A separate client resolves and invokes the actual MCP endpoint.
- Permission reads include block provenance and distinguish unavailable from denied.
- Evidence survives verification and restart; public verification needs no private keys.
- No sample registry ID, fake endpoint or fabricated reputation appears in the judge flow.

That is the most defensible next investment. Alias-based replacement is the best optional ENSv2 expansion after it passes. More sponsor integrations should follow a working authority product.

**Sources**

External sources were accessed September 9, 2026. ENSv2 pages warn that beta contracts/interfaces can change.

1. ETHGlobal. [ETHOnline 2026 — ENS prizes](https://ethglobal.com/events/ethonline2026/prizes/ens). Sponsor-specific qualification and feature examples.
2. ETHGlobal. [ETHOnline 2026 — event details and submission rules](https://ethglobal.com/events/ethonline2026/info/details). Deadline, video, judging, AI and spec-driven disclosure requirements.
3. ENS. [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver). Roles, record grants, aliases, extended resolution and record versioning.
4. ENS. [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry). Ownership, operators, transfer, expiry, mutable token IDs and emancipation.
5. ENS. [Enhanced Access Control](https://docs.ens.domains/ensv2/enhanced-access-control). Resource scopes, regular/admin roles and effective permission checks.
6. ENS. [Guide for App Developers](https://docs.ens.domains/ensv2/tutorial-app-developers). Universal Resolver, normalization, current-resolver lookup and test funds.
7. premm.eth, raffy.eth, workemon.eth, ses.eth. [ENSIP-25: AI Agent Registry ENS Name Verification](https://docs.ens.domains/ensip/25/). Created October 2, 2025; draft. Verification semantics and ownership-change caveat.
8. premm.eth, justghadi.eth. [ENSIP-26: Agent Text Records](https://docs.ens.domains/ensip/26/). Created May 17, 2025; draft. Agent context and endpoint discovery.
9. Nymspace local docs: [PRD](../../docs/01_PRD.md), [UX](../../docs/03_UX_SPEC.md), [ENS implementation](../../docs/05_ENSV2_IMPLEMENTATION.md), [security](../../docs/12_SECURITY_MODEL.md), [execution plan](../../docs/14_EXECUTION_PLAN.md), [demo](../../docs/15_DEMO_SCRIPT.md), [sponsor mapping](../../docs/16_SPONSOR_QUALIFICATION.md), [architecture decisions](../../docs/21_ARCHITECTURE_DECISIONS.md). Inspected at local HEAD `eac7493`.
10. Nymspace implementation: [spike script](../../packages/ens/scripts/spike-ensv2.ts), [ENS service](../../packages/ens/src/ens-service.ts), [viem adapter](../../packages/ens/src/viem-client.ts), [key and verification helpers](../../packages/ens/src/keys.ts), [spike checklist](../../openspec/changes/archive/2026-09-09-ensv2-authority-spike/tasks.md).
11. Nymspace [agent API route](../../apps/api/src/routes/agents.ts) and [landing page](../../apps/web/app/page.tsx).
12. Nymspace [Graph client](../../packages/graph/src/client.ts).
13. Nymspace [Privy wallet boundary](../../packages/privy/src/wallet.ts).
14. Agent0. [Ethereum Sepolia subgraph configuration](https://github.com/agent0lab/subgraph/blob/main/config/networks/eth-sepolia.json). Retrieved configuration; not an onchain audit.
15. ENS Domains. [ENS CLI README](https://github.com/ensdomains/ens-cli). Experimental preview, resolution and unsigned calldata capabilities.
16. ENS. [Registry Hierarchy](https://docs.ens.domains/ensv2/registry-hierarchy). Canonical hierarchy, resolver inheritance, subtree reassignment and namespace aliasing.

