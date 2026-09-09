## Why

The golden path in `docs/02_PRODUCT_FLOW.md` starts at "Owner clicks `Create Agent`". Nothing in the product implements that click.

Everything after it is built. `apps/web/app/console/agents/[id]/page.tsx` renders identity, manifest, the live authority matrix and the ENSIP 25 verdict; `discover-form.tsx` runs the Graph query with its evidence drawer; `task-request.tsx` carries the payment and the policy denial. The console can inspect and prove. It cannot create.

The creation logic is not missing either. `scripts/provision-fleet.ts` does the whole sequence — register the subname, attach the resolver, write `agent-context`, grant `SET_TEXT` per record key, read the authority back — and it is idempotent by construction: every step reads chain state before it spends. It runs from a terminal, against a hardcoded three-agent list, with output nobody outside the terminal sees.

So the gap is one screen and one route, over logic that already works. Flow 1 exists as a script; Flows 2 through 5 exist as product.

## What Changes

- **`POST /v1/agents`** on `apps/api`: create an agent under the configured parent, organization-signed, idempotent. Accepts label, role, controller address, and endpoints. Returns the agent id immediately; provisioning continues server-side.
- **`GET /v1/agents/:id/provisioning`**: the five tracks plus the ordered steps taken so far, each with its transaction hash and its read-back value. No new table — steps are the activity events the provisioning path already records (`agent.created`, `ens.resolver.attached`, `ens.record.updated`, `ens.permission.granted`).
- **A provisioning module** in `apps/api` (or `@nymspace/ens`), extracted from `scripts/provision-fleet.ts` so the script and the route run the same code rather than two copies that drift.
- **`/console/new`** in `apps/web`: the form, then the streamed step list on the same page, then the five-track footer and a link to the inspector. Astryx components and the console's `Frame`/`Field` vocabulary, per `apps/web/AGENTS.md`.
- **Fleet empty state** gains the create action, so an empty console has a front door.

## Capabilities

### Modified Capabilities

- `api-server`: gains agent creation. Two requirements the existing routes do not state: creation is idempotent against chain state, so a re-post after a partial failure repairs rather than duplicates or reverts; and no step is reported complete on a submitted transaction, only on a read-back.
- `agent-console`: gains Screen 0, the create flow. The screen renders provisioning as five independent tracks, never as one pipeline — `packages/store/src/schema.ts` already says an agent with a verified binding and no wallet is not failed, it is financially unprovisioned, and a linear progress bar would contradict that.
- `ensv2-authority`: fleet provisioning moves from a script's hardcoded list to a parameterised call. The grant policy does not change: the controller receives `SET_TEXT` on named record keys only, and never registry authority or the ENSIP 25 key.

## Impact

- **No wallet connect.** `apps/web` has no wagmi, no viem, no connector, and every existing write route is signed server-side by the organization or controller key. Creation follows them. See design D1.
- **New**: one route pair, one provisioning module, one page, one client component.
- **Modified**: `scripts/provision-fleet.ts` becomes a caller of the shared module; `apps/web/lib/api.ts` gains two typed functions; the fleet empty state gains an action.
- **No new dependencies, no schema change, no new environment variables.**
