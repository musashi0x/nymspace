# Risks and Fallbacks

## Risk 1: ENSv2 beta tooling

### Why serious

ENSv2 is still beta on Sepolia.

Interfaces and deployment details can change.

### Mitigation

* Day 1 spike before frontend.
* Use direct viem contract calls if higher level SDK support is incomplete.
* Keep ENS integration isolated behind one service.
* Pull deployment addresses from canonical ENS docs.
* Pin tested ABI versions in repository.

### No fallback

ENS is the main track.

If ENSv2 is not working, solve ENSv2.

Do not replace it with ENSv1.

## Risk 2: Parent namespace configuration

A normal ENSv1 name is not automatically the desired ENSv2 subname registry.

### Mitigation

Resolve current ENSv2 testnet setup first.

Use a dedicated hackathon parent if needed.

Do not make branding dependent on a particular parent name.

UI should use:

```text
NEXT_PUBLIC_PARENT_ENS_NAME
```

## Risk 3: Graph indexing delay

### Mitigation

* Register early.
* Do not create demo registration right before recording.
* Add indexing pending state.
* Keep direct registry tx evidence.
* Retry live query.

### Rule

Do not fake Graph output.

## Risk 4: Graph AI qualification too weak

Rendering a single GraphQL response may not qualify.

### Mitigation

Make Graph the tool used by a discovery agent.

The AI must:

* interpret intent
* query live data
* rank
* explain
* feed selected result into next action

## Risk 5: Standardized Graph track ambiguity

### Mitigation

Treat as stretch.

If attempting:

* query at least two Agent0 deployments
* use the same schema and selection code
* show the standardization leverage

## Risk 6: Privy scope trap

### Symptom

Day 3 is consumed by:

* organizations
* teams
* complex quorum
* approval UI
* multiple wallets

### Mitigation

One wallet.

One control.

One allowed transaction.

One denied transaction.

### Fallback trigger

If real policy enforcement is not reliable by the agreed Day 3 gate, switch third partner strategy.

## Fallback third partner: Bazantic

Why:

Lower integration surface.

Potential flow:

```text
User intent
    |
    v
Nymspace identity API
    |
    v
The Graph Agent0
    |
    v
Bazantic recipe
    |
    v
Ranked agent result
```

To pursue the sponsor API recipe category, final implementation must satisfy Bazantic’s current requirements, including its gateway and recipe setup.

Do not prepare a Bazantic fallback that is only a slide.

## Risk 7: Too much agent behavior

### Mitigation

The agent does not need to solve an advanced autonomous task.

The important AI behavior is discovery reasoning.

The financial action can be deterministic.

## Risk 8: Swap distraction

### Mitigation

Do not integrate Uniswap unless changing partner strategy.

Use payment.

## Risk 9: Demo relies on local state

### Mitigation

Restart test.

Read live ENS and Graph state.

Persist only external IDs needed to reconnect.

## Risk 10: Hardcoded permission table

### Mitigation

One permission API.

Contract reads only.

Add a test that mutates permission onchain and verifies UI changes after refresh.
