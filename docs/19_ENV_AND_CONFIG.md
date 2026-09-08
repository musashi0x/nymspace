# Environment and Configuration

## Principle

Keep all changing testnet addresses and provider IDs outside application logic.

## Example environment file

```bash
# App
NEXT_PUBLIC_APP_NAME=Nymspace
NEXT_PUBLIC_PARENT_ENS_NAME=example.eth
NEXT_PUBLIC_CHAIN_ID=11155111

# Sepolia
SEPOLIA_RPC_URL=
NEXT_PUBLIC_SEPOLIA_RPC_URL=

# ENSv2
ENSV2_ROOT_REGISTRY_ADDRESS=
ENSV2_ETH_REGISTRY_ADDRESS=
ENSV2_PARENT_REGISTRY_ADDRESS=
ENSV2_PERMISSIONED_RESOLVER_ADDRESS=
ENSV2_UNIVERSAL_RESOLVER_ADDRESS=
ENSV2_VERIFIABLE_FACTORY_ADDRESS=

# ERC 8004
ERC8004_IDENTITY_REGISTRY_ADDRESS=
ERC8004_REPUTATION_REGISTRY_ADDRESS=
ERC8004_VALIDATION_REGISTRY_ADDRESS=

# The Graph
GRAPH_API_KEY=
GRAPH_AGENT0_SEPOLIA_SUBGRAPH_ID=
GRAPH_AGENT0_BASE_SEPOLIA_SUBGRAPH_ID=

# Privy
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_AUTHORIZATION_KEY_ID=
PRIVY_AUTHORIZATION_PRIVATE_KEY=
PRIVY_POLICY_ID=

# Demo
DEMO_ALLOWED_PAYMENT_AMOUNT=
DEMO_DENIED_PAYMENT_AMOUNT=
DEMO_PAYMENT_TOKEN_ADDRESS=
DEMO_PAYMENT_RECIPIENT=
```

## Rules

### Public variables

Only expose variables prefixed for the browser when they are safe.

Good:

* chain ID
* public app ID
* contract addresses
* public subgraph metadata

Bad:

* Graph secret API token if provider expects it to remain private
* Privy app secret
* authorization private key
* server signing keys

## Contract config object

Create one typed config module.

```ts
export const chainConfig = {
  chainId: 11155111,
  ensv2: {
    rootRegistry: process.env.ENSV2_ROOT_REGISTRY_ADDRESS!,
    ethRegistry: process.env.ENSV2_ETH_REGISTRY_ADDRESS!,
    parentRegistry: process.env.ENSV2_PARENT_REGISTRY_ADDRESS!,
    universalResolver: process.env.ENSV2_UNIVERSAL_RESOLVER_ADDRESS!,
  },
  erc8004: {
    identityRegistry: process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS!,
  },
}
```

## Startup validation

Fail fast on missing required configuration.

Examples:

* Missing Sepolia RPC
* Missing ENSv2 parent registry
* Missing Graph subgraph ID
* Missing Privy secret when financial routes are enabled

Do not discover a missing environment variable during the demo.

## Demo configuration

Have a single safe demo config endpoint:

```text
GET /api/config/demo
```

May return:

* parent name
* chain ID
* public contract addresses
* demo token symbol

Must never return secrets.
