# System Architecture

## High level

```text
              apps/web :3111              apps/api :3112
              Next.js                     Hono
                    |                           |
                    +-------------+-------------+
                                  |
                   packages/*  (domain logic, one implementation)
                                  |
   +------------+---------------+------------+------------+-----------+
   |            |               |            |            |           |
EnsService  Erc8004Service  Agent0Client  rankAgents  PrivyClient   Store
@/ens       @/ens           @/graph       @/graph     @/privy       @/store
   |            |               |            |            |           |
ENSv2       ERC 8004        Agent0        Gemini      Privy        Postgres
Sepolia     Base Sepolia    subgraph      2.5-flash   server       coordination
11155111    84532           via The       ranking     wallet       state only
                            Graph                     + policy
                            Gateway

@nymspace/github -> GitHub REST, revalidated every 60s, mounts no Deps
```

**Amended 2026-09-09.** The block above replaces one that put ERC 8004 on
Sepolia. It is on Base Sepolia 84532: `apps/api/src/deps.ts` builds a second
viem client for that chain, and the registration transaction in `README.md` is
a Base Sepolia hash. The two ENSv2 proxies stay on Sepolia 11155111.

## Suggested stack

### Frontend

* Next.js
* React
* TypeScript
* viem
* wallet connection of choice
* lightweight component library already familiar to the team

### Backend

* Next.js route handlers or a small Node service
* TypeScript
* viem public client
* GraphQL fetch client
* Privy server SDK or REST client
* optional LLM provider for discovery reasoning

Do not introduce a separate backend framework unless required.

**Amended 2026-09-08 by the `add-api-server` change.** It was required, and a
Hono service now runs at `apps/api`. Note the allowance above already covered
it: "Next.js route handlers **or a small Node service**". What changed is which
half of that sentence the product uses.

The caution still holds for the next framework, so here is the reasoning that
cleared this one:

* Hono is web-standard `Request`/`Response`, the same primitives Next route
  handlers use, so a handler moves between the two without a rewrite. It is not
  a second programming model.
* No domain logic lives in either server. Every integration sits in a package
  both import, so collapsing back to one server is deleting `apps/api` and
  restoring one route file — not a migration.
* The cost is real and was accepted, not argued away: two deploy targets and two
  environment surfaces.

The `monorepo-workspace` capability was amended in step. Its requirement "The
web application is the only server" is replaced by "Domain logic has one
implementation across servers", which keeps the constraint that mattered and
drops the server count, which never did.

## Service boundaries

**Amended 2026-09-09.** This section previously carried four proposed
interfaces — `EnsService.createAgent`, `getAgentIdentity`, `getPermissions`,
`grantAgentRecordPermissions`, `setAgentRecord`, `verifyEnsip25`,
`AgentGraphService.getAgent`, `FinancialAuthorityService.previewPayment` and
`executePayment`. None of those method names were ever implemented. What
follows is read off the classes that exist, so it is a reference rather than a
proposal, and it names eight roles rather than four.

Two rules hold across all of them. Domain logic lives only in `packages/*`, so
a handler that wants an answer imports a service rather than reimplementing it.
And `apps/api/src/deps.ts` is the only place any of these is constructed, which
is what stops a route acquiring a credential or deriving an EAC resource of its
own.

`diagram/workflow.png` renders this section as a picture, including which
service answers each endpoint.

### The dependency seam

`apps/api/src/deps.ts`.

Responsibilities:

* Construct every chain client, store, and provider client — the only place that does
* Cache that construction across requests, so no connection pool is opened per request
* Run `migrate()` once per process
* Deliver the container as Hono middleware, so `c.var.deps` is typed and a test mounts fakes instead of arranging process state
* Hold `ORGANIZATION_ID` (`"nymspace"`) and `REGISTRATION_CHAIN_ID` (`84532`)

