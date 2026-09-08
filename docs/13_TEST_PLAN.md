# Test Plan

## Test philosophy

The core of the project is permission boundaries.

Negative tests are as important as happy path tests.

## Unit tests

### ENS record helpers

Test:

* DNS name encoding
* namehash
* ENSIP 25 record key construction
* Agent Manifest parsing
* permission bitmap helpers

### Graph normalization

Test:

* Missing MCP endpoint
* Missing ENS claim
* No feedback
* Pending validation
* Revoked feedback excluded where intended

### Discovery ranking

Use fixtures only for unit tests.

Production and demo path must query live Graph data.

Test:

* capability match
* missing trust data
* tie handling
* explanation cites available fields only

### Payment normalization

Test mapping from Privy errors to:

* denied
* pending approval
* failed

## ENS integration tests

Run on Sepolia.

### E1: Create agent name

Expected:

* registered
* owner correct
* resolver correct

### E2: Grant MCP record permission

Expected:

* controller has permission for MCP key

### E3: Controller updates MCP

Expected:

* transaction succeeds
* readback equals new value

### E4: Controller edits protected key

Expected:

* transaction reverts

### E5: Controller changes resolver

Expected:

* transaction reverts

### E6: Owner revokes MCP permission

Expected:

* subsequent controller update reverts

## ENSIP 25 tests

### I1: Valid binding

Registry claims ENS name.

ENS record exists.

Expected:

`verified`

### I2: Missing record

Expected:

`ens_record_missing`

### I3: Wrong agent ID

Expected:

`mismatch` or verification false

### I4: Ownership or association changed

Recheck live.

Expected:

Do not reuse cached verified result.

## Graph integration tests

### G1: Live query

Query Agent0 on Ethereum Sepolia.

Expected:

HTTP and GraphQL success.

### G2: Demo agent indexed

Expected:

Registration returned.

### G3: Full profile

Expected:

Registration file and available trust fields normalized.

### G4: No static fallback

Disable Graph access.

Expected:

UI shows provider error, not fake agent score.

## AI discovery E2E

Prompt:

`Find a trustworthy research agent with MCP support`

Expected:

* Graph queried
* live candidates returned
* rank explanation generated
* selected result has evidence
* ENS verification attempted where applicable

## Privy tests

### P1: Wallet exists

Expected:

* wallet ID
* address

### P2: Allowed payment

Expected:

* transaction executes

### P3: Disallowed payment

Expected:

* Privy policy denies or requires stronger authorization

### P4: Frontend tampering

Change displayed limit locally.

Expected:

Privy enforcement remains unchanged.

## Restart test

Purpose:

Prove the app is not dependent on in memory demo state.

Steps:

1. Complete agent setup.
2. Stop server.
3. Restart.
4. Open agent inspector.
5. ENS state reloads.
6. Graph state reloads.
7. Privy wallet mapping reloads.

Expected:

Core demo still works.

## Fresh browser test

Use a new browser session.

Expected:

Read only discovery and agent inspection still work without hidden localStorage dependencies.

## Demo rehearsal test

Run the exact demo sequence three times.

Record:

* average transaction confirmation delay
* Graph query delay
* common failure points

Prepare already funded test accounts and avoid last minute faucet dependence.

## Acceptance gate

No submission until these five proofs are repeatable:

1. Allowed ENS write.
2. Denied ENS write.
3. Live Graph discovery.
4. Allowed financial action.
5. Denied financial action.
