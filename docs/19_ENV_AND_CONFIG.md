# Environment and Configuration

## Principle

Keep all changing testnet addresses and provider IDs outside application logic.

`.env.example` at the repository root is the executable copy of this document —
`pnpm env:check` fails when it and `turbo.json` disagree. When the two differ,
`.env.example` is right and this file is stale.

Two kinds of address live here and the distinction matters. The ENSv2 addresses
ENS deployed are known constants, sourced from `ensdomains/contracts-v2` at the
commit `ensdomains/docs` pins for its Deployments page, and confirmed with
`eth_getCode`. `ENSV2_PARENT_REGISTRY_ADDRESS` and
`ENSV2_PERMISSIONED_RESOLVER_ADDRESS` are not blanks to fill in from a table:
they are proxies the Day 1 spike deploys, and they stay empty until it runs.

`ensdomains/namechain` also publishes Sepolia deployment sets. They are an
older deployment and every address differs. Do not mix the two.

## Example environment file

```bash
# App
NEXT_PUBLIC_APP_NAME=Nymspace
NEXT_PUBLIC_PARENT_ENS_NAME=example.eth
NEXT_PUBLIC_CHAIN_ID=11155111

# Sepolia
SEPOLIA_RPC_URL=
NEXT_PUBLIC_SEPOLIA_RPC_URL=

# ENSv2 — deployed by ENS
ENSV2_ROOT_REGISTRY_ADDRESS=0x8115186e8f2e0b0281e86ab91f0f48ba90364354
ENSV2_ETH_REGISTRY_ADDRESS=0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2
ENSV2_ETH_REGISTRAR_ADDRESS=0xa88553f454b77203b0d036a05c894d555eaaa2cc
ENSV2_UNIVERSAL_RESOLVER_ADDRESS=0x4a1817d13e9cf196f471725176355c1234b63c70
ENSV2_VERIFIABLE_FACTORY_ADDRESS=0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef
ENSV2_USER_REGISTRY_IMPL_ADDRESS=0x624a25d67b59d587752ebec8dded8827dae52050
ENSV2_PERMISSIONED_RESOLVER_IMPL_ADDRESS=0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e
ENSV2_PAYMENT_TOKEN_ADDRESS=0x768f42455a2d082e23ceef7d51e5787c82d67a39

# ENSv2 — deployed by us, outputs of the Day 1 spike
ENSV2_PARENT_LABEL=
ENSV2_PARENT_REGISTRY_ADDRESS=
ENSV2_PERMISSIONED_RESOLVER_ADDRESS=

# ENSv2 — testnet keys
ENSV2_ORGANIZATION_PRIVATE_KEY=
ENSV2_AGENT_CONTROLLER_PRIVATE_KEY=

# ERC 8004
ERC8004_IDENTITY_REGISTRY_ADDRESS=0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8004_REPUTATION_REGISTRY_ADDRESS=0x8004B663056A597Dffe9eCcC1965A193B7388713
ERC8004_VALIDATION_REGISTRY_ADDRESS=
ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS=0x8004A818BFB912233c491871b3d84c89A494BD9e

# The Graph
GRAPH_API_KEY=
GRAPH_AGENT0_SEPOLIA_SUBGRAPH_ID=6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT
GRAPH_AGENT0_BASE_SEPOLIA_SUBGRAPH_ID=4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u

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
