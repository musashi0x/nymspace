# Sponsor Qualification Mapping

Checked against current ETHOnline 2026 prize information on 2026 09 08.

Always recheck the event page before submission.

## ENS

Target:

`Best Use of ENSv2`

### Sponsor requirement

Project must be built on ENSv2 on Sepolia.

ENSv2 must be central, not cosmetic.

Demo must be functional.

Values must not be hardcoded.

Source code must be public.

Video or live demo required.

### Nymspace proof

| Requirement | Implementation |
| --- | --- |
| ENSv2 Sepolia | Agent namespace deployed and read on Sepolia |
| Hierarchical structure | Parent organization plus agent subnames |
| EAC central | Agent controller gets record specific rights |
| Permissioned Resolver | Agent Manifest records stored and delegated |
| Functional | Controller writes MCP record |
| Non cosmetic | Controller cannot cross authority boundary |
| No hardcoded state | Permission matrix read from contracts |
| Agent bonus direction | Agents are subnames with identity and permissions |

### Strong judge moment

Allowed MCP write followed by denied protected write.

## The Graph

Target:

`Best AI Tooling or AI Use Case with The Graph`

### Sponsor requirement

Use The Graph as load bearing.

Consume live data from a Graph provider.

Do meaningful reasoning, decisions, automation, or natural language work with the data.

Public repository.

Short demo video.

Choose the correct build pool.

### Nymspace proof

| Requirement | Implementation |
| --- | --- |
| Load bearing | Discovery cannot rank agents without Agent0 |
| Live provider | Server queries Agent0 via Graph gateway |
| AI work | Natural language intent becomes live candidate ranking |
| Evidence | Graph fields shown in discovery evidence drawer |
| Downstream action | Selected agent is used in task and payment flow |

## The Graph standardized products stretch

Target:

`Best Use of Composable or Standardized Graph Products`

Do not assume eligibility from one Agent0 query.

The stronger implementation:

* Same Agent0 schema queried across Ethereum Sepolia and Base Sepolia.
* Same selection pipeline operates over both.
* UI shows how schema reuse makes cross network discovery simple.

Only claim this track if the current rules and final implementation clearly satisfy the standardization requirement.

## Privy

Target:

`Best B2B financial product`

### Sponsor requirement

Integrate Privy as core.

Use at least one Privy wallet.

Show business or organization use case.

Implement one B2B workflow such as payment or approval.

Use at least one Privy control such as policy, signer, key quorum, or intent.

Working demo and source code.

### Nymspace proof

Every row below names one arrangement, never a choice between two. A table
reading "wallet **or** organization wallet" tells a judge which options were
available, not which one they are looking at.

| Requirement | What Nymspace does | Where |
| --- | --- | --- |
| Privy core | Server wallets over the REST API at `api.privy.io/v1`, no SDK and no browser key. Payments, policy reads and escalation all run through it | `packages/privy/src/wallet.ts` |
| Wallet | An organization owned wallet, bound to one agent in `financial_authority` and created already governed — `createWallet({ policyIds })`, never create then attach. The schema is per agent; the script provisions one | `scripts/provision-wallet.ts` |
| B2B | An organization operates a fleet; each agent is a restricted signer on a wallet the organization owns, never a keyholder | `docs/08_PRIVY_INTEGRATION.md` |
| Workflow | Two, both reachable from the console: an agent service payment, and wallet administration across the fleet | `POST /v1/agents/:id/payments`, `GET /v1/treasury` |
| Control | Four, not one: a transfer limit policy, a key quorum, per signer `override_policy_ids`, and ECDSA P 256 authorization signatures over RFC 8785 canonical JSON | `wallet.ts` `createKeyQuorum`, `authorization.ts` `authorizationSignature` |
| Functional | The same request executes under a raised limit and is refused under the seeded one. Both answer HTTP 200; the refusal is a product state | `pnpm --filter @nymspace/privy verify:policy` |

### Provisioning state

The mapping above describes code that exists and is tested. It is not yet a
claim about a live Privy account, and the difference matters more than the
table does.

| Fact | Status |
| --- | --- |
| Privy client, policy reads, payment and escalation paths | Written, unit tested |
| Treasury screen reading live policy limits | Written; reads `no_wallet` for every agent today |
| A provisioned wallet with a seeded policy | **Not yet run** — `pnpm provision:wallet` needs the four `PRIVY_*` credentials |
| Gate C evidence file | **Not yet produced** — `packages/privy/evidence/gate-c.json` |
| Executed and refused transaction hashes | **Not yet obtained** |

Fill the second table in with the wallet address, the policy id and its limit,
the two signer ids and both transaction hashes once the scripts have run. Until
then it says so, because a submission that overstates this is worse than one
that is short.

## Build category warning

The Graph from scratch and continuity pools have different rules.

If reusing project specific code from an earlier repository, verify whether the chosen pool allows it.

Open source starter code is not the same as project specific prior work.

Document any reused prior code before submission.

## Submission checklist

* Public repository
* Clear README
* Architecture diagram
* Two to four minute demo where required
* ENSv2 Sepolia evidence
* Live Graph provider evidence
* Privy live control evidence
* Correct partner prize selections
* Correct build pool
* No secrets committed
