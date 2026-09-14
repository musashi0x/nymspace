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

The mapping above describes code that exists and is tested. Gate C proves the
policy half of it against a live Privy account; the per signer split has not
been proven live yet, and the table says which is which.

Gate C ran on 2026 09 09 and passed 10 of 10 assertions
(`packages/privy/evidence/gate-c.json`). Every value below is copied from that
file. Both hashes were rechecked on Base Sepolia on 2026 09 14: each is a
successful transfer from the wallet to the organization.

| Fact | Value |
| --- | --- |
| Wallet | `0x310207D93403aE037ee2DF7812d69d58D112C1ca`, Privy id `r9zlhocwx0167ahb12so428a`, bound to `agent-research` on Base Sepolia (`eip155:84532`) |
| Policy | `p8ep2ucnuqvkpylmsu31koh0`, "nymspace research max transfer": native transfers capped at 0.001 ETH (`1000000000000000` wei) |
| Payment inside the limit | 0.0001 ETH to the organization `0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9`, executed: `0x8fb1d4f69a5ab5a01b63a402a25079ca99e66c37d6649a8acaaf28a2916f50e6` |
| Payment over the limit | 0.01 ETH, same wallet and recipient: `denied`, "RPC request denied due to policy violation". No hash, because nothing was broadcast |
| Raise, then restore | Limit raised to 0.011 ETH: the identical request executed, `0x5eb3923cd3d2e04e531dc64a03c0e32a2c578ff4e80478dfa8accaf17dba61a8`. Limit restored to 0.001 ETH: denied again |
| Tampered client limit | A client side preview said within limit; Privy still returned denied |
| Policy change from the agent's path | Unauthenticated policy mutation returned HTTP 400; the limit stayed at 0.001 ETH |
| Treasury screen | Reads the live policy limit for any agent with a mapped wallet; an agent without one shows `no_wallet` |
| Per signer split | `pnpm provision:signers` exists, but no evidence file records its signer or key quorum ids. Not claimed live |

When `provision:signers` runs against the live account, add its signer ids and
key quorum id to this table. Until then the last row stays as it is, because a
submission that overstates this is worse than one that is short.

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
