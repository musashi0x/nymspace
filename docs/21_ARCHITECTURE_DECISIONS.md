# Architecture Decisions

## ADR 001: ENSv2 is the identity authority

Status: Accepted

Decision:

ENS name ownership, resolver configuration, record values, and permissions are read from ENSv2.

The application database will not override those values.

Reason:

ENS must be load bearing for the main sponsor track.

## ADR 002: Record specific resolver delegation

Status: Accepted

Decision:

Grant the agent controller only specific text record permissions using Permissioned Resolver record level authorization.

Do not grant broad `ROLE_SET_TEXT` unless blocked by tooling.

Reason:

Makes least authority visible and provides the clearest ENSv2 demo.

## ADR 003: Organization controls ENSIP 25 binding

Status: Accepted

Decision:

Routine agent controller does not receive permission to update its ENSIP 25 verification record.

Reason:

Operational endpoint authority and identity binding authority should be separated.

## ADR 004: The Graph is discovery data source

Status: Accepted

Decision:

Agent discovery and trust evidence come from live Agent0 Subgraph data.

Reason:

Avoid custom indexer and satisfy load bearing Graph use.

## ADR 005: AI reasons over Graph results

Status: Accepted

Decision:

Natural language discovery invokes Graph as a tool and produces a ranked explanation.

Reason:

A raw GraphQL browser is too weak for the AI track.

## ADR 006: Payment, not swap

Status: Accepted

Decision:

Financial demo is a policy gated payment.

Reason:

Avoid routing, slippage, token approval, and irrelevant sponsor surface.

## ADR 007: One Privy control

Status: Accepted

Decision:

Implement exactly one clear enforceable financial boundary first.

Reason:

Privy organizations, team permissions, complex quorum, and intents can become a scope trap.

## ADR 008: Three demo agents maximum

Status: Accepted

Decision:

Research is the full vertical slice.

Trader and Deploy primarily demonstrate hierarchy.

Reason:

More agents add little judge value.

## ADR 009: Standardized Graph track is stretch

Status: Accepted

Decision:

Do not rely on that prize unless the app actually demonstrates schema reuse or composition.

Potential stretch:

Query Agent0 on Ethereum Sepolia and Base Sepolia using the same query and ranking pipeline.

## ADR 010: Negative actions are product features

Status: Accepted

Decision:

Display denied ENS and Privy actions as proof of policy enforcement.

Reason:

The product value is authority boundaries, not only successful transactions.
