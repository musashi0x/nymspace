# Security Model

## Core security principle

An autonomous agent should not automatically receive the same authority as the organization that created it.

Nymspace separates:

* identity ownership
* operational identity edits
* registry authority
* financial authority
* routine transaction signing

## Identity authority

### Organization owner

High authority.

May:

* configure agent name
* configure resolver
* grant resolver record permissions
* bind ERC 8004 identity
* revoke agent controller rights

### Agent controller

Low authority.

May:

* update selected operational records

Should not:

* rewrite verification binding
* change resolver
* change subregistry
* unregister identity
* transfer identity
* grant itself more permissions

## Why record specific delegation matters

Granting global `ROLE_SET_TEXT` would allow an agent to modify every text record.

For the demo, grant only specific text keys.

This creates a visible least authority model.

## ENSIP 25 binding protection

The ENSIP 25 record asserts association with an external agent registry identity.

Protect it from the routine agent controller.

Otherwise the agent could potentially rewrite the association while remaining under the same human readable name.

## Financial authority

Routine agent signer should be constrained by Privy.

Policy management authority should be more privileged than transaction authority.

A compromised routine agent signer should not be able to raise its own spend limit.

## Threats

### Agent controller compromise

Impact if properly scoped:

* attacker can alter permitted endpoint records

Cannot:

* change resolver
* rewrite protected ENSIP 25 binding
* take registry ownership
* raise wallet policy

Mitigation:

* record specific EAC
* controller revocation
* activity logging

### Organization owner compromise

High impact.

Attacker may change registry or permission state.

Mitigation for production:

* multisig
* hardware backed admin
* delayed admin actions

Not required for MVP.

### Malicious endpoint

A valid ENS identity does not prove an MCP endpoint is safe.

UI must not imply ENS verification means the agent is trustworthy.

Separate labels:

* Identity verified
* Endpoint available
* Trust signals

### Stale ENSIP 25 association

Name ownership may change.

Verification should be performed live during important actions.

Do not rely forever on cached verified state.

### Graph indexing delay

A newly registered agent may not immediately appear.

Do not substitute static data.

### Graph data poisoning

ERC 8004 feedback may contain malicious or low quality signals.

For hackathon ranking:

* expose signal provenance
* do not claim objective truth
* avoid executing high risk transactions based solely on a single feedback value

### Prompt injection from agent metadata

Treat registration descriptions and remote endpoint metadata as untrusted text.

Do not insert them into privileged system instructions.

Use strict tool boundaries.

### Secret leakage

Never send:

* Privy app secret
* authorization private key
* wallet secret material

to client code or LLM prompts.

## Security invariant checklist

* Agent controller cannot grant itself EAC roles.
* Agent controller cannot rewrite ENSIP 25 record.
* Agent controller cannot change resolver.
* UI permission matrix comes from chain.
* Financial policy is enforced by Privy, not frontend logic.
* Graph results are treated as untrusted external data.
* Privy secrets remain server side.
