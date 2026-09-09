## ADDED Requirements

### Requirement: Fleet provisioning is parameterised, not enumerated

The provisioning sequence SHALL be callable with an agent's own details, and SHALL have exactly one implementation shared by every caller.

#### Scenario: The script and the product run the same code

- **WHEN** an agent is provisioned from the fleet script or from the product API
- **THEN** both MUST execute the same sequence, so no caller can drift from the delegation policy the other enforces

#### Scenario: Delegation is off unless asked for

- **WHEN** a provisioning request does not ask for delegation
- **THEN** the controller MUST receive no record grant, so a fleet retains at least one name against which grant leakage can be checked

### Requirement: A created agent's controller reaches only its endpoint keys

Provisioning SHALL grant the controller `SET_TEXT` on the agent's endpoint record keys and nothing else.

#### Scenario: The organization's own keys stay with the organization

- **WHEN** provisioning completes for a delegated agent
- **THEN** a live permission read MUST show the controller allowed on the granted endpoint keys and denied on `agent-context`, on any ENSIP 25 registration key, and on the registry capabilities

#### Scenario: Provisioning does not complete on unchecked authority

- **WHEN** the final read-back finds the controller able to write a key it was never granted
- **THEN** the ENS track MUST be reported failed rather than active