```ts
interface Deps {
  store: Store;
  ens: EnsService;
  erc8004: Erc8004Service;
  graph: Agent0Client;
  privy: PrivyClient;
  chain: ViemChainClient;
  config: ChainConfig;
  organization: Address;
  controller: Address;
  resolver: Address;
  registry: Address;
}
```

Five of those twelve fields are services; the rest is chain configuration and
addresses. `/health` deliberately does not mount the middleware: a liveness
check that needs an RPC and a database to answer is reporting their health
rather than its own.

`rankAgents` is the exception to the seam. It is imported directly by
`apps/api/src/routes/discover.ts` rather than injected, so it is the one
service dependency a test cannot swap by mounting its own middleware.

### ENS service — `EnsService`

`packages/ens/src/ens-service.ts`. Takes a chain-client port and never holds
key material itself; `as` selects which configured key signs.

Responsibilities:

* Read and write ENSIP 26 text records
* Grant and revoke EAC roles at record scope
* Answer whether a given account may write a given record
* Register agent subnames and read registry ownership
* Wire subregistries and resolvers
* Return transaction hashes and receipts as evidence

```ts
class EnsService {
  // records
  readText(name: string, key: string): Promise<string>;
  writeText(params: {
    name: string; key: string; value: string;
    as?: "organization" | "controller";
  }): Promise<Hex>;

  // EAC grants and checks
  authorizeTextRole(params: {
    dnsName: Hex; key: string; controller: Address; authorized: boolean;
  }): Promise<Hex>;
  canSetText(name: string, key: string, account: Address): Promise<boolean>;
  canDelegateText(name: string, account: Address): Promise<boolean>;
  rolesFor(target: EacResource, controller: Address): Promise<bigint>;
  resolverHasRoles(resource: bigint, roles: bigint, account: Address): Promise<boolean>;
  resolverRolesAt(resource: bigint, account: Address): Promise<bigint>;
  registryHasRoles(params: {
    registry: Address; resource: bigint; roles: bigint; account: Address;
  }): Promise<boolean>;
  registryResource(registry: Address, tokenId: bigint): Promise<bigint>;

  // permission inspection
  permissionsFor(params: {
    name: string; label: string; controller: Address; recordKeys: string[];
  }): Promise<AgentPermissions & { readAt: string }>;
  delegatedKeys(params: {
    name: string; controller: Address; fromBlock?: bigint | "earliest";
  }): Promise<{ key: string; granted: boolean }[]>;

  // registry
  registerSubname(params: {
    registry: Address; label: string; owner: Address; subregistry: Address;
    resolver: Address; roleBitmap: bigint; expiry: bigint;
  }): Promise<Hex>;
  canRegister(registry: Address, account: Address): Promise<boolean>;
  getSubregistry(registry: Address, label: string): Promise<Address>;
  setSubregistry(params: {
    registry: Address; tokenId: bigint; subregistry: Address;
  }): Promise<Hex>;
  getResolver(registry: Address, label: string): Promise<Address>;
  setResolver(params: {
    registry: Address; tokenId: bigint; resolver: Address;
    as?: "organization" | "controller";
  }): Promise<Hex>;
  findOwner(registry: Address, label: string): Promise<Address>;
  findTokenId(registry: Address, label: string): Promise<bigint>;

  // plumbing
  deployProxy(params: { implementation: Address; salt: bigint; initData: Hex }): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<ChainReceipt>;
}
```

### ERC 8004 service — `Erc8004Service`

`packages/ens/src/erc8004.ts`. Base Sepolia 84532, with its own viem client on
a separate RPC and the same two keys.

Responsibilities:

* Register an agent against the ERC 8004 IdentityRegistry
* Read the registration URI, owner, and registration file
* Answer whether a registration claims a given ENS name — the ENSIP 25 binding read

