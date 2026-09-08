# Product Flow

## Golden path

```text
Organization owner
    |
    v
Select ENSv2 parent namespace
    |
    v
Create agent subname
    |
    v
Attach Permissioned Resolver
    |
    v
Grant record specific EAC permissions
    |
    v
Publish Agent Manifest records
    |
    v
Register or bind ERC 8004 identity
    |
    v
Verify ENSIP 25
    |
    v
Index appears in Agent0 Subgraph
    |
    v
Other user or agent discovers it
    |
    v
AI ranks using live Graph data
    |
    v
Inspect identity and permissions
    |
    v
Request a paid task
    |
    v
Privy evaluates financial control
    |
    v
Execute or deny
```

## Flow 1: Create agent identity

### User action

Owner clicks `Create Agent`.

Inputs:

* Agent label
* Display role
* Controller address
* MCP endpoint
* Optional A2A endpoint
* Optional web endpoint

### System work

1. Validate label locally.
2. Confirm wallet is connected to Sepolia.
3. Confirm the parent namespace is configured for ENSv2.
4. Register the subname in the parent registry.
5. Attach or select the correct Permissioned Resolver.
6. Write initial owner controlled records.
7. Grant record level resolver permission to the controller.
8. Read the new EAC state back from chain.
9. Persist app side metadata and transaction references.

### Completion condition

UI must not show `Active` until onchain reads confirm:

* Name exists.
* Resolver is set.
* Controller has intended record permissions.
* Controller does not have protected registry authority.

## Flow 2: Controller updates agent endpoint

Controller session chooses `Update MCP Endpoint`.

### System work

1. Read current permission from Permissioned Resolver.
2. If allowed, enable transaction button.
3. Controller signs `setText`.
4. Wait for confirmation.
5. Read the text record back.
6. Record activity event.

### Success UI

Show:

* Previous endpoint
* New endpoint
* Transaction hash
* Acting controller
* Permission source

## Flow 3: Negative permission proof

This is a first class product flow, not a hidden test.

Recommended protected action:

* Edit the ENSIP 25 verification text record, or
* Change resolver, or
* Set an unrelated text key

The controller attempts the action.

Expected result:

* Onchain revert
* UI labels it as an expected permission denial
* The permission matrix remains unchanged

Do not intentionally create a confusing generic failure. The UI should explain which authority was missing.

## Flow 4: Bind ERC 8004 identity

### Inputs

* ERC 8004 registry address
* Agent ID
* Claimed ENS name

### Steps

1. Ensure the agent registration metadata claims the intended ENS name.
2. Encode the registry address into the ENSIP 25 interoperable form required by the standard.
3. Build the parameterized text key:
   `agent-registration[<registry>][<agentId>]`
4. Set a non empty value under that key from an authorized identity owner path.
5. Verify by starting from the registry claim and resolving the ENS record.
6. Show `Verified` only after a runtime check.

### Security policy

The normal agent controller should not automatically receive permission to rewrite this record.

Reason:

It is an identity binding assertion, not an operational endpoint.

## Flow 5: Discover agent

Input:

> Find a reliable research agent with MCP support.

### System work

1. AI parses requested capability.
2. Backend queries live Agent0 data through The Graph.
3. Filter to compatible records.
4. Rank candidates with live fields.
5. For Nymspace managed agents, perform ENSIP 25 verification.
6. Return a ranked result with evidence.

### Result card

Show:

* ENS name
* ERC 8004 agent ID
* MCP endpoint availability
* A2A endpoint availability
* Trust model
* Feedback summary
* Validation state
* ENS verification
* Data source timestamp

## Flow 6: Request task and payment

User opens selected agent and chooses `Request Task`.

Inputs:

* Task description
* Budget amount
* Recipient
* Optional memo

### System work

1. Resolve recipient and wallet context.
2. Prepare transaction.
3. Submit through the configured Privy signer or wallet flow.
4. Let Privy enforce policy.
5. Render allow or deny result.
6. Append event.

### Demo pair

Allowed:

`Pay 5 USDC`

Denied:

`Pay 100 USDC`

The actual values may be different depending on the policy and test token availability. The key requirement is that the policy boundary is real and visible.

## Recovery flows

### ENS transaction failed

Keep form inputs.

Show:

* Failure source
* Revert summary
* Chain
* Contract
* Retry action

### Graph indexing delay

Show:

* `Pending indexing`
* Direct ERC 8004 registration evidence
* Retry query button

Do not fake the Graph result.

### Privy flow unavailable

If Privy has not met the implementation gate by the fallback deadline, disable the half built experience and execute the documented Bazantic fallback plan instead of shipping two broken financial flows.
