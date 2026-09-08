# Sources and Current Claims

Checked on 2026 09 08.

These are implementation references, not copied specifications.

Recheck before final submission because ENSv2 is beta and hackathon requirements can change.

## ENSv2

ENSv2 overview:

https://docs.ens.domains/ensv2/overview/

Permissioned Registry:

https://docs.ens.domains/ensv2/permissioned-registry/

Permissioned Resolver:

https://docs.ens.domains/ensv2/permissioned-resolver/

Enhanced Access Control:

https://docs.ens.domains/ensv2/enhanced-access-control/

Contract developer guide:

https://docs.ens.domains/ensv2/tutorial-contract-developers/

### Claims checked

* ENSv2 uses hierarchical registries.
* Permissioned Registry is the tokenized registry model.
* Permissioned Resolver supports fine grained record permission.
* EAC supports record and name scoped roles.
* Permissioned Resolver supports `authorizeTextRoles`.
* `ROLE_SET_TEXT` is the text record setter role.
* ENSv2 contracts are beta and may change before mainnet.

## ENSIP 25

https://docs.ens.domains/ensip/25/

### Claims checked

* Status is Draft.
* Verification key is `agent-registration[<registry>][<agentId>]`.
* Registry is represented as an ERC 7930 interoperable address.
* Non empty record value indicates the ENS side assertion.
* Verification starts from a registry claimed ENS name and resolves the parameterized record.

## ENSIP 26

https://docs.ens.domains/ensip/26/

### Claims checked

* Status is Draft.
* `agent-context` is standardized.
* `agent-endpoint[<protocol>]` is standardized.
* Protocol examples include `mcp`, `a2a`, and `web`.
* Endpoint values are URLs.

## The Graph Agent0

https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/

### Claims checked

* Agent0 indexes ERC 8004 identity, reputation, and validation.
* Ethereum Sepolia is deployed.
* Base Sepolia is deployed.
* Same schema is shared across deployments.
* Indexed registration data includes ENS, MCP, A2A, trust models, wallet, and x402 support where present.
* Feedback and validation data are queryable.

## ETHOnline 2026 prizes

https://ethglobal.com/events/ethonline2026/prizes

### ENS claims checked

* ENS prize requires ENSv2 Sepolia.
* ENSv2 must be central.
* Functional demo and open source code required.
* Agent namespaces and permissions are explicitly encouraged.

### The Graph claims checked

* Live Graph provider data is required.
* Static or local only data does not qualify.
* AI track requires meaningful reasoning, decisions, automation, or natural language work.
* Standardized products track requires meaningful standardization or composition, not merely one simple Subgraph query.

### Privy claims checked

* B2B product must use Privy as core.
* At least one Privy wallet is required.
* Business or organization use case is required.
* At least one B2B workflow is required.
* At least one control such as policy, signer, quorum, or intent is required.

## Privy

Policy overview:

https://docs.privy.io/controls/policies/overview

Server and user signer flow:

https://docs.privy.io/recipes/wallets/user-and-server-signers

Conditional signer policies:

https://docs.privy.io/recipes/wallets/conditional-signer-policies

Security checklist:

https://docs.privy.io/security/implementation-guide/security-checklist

### Claims checked

Privy policies can constrain actions such as:

* transfer limits
* recipient allowlists
* contract allowlists
* network restrictions
* time windows
* transaction parameters

Privy supports separating policy or wallet administration from restricted transaction signers.
