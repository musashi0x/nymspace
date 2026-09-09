## Purpose

Separate the two authorities that write to ENSv2. The agent controller signs on
the server so it can act unattended; the organization signs in a human's wallet
so a grant or a revocation is an act by a person rather than by a key in a file.

## Requirements

### Requirement: Organization writes are prepared unsigned

The API SHALL be able to produce an organization-authority transaction without
signing it, and SHALL do so without requiring an organization private key to be
configured.

#### Scenario: A grant is prepared with no key configured
- **WHEN** `ENSV2_ORGANIZATION_PRIVATE_KEY` is unset and a client requests a
  prepared grant for an agent and record key
- **THEN** the response MUST contain `to`, `data` and `chainId` sufficient to
  submit the transaction, and MUST NOT contain a signature, a transaction hash,
  or any key material

#### Scenario: The prepared call targets the resolver
- **WHEN** a grant or revoke is prepared
- **THEN** `to` MUST be the configured Permissioned Resolver and `data` MUST
  encode `authorizeTextRoles` with the DNS-encoded name, the record key, the
  controller, and the boolean, matching the arguments the server-signed path
  would have used

### Requirement: The browser verifies the account before signing

The web application SHALL compare the connected account against the
organization address and SHALL surface a mismatch before any signature is
requested.

#### Scenario: A wallet connected as the wrong account
- **WHEN** the connected account differs from the organization address
- **THEN** the interface MUST say so and MUST NOT offer to sign, rather than
  letting the contract refuse after a signature and a gas cost

#### Scenario: A wallet connected on the wrong chain
- **WHEN** the wallet's chain is not the configured chain
- **THEN** the interface MUST request the switch and MUST NOT submit until the
  wallet reports the expected chain

### Requirement: Both signing paths remain available

The server-signed path SHALL continue to work where an organization key is
configured, so the unattended demo and existing scripts are unaffected.

#### Scenario: A key is configured
- **WHEN** `ENSV2_ORGANIZATION_PRIVATE_KEY` is set
- **THEN** `POST /v1/agents/:id/permissions` MUST behave as before, signing on
  the server and returning a transaction hash

#### Scenario: No key is configured
- **WHEN** the key is unset and a client calls the server-signed route
- **THEN** the response MUST be a 503 naming the missing variable and pointing
  at the prepare route, rather than a 500

### Requirement: The signer is recorded

Activity SHALL distinguish a write signed by a connected wallet from one signed
by a server-held key.

#### Scenario: A wallet-signed revocation is logged
- **WHEN** a revocation is submitted from a connected wallet
- **THEN** the recorded event MUST identify the signing account and that it was
  wallet-signed, so the log cannot later be read as though the server acted