```ts
class Erc8004Service {
  register(params: {
    file: RegistrationFile;
    as?: "organization" | "controller";
  }): Promise<Erc8004Registration>;
  agentURI(agentId: string | number | bigint): Promise<string>;
  ownerOf(agentId: string | number | bigint): Promise<Address>;
  registrationFile(agentId: string | number | bigint): Promise<RegistrationFile | undefined>;
  claimsEnsName(
    agentId: string | number | bigint,
    ensName: string,
  ): Promise<{ claims: boolean; claimed?: string }>;
}
```

A private `waitUntilReadable` sits behind `register`, because a registration is
not done when its transaction lands — it is done when the registry will read it
back.

### Graph service — `Agent0Client`

`packages/graph/src/client.ts`, plus the search and normalisation helpers in
`packages/graph/src/discovery.ts`.

Responsibilities:

* Query the live Agent0 subgraph through The Graph Gateway
* Filter for MCP-compatible agents
* Fetch a full agent profile
* Carry `feedback(first: 100)` and `validations(first: 100)` in the query, so trust state arrives with the agent
* Normalise results for the reasoning layer, preserving absence — a missing endpoint or claim is never read as a zero
* Record which endpoint and chain produced the result
* Report the indexing head, so a stale subgraph is distinguishable from an empty market

```ts
class Agent0Client {
  searchAgents(options?: {
    requireMcp?: boolean; first?: number; skip?: number;
  }): Promise<NormalisedAgent[]>;
  agentProfile(graphAgentKey: string): Promise<NormalisedAgent | undefined>;
  indexingHead(): Promise<{ blockNumber: number; hasIndexingErrors: boolean }>;
  subgraphId(): string;
  provenance(queriedAt?: string): GraphProvenance;
}

function searchAgent0(params?: SearchAgent0Params, client?: Agent0Client): Promise<SearchAgent0Result>;
function searchAgent0Cached(params: SearchAgent0Params, options: { client: Agent0Client; refresh?: boolean }): Promise<SearchAgent0Result>;
```

`Agent0ProviderError` is the outage signal, and the route turns it into a 502
rather than an empty result list: "no agents matched" and "we could not ask"
are different answers, and a caller that cannot tell them apart renders an
outage as a market with nothing in it.

### Discovery agent — `rankAgents`

`packages/graph/src/ranking.ts` and `packages/graph/src/discovery.ts`.
`RANKING_MODEL` is `"gemini-2.5-flash"`, keyed by `GEMINI_API_KEY`.

Responsibilities:

* Convert a natural-language request into selection criteria
* Rank the candidates the Graph search returned
* Produce a concise explanation grounded only in returned fields
* Validate every citation in that explanation against `CITABLE_FIELDS`

Must not:

* Invent reputation
* Invent capabilities
* Use static demo agent metadata when live data is available

```ts
function rankAgents(
  request: string,
  candidates: NormalisedAgent[],
  options?: RankAgentsOptions,
): Promise<RankingResult>;

function validateExplanation(
  ranked: RankedAgent[],
  candidates: NormalisedAgent[],
): ValidationOutcome;

function validationReachesModel(agent: NormalisedAgent): boolean;
function buildLogEntry(params: { /* query, search, ranked, validation, durationMs */ }): unknown;
```

A ranking failure is not a request failure. `RankingProviderError` degrades the
response to an unranked candidate list and tells the caller the ranking is
missing, rather than showing an order nothing produced.

### Privy service — `PrivyClient`

`packages/privy/src/wallet.ts`, implementing the `PrivyWalletPort` interface.

Responsibilities:

* Create or load an agent server wallet
* Attach and read the policies that constrain it
* Read the live spend limit rather than a recorded copy of it
* Execute a payment
* Normalise a policy rejection into application state instead of discarding it

