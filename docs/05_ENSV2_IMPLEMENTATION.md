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

Do this before product UI. The script exists at
`packages/ens/scripts/spike-ensv2.ts`; run it with
`pnpm --filter @nymspace/ens spike`.

### What the spike already answered

Resolved from the deployed contracts and their source, before any transaction:

* **U4 — does registry ownership confer resolver grant authority?** No. The
  registry and the resolver are two EAC domains on two contracts, and
  `PermissionedResolver` has no `_getRoles` override. Resolver authority exists
  only as roles held on the resolver, which is why the organization deploys and
  initializes its own resolver proxy. This is a deployment decision, not a
  discovery.
* **U5 — one resolver per name, or one shared?** Shared. Grants are keyed by
  `resource(namehash, part)`, so a single organization-owned proxy serves every
  agent and `toName` distinguishes them. The cost is that a wildcard grant would
  reach every agent, so the wildcard resource is asserted empty.
* **U6 — can the organization call `register()` directly?** Yes, provided the
  UserRegistry's one-shot `initialize()` bitmap carried the `ROLE_REGISTRAR`
  base bit. `_register` checks `ROLE_REGISTRAR` on `ROOT_RESOURCE` and
  `hasRoles` ORs root roles in. No registrar contract and no payment token are
  involved for subnames.
* **U7 — how is the record resource derived?**
  `keccak256(node ‖ part)` with `part = keccak256(bytes(key))`; `(0, 0)` is
  `ROOT_RESOURCE`. Packed and non-packed encoding are identical for two
  `bytes32` values.
* **U8 — how is the ENSIP 25 key serialized?** `agent-registration[<registry>]
  [<agentId>]`, registry as a lowercase ERC 7930 hex string, chain reference
  minimal big-endian, agent id canonical decimal. Tested against the worked
  example ENSIP 25 publishes.

Still open until the spike runs against a funded key: **U1** (the parent label
and its acquisition), **U2** and **U3** (the subregistry and the proxy).

### Corrections to earlier assumptions

* The addresses to use come from `ensdomains/contracts-v2` at the commit
  `ensdomains/docs` pins for its Deployments page. `ensdomains/namechain`
  publishes older Sepolia sets whose addresses all differ.
* `hasRoles` and `roles` take a `uint256` resource, not a `bytes32`.
* `getSubregistry` and `getResolver` take a label **string**; `setSubregistry`
  and `setResolver` take a **token id** from `findTokenId(label)`, which changes
  whenever roles change.
* `ROLE_SET_TEXT` is `1 << 4`. Roles occupy nybbles, so the shifts step by four.
* Acquiring the parent is cheap: `MockUSDC` has an ungated `mint`,
  `getRegisterPrice` quotes about 8 USDC for a year, and `MIN_COMMITMENT_AGE`
  is 60 seconds.

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

Verified against `PermissionedResolver.sol` and the deployed ABI. Every call
goes through `EnsService` in `@nymspace/ens`, so the spike and the route
handlers cannot drift:

```ts
await ens.authorizeTextRole({
  dnsName: encodeDnsName(agentName),
  key: agentEndpointKey("mcp"),
  controller,
  authorized: true,
})
```

Repeat only for keys you intentionally delegate.

Three things this section previously left open, now settled:

* **`authorize*` is the only grant path.** `grantRoles` and `revokeRoles` exist
  on the resolver and are declared `pure`: a call site using them compiles,
  succeeds on chain, and grants nothing. A static test in
  `packages/ens/src/grant-path.test.ts` fails the build if one appears.
* **The caller needs `ROLE_SET_TEXT_ADMIN` on `resource(namehash, 0)`.** That
  authority comes only from roles held on the resolver; registry ownership
  confers none. Check it with `hasRoles` before delegating, never with
  `roles()`.
* **Never grant on the wildcard resource.** `onlyPartRoles` accepts a grant on
  `resource(0, part)` as an alternative, which authorizes that key on *every*
  name the resolver serves. With one shared resolver across all agents, one
  wildcard grant is a cross-agent breach.

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

1. Compute the resolver record resource as
   `keccak256(node ‖ part)` with `part = keccak256(bytes(key))`, and
   `resource(0, 0)` short-circuiting to `ROOT_RESOURCE`. This is
   `PermissionedResolverLib.resource`; the values are pinned in
   `packages/ens/src/eac.test.ts`.
2. Ask with **`hasRoles`, never `roles`**. `hasRoles(resource, bitmap, account)`
   evaluates `_getRoles(ROOT_RESOURCE, account) | _getRoles(resource, account)`
   and is what `_checkRoles` — the enforcement path — uses.
   `roles(resource, account)` returns raw per-resource storage, so an
   organization holding everything at root reads as zero and a permission
   matrix built on it would show "denied" for actions that succeed. Use
   `roles()` only to prove *where* a grant is stored, such as showing that a
   grant is record-scoped rather than name-scoped.
3. Evaluate the same three alternatives `onlyPartRoles` accepts, in order:
   `resource(node, part)`, then `resource(0, part)`, then `resource(node, 0)`.
   Anything narrower renders a name-level grant as an absence of permission
   while the transaction succeeds.
4. Trust a negative only after a positive control. A wrong derivation returns
   `false` from every check and is indistinguishable from a genuine denial, so
   assert a known grant reads `true` through the same code path first.
5. Enumerate which keys carry delegations from the
   `NamedTextResource(resource, name, keyHash, key)` event rather than probing
   a hardcoded key list. It is the only source that carries the readable key.
6. Map live result to UI, with the time it was read.

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
