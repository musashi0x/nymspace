## 1. Extract the provisioning module

- [x] 1.1 Move the per-agent step sequence out of `scripts/provision-fleet.ts` into a module exporting `provisionAgent({ label, role, description, controller, endpoints })`, returning the ordered steps it took
- [x] 1.2 Keep every read-before-spend guard: `findOwner` before `registerSubname`, `getResolver` before `setResolver`, `readText` before `writeText`, `permissionsFor` before `authorizeTextRole`
- [x] 1.3 Derive record keys inside the module from the endpoint names (`agentEndpointKey`, `AGENT_CONTEXT_KEY`). The caller never passes a raw key — design D7 and the risk it closes
- [x] 1.4 Reject a label whose on-chain owner is neither the zero address nor the organization
- [x] 1.5 Rewrite `scripts/provision-fleet.ts` to loop its three-agent list over the module. Output unchanged
- [x] 1.6 Unit tests with a fake `ChainClient`: fresh label provisions; re-run of a fully provisioned label spends nothing and reports every step skipped; a label owned by a third party is rejected

### Deviations recorded during group 1

- The optional `web` endpoint is dropped. `agentEndpointKey` names `mcp` and `a2a`, the manifest assembles those two, and the inspector renders those two; a third key would be written and never read. `EndpointProtocol` is now derived from the key function, so widening the package widens this module.
- `agent.created` is recorded by the provisioning module at registration, not by the route before it. The event carries the registration transaction as its evidence, and an event recorded before the transaction exists would have none. Task 2.3 is adjusted accordingly.
- `@nymspace/store` was missing from `apps/api/package.json` while `deps.ts` imported it; it resolved through the workspace root. Added, since this change adds a second importer.

## 2. The routes

- [x] 2.1 `POST /v1/agents` on `apps/api/src/routes/agents.ts`, chained inline with `@hono/zod-validator`, dependencies from `c.var.deps` — the file's existing pattern, per `CLAUDE.md`
- [x] 2.2 Body: label, name, role, description, controller address, `endpoints: { mcp, a2a?, web? }`. Validate the label against the same local rule the script uses
- [x] 2.3 Write the agent and its `INITIAL_PROVISIONING` row, record `agent.created`, answer 202 with the agent id before provisioning finishes
- [x] 2.4 Run `provisionAgent` after responding; record each step as its typed activity event with `txHash` and evidence; advance the `ens` track through `setProvisioning`
- [x] 2.5 On revert, record `ens.action.denied` through `describeDenial` and leave the tracks where they stopped. A denial is a state, not a 500
- [x] 2.6 `GET /v1/agents/:id/provisioning`: the five tracks, the ordered steps with hash and read-back value, and `readAt`
- [x] 2.7 Route tests against `app.ts` with injected fakes: create returns 202; re-create the same label repairs and does not duplicate; a reverting grant yields `denied`, not a thrown error

## 3. The screen

- [ ] 3.1 `apps/web/app/console/new/page.tsx` — static copy plus the client form, the shape `discover/page.tsx` already uses
- [ ] 3.2 `apps/web/components/console/create-agent.tsx`, `"use client"`. Astryx only: `VStack`, `Grid`, `TextInput`, `Button`, `Text`, plus `Frame`/`Field`/`Outcome`/`Loading` from `./primitives`. No raw `div`, no `style`, no literal colours or pixels — `apps/web/AGENTS.md`
- [ ] 3.3 Fields: label with the parent suffix rendered beside it, display name, role, controller address, MCP endpoint, optional A2A and web
- [ ] 3.4 On submit, POST then poll `GET /v1/agents/:id/provisioning`. Stop when no track is still initial, or a step reports denied or failed
- [ ] 3.5 Step rows show what, the transaction hash, and the value read back. Skipped rows read "already on chain, no spend" — design D2
- [ ] 3.6 Footer renders all five tracks with their own states. No aggregate percentage, no single bar — design D6
- [ ] 3.7 Completion hands off: link to `/console/agents/[id]`, which decides `active` versus `partial` from chain reads. The create screen never prints `Active` itself — design D5
- [ ] 3.8 Denial and failure use `Outcome` and the console's error taxonomy, never a generic failure message
- [ ] 3.9 Two typed functions in `apps/web/lib/api.ts` (`createAgent`, `fetchProvisioning`), each checking `res.ok` inline, per the file's note on Hono's response union
- [ ] 3.10 Fleet empty state in `apps/web/app/console/page.tsx` links to `/console/new`; add the action to the console nav

## 4. Gate

- [ ] 4.1 `pnpm typecheck`, `pnpm lint`, `pnpm test`
- [ ] 4.2 Create an agent against Sepolia from the screen and confirm the inspector reads it back: resolver set, `agent-context` present, controller granted on the endpoint keys only
- [ ] 4.3 Re-post the same label and confirm every step reports skipped and no transaction is sent
- [ ] 4.4 Reload mid-provision and confirm the step list rebuilds from the activity log — design D3
- [ ] 4.5 Confirm the created agent's controller is denied the ENSIP 25 key in the permission proof