```ts
class PrivyClient implements PrivyWalletPort {
  createWallet(params: { policyIds?: string[] }): Promise<PrivyWallet>;
  getWallet(walletId: string): Promise<PrivyWallet>;
  listWallets(): Promise<PrivyWallet[]>;
  setWalletPolicies(walletId: string, policyIds: string[]): Promise<PrivyWallet>;
  createAmountPolicy(params: { name: string; maxValueWei: bigint }): Promise<PolicyLimit>;
  getPolicyLimit(policyId: string): Promise<PolicyLimit>;
  updateAmountPolicy(policyId: string, maxValueWei: bigint): Promise<PolicyLimit>;
  sendPayment(walletId: string, request: PaymentRequest): Promise<PaymentResult>;
}
```

### Coordination store — `Store`

`packages/store/src/store.ts`. See the Persistence section below for what it is
not allowed to be.

Responsibilities:

* Hold the organization and agent rows, and the local slug to ENS name mapping
* Track provisioning progress
* Cache identity, graph, and financial-authority snapshots, each with its read time
* Record every activity event, and resolve a pending one when its outcome arrives

```ts
class Store {
  upsertOrganization(org: Omit<Organization, "createdAt"> & { createdAt?: string }): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | undefined>;

  upsertAgent(agent: Omit<Agent, "createdAt" | "updatedAt">): Promise<Agent>;
  getAgent(id: string): Promise<AgentWithProvisioning | undefined>;
  getAgentBySlug(organizationId: string, slug: string): Promise<AgentWithProvisioning | undefined>;
  listAgents(organizationId: string): Promise<AgentWithProvisioning[]>;
  setProvisioning(agentId: string, patch: Partial<ProvisioningStatus>): Promise<ProvisioningStatus>;

  putIdentitySnapshot(value: AgentIdentitySnapshot): Promise<AgentIdentitySnapshot>;
  getIdentitySnapshot(agentId: string): Promise<AgentIdentitySnapshot | undefined>;
  putGraphSnapshot(value: GraphSnapshot): Promise<GraphSnapshot>;
  getGraphSnapshot(agentId: string): Promise<GraphSnapshot | undefined>;
  putFinancialAuthority(ref: FinancialAuthorityRef): Promise<FinancialAuthorityRef>;
  getFinancialAuthority(agentId: string): Promise<FinancialAuthorityRef | undefined>;

  recordEvent(event: NewActivityEvent): Promise<ActivityEvent>;
  resolveEvent(id: string, patch: { status: ActivityStatus; /* ... */ }): Promise<ActivityEvent | undefined>;
  listActivity(filter?: ActivityFilter): Promise<ActivityEvent[]>;
}
```

### Commit activity — `@nymspace/github`

`packages/github/src/github.ts`.

Responsibilities:

* Read the repository's commit history from the GitHub REST API
* Count real days from real commits, and badge what GitHub reports as signature-verified
* Serve both `/v1/github/activity` and the landing page's server render from one implementation

```ts
function getActivity(weeks?: number): Promise<ActivityPayload>;

const REPO_OWNER: string;   // GITHUB_OWNER, default "musashi0x"
const REPO_NAME: string;    // GITHUB_REPO,  default "nymspace"
const REPO_BRANCH: string;  // GITHUB_BRANCH, default the repo default
const REVALIDATE_SECONDS = 60;
```

Its route has its own Hono instance and no `DepsEnv`, so it mounts no
dependencies at all.

### Which service answers which endpoint

| Endpoint | store | ens | erc8004 | graph | privy |
| --- | --- | --- | --- | --- | --- |
| `GET /health` | | | | | |
| `GET /v1/agents` | x | | | | |
| `GET /v1/agents/:id/identity` | x | x | x | | |
| `GET /v1/agents/:id/permissions` | x | x | | | |
| `POST /v1/agents/:id/permissions` | x | x | | | |
| `POST /v1/agents/:id/records` | x | x | | | |
| `POST /v1/agents/:id/verify` | x | x | x | | |
| `GET /v1/agents/:id/wallet` | x | | | | x |
| `POST /v1/agents/:id/payments/preview` | x | | | | x |
| `POST /v1/agents/:id/payments` | x | | | | x |
| `POST /v1/discover` | x | | | x | |
| `GET /v1/activity` | x | | | | |
| `GET /v1/github/activity` | | | | | |

