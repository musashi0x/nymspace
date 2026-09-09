## Context

`docs/02_PRODUCT_FLOW.md` Flow 1 and `docs/11_FRONTEND_STATE_MACHINE.md` "Create agent wizard" describe a six-state wizard whose second state is `registry_transaction` and whose first instruction is "confirm wallet is connected to Sepolia". That description predates the implementation. The console that exists signs nothing in the browser.

## Decisions

### D1 — Provisioning is organization-signed on the server. No wallet connect.

`apps/web/package.json` has no wagmi, no viem, no connector library. `POST /v1/agents/:id/permissions` signs with the organization key; `POST /v1/agents/:id/records` signs with the controller key, deliberately, so the write proves the controller's own reach. Creation joins them.

The alternative — connect a wallet so the owner signs four transactions — is truer to the "owner does this" story and costs a connector, a chain guard, a signature-rejection state, and a second write path that contradicts every route already shipped. It also buys less than it looks: the delegation claim is proved by `permission-proof.tsx`, which shows a controller succeeding on a permitted key and reverting on a protected one. Who pressed the button is not the claim.

Consequence for the UI: the wizard's `registry_transaction` state is not a wallet-confirmation state. It is a server step with a transaction hash.

### D2 — `POST /v1/agents` is idempotent, and a re-post is a repair.

`scripts/provision-fleet.ts` checks chain state before every spend: `findOwner` before `registerSubname`, `getResolver` before `setResolver`, `readText` before `writeText`. That is the property that makes a half-provisioned fleet recoverable, and it is the property the route must keep. Posting the same label twice does not create a second agent and does not revert; it re-reads, skips what is already on chain, and completes what is not.

The screen shows skipped steps as "already on chain, no spend" rather than hiding them. Idempotency the operator cannot see is indistinguishable from a silent no-op.

### D3 — Progress is the activity log. No new table.

The provisioning path already records typed events with transaction hashes and evidence: `agent.created`, `ens.resolver.attached`, `ens.record.updated`, `ens.permission.granted`, and `ens.action.denied` for a failure. `agent_provisioning` already holds the five tracks. Between them, the step list is a read, not a new persistence concern.

This also survives a refresh and a server restart, which a stream held in component state does not. `docs/13_TEST_PLAN.md`'s restart test applies here for free.

### D4 — 202 and poll, not SSE.

`POST` writes the store row, starts provisioning, and answers with the agent id. The screen polls `GET /v1/agents/:id/provisioning` until every track has left its initial value or a step reports `denied`/`failed`. A stream would be fewer requests and one more failure mode (a dropped connection mid-provision looks identical to a stalled provision), and the events are already durable, so a reconnect has nothing to replay from that a poll does not read.

### D5 — Complete means read back, per `docs/02` Flow 1.

A step row carries the write and the read: transaction hash, then the value re-read from chain. The screen does not show the name as `Active` on a submitted transaction. `identityStateFrom()` in `apps/web/lib/console/state.ts` already encodes the rule — a name with no resolver, no MCP record, or an unverified binding is `partial` — and the create screen ends by handing off to it rather than declaring its own success.

### D6 — Five tracks, never one bar.

`packages/store/src/schema.ts` states it: the tracks are independent, and an agent with a verified ENSIP 25 binding and no wallet is not failed. The footer shows `ens erc8004 ensip25 graph financial` with their own states. Creation advances `ens` and leaves four open. A progress bar would tell the operator the agent is 20% done, which is a sentence the data does not support.

### D7 — One implementation, two callers.

The step sequence moves into a module both the route and `scripts/provision-fleet.ts` call. Leaving the script as the only implementation and re-typing it in a handler produces two provisioning paths whose behaviour diverges on the first fix, and the script is the one with the idempotency already proved.

## Risks

- **Long request, no user.** Four transactions on Sepolia take longer than a browser will wait, which is why D4 returns early. If the process dies mid-provision the store shows the tracks reached and the events recorded, and D2 makes the retry safe.
- **Label collision.** Two operators creating `research` at once: the second read sees an owner and skips registration, then writes records to a name it does not control. The route rejects a label whose on-chain owner is neither absent nor the organization.
- **Grant scope drift.** The grant list is per record key. Passing keys from the request body without an allowlist would let a caller delegate the ENSIP 25 key, which is the one grant `docs/02` Flow 4 forbids. The request names endpoints, not keys; the module derives keys.
