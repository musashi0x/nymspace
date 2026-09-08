# System Architecture

## High level

```text
                         Nymspace Web
                              |
                 +------------+-------------+
                 |                          |
                 v                          v
          App API / Agent Layer       Wallet Client
                 |                          |
      +----------+-----------+              |
      |          |           |              |
      v          v           v              v
    ENSv2     The Graph    Privy        Sepolia RPC
      |
      +--> Permissioned Registry
      |
      +--> Permissioned Resolver
      |
      +--> Enhanced Access Control
      |
      +--> ENSIP 25 / ENSIP 26 records

ERC 8004 Sepolia
      |
      v
Agent0 Subgraph
      |
      v
The Graph Gateway
```

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

## Service boundaries

### ENS service

Responsibilities:

* Resolve ENSv2 registry and resolver state
* Create or register agent subnames
* Grant and revoke EAC permissions
* Read record specific permissions
* Set and read ENSIP 26 records
* Construct and verify ENSIP 25 records
* Return transaction evidence

Suggested interface:

```ts
interface EnsService {
  createAgent(input: CreateAgentInput): Promise<TxResult>
  getAgentIdentity(name: string): Promise<EnsIdentityState>
  getPermissions(name: string, controller: Address): Promise<PermissionState>
  grantAgentRecordPermissions(input: GrantRecordPermissionsInput): Promise<TxResult[]>
  setAgentRecord(input: SetAgentRecordInput): Promise<TxResult>
  verifyEnsip25(input: VerifyEnsip25Input): Promise<VerificationResult>
}
```

### Graph service

Responsibilities:

* Query live Agent0 Subgraph
* Search MCP compatible agents
* Fetch full agent profile
* Fetch live feedback and validation state
* Normalize Graph results for the reasoning layer
* Record which endpoint and chain produced the result

```ts
interface AgentGraphService {
  searchAgents(input: AgentSearchInput): Promise<AgentCandidate[]>
  getAgent(chainId: number, agentId: string): Promise<AgentGraphProfile>
}
```

### Discovery agent

Responsibilities:

* Convert natural language request to selection criteria
* Call Graph search tool
* Rank candidates
* Produce a concise explanation grounded only in returned fields
* Optionally call ENSIP 25 verifier for ENS named candidates

Must not:

* Invent reputation
* Invent capabilities
* Use static demo agent metadata when live data is available

### Privy service

Responsibilities:

* Create or load agent wallet
* Apply or identify policy controlled signer
* Prepare payment
* Execute action
* Normalize policy rejection into application state

```ts
interface FinancialAuthorityService {
  getWallet(agentId: string): Promise<AgentWallet>
  previewPayment(input: PaymentInput): Promise<PaymentPreview>
  executePayment(input: PaymentInput): Promise<PaymentResult>
}
```

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

## Authority model

| Data | Authority |
| --- | --- |
| Name ownership | ENSv2 Registry |
| Resolver address | ENSv2 Registry |
| Text record permission | ENSv2 Permissioned Resolver EAC |
| Agent context | ENS text record |
| Agent endpoints | ENS text records |
| Agent registration binding | ENSIP 25 record plus registry claim |
| ERC 8004 feedback | ERC 8004 state indexed by The Graph |
| ERC 8004 validation | ERC 8004 state indexed by The Graph |
| Agent wallet constraints | Privy |
| UI labels | App database |

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

## Write strategy

Writes should have explicit source:

### Identity write

Wallet transaction to Sepolia.

### Financial write

Privy controlled action.

### App metadata write

Database write after external transaction confirmation.

## Optional event stream

For better UX, normalize all external actions into application events:

```ts
type ActivitySource = "ens" | "graph" | "erc8004" | "privy" | "app"
```

This powers a unified activity timeline without pretending all events live in one chain.