`POST /v1/discover` also calls `rankAgents`, which does not arrive through
`Deps`. The two rows with no marks mount no dependencies on purpose.

## Persistence

Use a minimal application database only for coordination state.

The database is not the authority for:

* ENS identity
* ENS permissions
* ERC 8004 trust state
* Privy policy enforcement

Good database fields:

* Local agent slug
* ENS name
* ERC 8004 agent ID
* Privy wallet ID
* UI labels
* Activity cache
* Creation status
* Last query timestamps

When a value can be read from the authoritative system during the demo, read it.

**Amended 2026-09-09.** Two mechanisms now enforce the paragraph above at build
time rather than by agreement:

* `ALLOWED_COLUMNS` in `packages/store/src/schema.ts` is a hand-maintained second list of every permitted column, checked against `information_schema` by `schema.test.ts`. Adding a column means editing that list on purpose, which is where "should the store hold this?" gets asked. It is deliberately not derived from the Drizzle tables, because derived it would assert the schema equals itself.
* Snapshot tables require a `NOT NULL fetched_at`, and `Snapshot<T>` is branded so `snapshot()` is the only way to build one. A cached value that reaches the interface without its read time is indistinguishable from a live read.

## Read strategy

On inspector load:

1. Read agent local mapping.
2. Read ENSv2 state.
3. Read resolver records.
4. Read EAC permission state.
5. Query Agent0.
6. Verify ENSIP 25.
7. Load Privy wallet metadata.
8. Render after independent sections resolve.

Do not block the entire page on Graph indexing.

**Amended 2026-09-09.** Where each step is served from:

| Step | Endpoint |
| --- | --- |
| 1 | `GET /v1/agents` |
| 2, 3 | `GET /v1/agents/:id/identity` |
| 4 | `GET /v1/agents/:id/permissions` |
| 5 | `POST /v1/discover` |
| 6 | `POST /v1/agents/:id/verify` |
| 7 | `GET /v1/agents/:id/wallet` |
| 8 | no request of its own |

## Write strategy

Writes should have explicit source:

### Identity write

Wallet transaction to Sepolia.

### Financial write

Privy controlled action.

### App metadata write

Database write after external transaction confirmation.

**Amended 2026-09-09.** "After confirmation" is a fixed order, and
`POST /v1/agents/:id/records` in `apps/api/src/routes/agents.ts` is the
reference implementation of it:

1. `zValidator` the body, before any service runs.
2. `store.getAgent(id)`, 404 when absent.
3. `ens.readText(key)` — capture `before`.
4. `ens.writeText({ as: "controller" })`. The controller signs, always: a write signed by the organization would succeed for every key and prove nothing about delegation.
5. `ens.waitForReceipt(hash)`.
6. `ens.readText(key)` — capture `after`.
7. `store.recordEvent(...)`. This is the first write to the database.
8. Respond with `before`, `after`, and the transaction hash.

On revert, `describeDenial(error, resolver)` classifies the failure,
`store.recordEvent` logs it as `ens.action.denied` with a zero transaction hash,
and the response is a 200 carrying the outcome. A denial is a result, not a
server error, and the zero hash is what records that nothing was ever
broadcast. Both paths write an event, so the activity log has no silent
outcomes to reconcile later.

## Event stream

All external actions are normalized into application events:

```ts
type ActivitySource = "ens" | "erc8004" | "graph" | "privy" | "app"
type ActivityStatus = "pending" | "success" | "denied" | "failed"
```

This powers a unified activity timeline without pretending all events live in one chain.

**Amended 2026-09-09.** This section was headed "Optional event stream". It is
not optional any more: both unions live in `packages/store/src/types.ts`, every
route records through `store.recordEvent`, and `GET /v1/activity` serves the
timeline.
