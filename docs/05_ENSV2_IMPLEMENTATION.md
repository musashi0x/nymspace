# ENSv2 Implementation

## Objective

Make ENSv2 visibly load bearing.

The minimum proof is not just that an agent resolves.

The proof is:

* The organization owns a namespace.
* An agent is represented as a subname.
* A separate controller receives narrow record permission.
* That controller can modify permitted records.
* That controller cannot modify protected records or registry configuration.

## Network

Use Ethereum Sepolia.

ENSv2 contracts are beta and their interfaces may change before mainnet.

Do not hardcode addresses in source.

Store canonical deployment addresses in environment configuration and verify them against the ENSv2 deployment docs before final submission.

## ENSv2 concepts used

### Permissioned Registry

Used for:

* Agent subname registration
* Name ownership
* Resolver pointer
* Subregistry pointer
* Registry level authority

Important registry roles include:

* `ROLE_REGISTRAR`
* `ROLE_UNREGISTER`
* `ROLE_RENEW`
* `ROLE_SET_SUBREGISTRY`
* `ROLE_SET_RESOLVER`
* transfer authority admin
* upgrade authority

### Permissioned Resolver

Used for:

* Standard ENS records
* ENSIP 26 text records
* ENSIP 25 verification text record
* Fine grained record delegation

Important resolver role:

`ROLE_SET_TEXT = 1 << 4`

The resolver supports record specific text authorization through:

```text
authorizeTextRoles(toName, key, account, grant)
```

This is the preferred primitive for the demo.

## Recommended permission design

### Organization owner

Retains:

* Registry control
* Resolver administration
* ENSIP 25 verification record
* Permission grant and revoke authority

### Agent controller

Grant only:

* `agent-context`
* `agent-endpoint[mcp]`
* `agent-endpoint[a2a]`
* optionally `agent-endpoint[web]`

Do not grant general name level `ROLE_SET_TEXT` unless needed.

Use record level grants instead.

Reason:

The judge can see that ENSv2 can delegate one precise record without granting the agent control of unrelated identity assertions.

## Intended matrix

| Operation | Owner | Agent controller |
| --- | --- | --- |
| Set `agent-context` | Yes | Yes |
| Set MCP endpoint | Yes | Yes |
| Set A2A endpoint | Yes | Yes |
| Set ENSIP 25 registration record | Yes | No |
| Set arbitrary text key | Yes | No |
| Change resolver | Yes | No |
| Change subregistry | Yes | No |
| Unregister name | Owner configuration | No |
| Transfer | Owner configuration | No |

## Step 0: ENSv2 spike

Do this before product UI.

Create a script such as:

```text
scripts/spike-ensv2.ts
```

The script should:

1. Resolve the parent registry.
2. Create one temporary agent name.
3. Confirm its resolver.
4. Grant a controller `agent-endpoint[mcp]`.
5. Controller sets that record.
6. Read it back.
7. Controller tries to set `agent-registration[test][1]` or another protected key.
8. Assert revert.
9. Controller tries to change resolver.
10. Assert revert.

Store transaction hashes in console output.

### Go condition

All steps work on Sepolia.

### No go condition

If role grants or record writes cannot be made reliably by end of the initial spike, stop frontend work and solve this first.

## Registering an agent subname

The parent namespace needs a registry capable of managing subnames.

At a conceptual level:

```ts
register(
  label,
  owner,
  subregistry,
  resolver,
  roleBitmap,
  expiry
)
```

Exact deployment and parent setup depends on the current ENSv2 testnet configuration.

Do not assume ENSv1 Name Wrapper behavior.

## Resolver delegation

Use DNS encoded name input for `authorizeTextRoles`.

Conceptual TypeScript:

```ts
const dnsName = encodeDnsName(agentName)

await resolver.write.authorizeTextRoles([
  dnsName,
  "agent-endpoint[mcp]",
  controllerAddress,
  true
])
```

Repeat only for keys you intentionally delegate.

## Writing ENSIP 26 records

Controller operation:

```ts
const node = namehash(agentName)

await resolver.write.setText([
  node,
  "agent-endpoint[mcp]",
  newMcpUrl
])
```

Read back after confirmation.

## Permission reads for UI

Never derive permissions from local database flags.

For each record key:

1. Compute or use resolver record resource through the current contract helper path.
2. Use resolver role checks or the documented `roles` / `hasRoles` read path.
3. Map live result to UI.

If possible, wrap all checks in one backend endpoint:

```text
GET /api/agents/:name/permissions?controller=0x...
```

Return:

```json
{
  "controller": "0x...",
  "records": {
    "agent-context": true,
    "agent-endpoint[mcp]": true,
    "agent-endpoint[a2a]": true,
    "agent-registration[...]": false
  },
  "registry": {
    "setResolver": false,
    "setSubregistry": false,
    "unregister": false
  }
}
```

Values must be produced from chain reads.

## Negative proof

Preferred denied operation:

### Option A

Controller attempts to set the ENSIP 25 verification text key.

Why good:

It shows operational identity authority is separate from identity verification authority.

### Option B

Controller attempts to change the registry resolver.

Why good:

It shows the agent cannot seize control of its own resolver.

### Option C

Controller attempts to set an unrelated text key.

Why good:

Very easy to implement and demonstrates record level granularity.

Use at least one.

## Revocation

Recommended stretch demo:

Owner revokes MCP permission:

```text
authorizeTextRoles(..., "agent-endpoint[mcp]", controller, false)
```

Then controller attempts another update.

It should fail.

This communicates emergency revocation very clearly.

## Hardcoding rules

Do not hardcode:

* Permission badges
* Name ownership
* Resolver address
* ERC 8004 binding status
* Agent endpoint values
* Transaction success
* Permission denial

Static UI labels and demo descriptions are fine.

## ENS specific evidence to log

For every agent:

* Parent name
* Full agent name
* Registry address
* Resolver address
* Owner
* Controller
* Permission grants
* Record values
* Relevant tx hashes
* Latest verification timestamp
