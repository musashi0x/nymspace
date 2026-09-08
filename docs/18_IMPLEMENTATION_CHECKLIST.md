# Implementation Checklist

## Project setup

* [ ] Create branch for hackathon work.
* [ ] Add `docs/` folder.
* [ ] Add `.env.example`.
* [ ] Configure Sepolia RPC.
* [ ] Configure ENSv2 deployment addresses.
* [ ] Configure Graph API key.
* [ ] Configure Agent0 subgraph ID.
* [ ] Configure Privy credentials.
* [ ] Add secret scanning.

## ENSv2 spike

* [ ] Resolve parent ENSv2 namespace.
* [ ] Create one test subname.
* [ ] Confirm owner.
* [ ] Confirm resolver.
* [ ] Grant MCP text key permission.
* [ ] Update MCP record from agent controller.
* [ ] Read MCP record back.
* [ ] Attempt protected text record write.
* [ ] Confirm revert.
* [ ] Attempt resolver change.
* [ ] Confirm revert.
* [ ] Save transaction evidence.

## Agent identity

* [ ] Define Agent Manifest JSON schema.
* [ ] Write `agent-context`.
* [ ] Write MCP endpoint.
* [ ] Optional A2A endpoint.
* [ ] Optional web endpoint.
* [ ] Register ERC 8004 identity.
* [ ] Ensure registration claims ENS name.
* [ ] Build ENSIP 25 key.
* [ ] Write ENSIP 25 record from owner path.
* [ ] Implement runtime verification.
* [ ] Protect ENSIP 25 record from agent controller.

## Permission API

* [ ] Read record permission.
* [ ] Read registry permission.
* [ ] Normalize permission state.
* [ ] Add no cache refresh mode.
* [ ] Build permission matrix UI.
* [ ] Add test permission interaction.

## The Graph

* [ ] Configure server side Graph client.
* [ ] Query live Agent0 Ethereum Sepolia.
* [ ] Query demo agent.
* [ ] Normalize registration file.
* [ ] Normalize feedback.
* [ ] Normalize validation.
* [ ] Implement discovery search.
* [ ] Implement AI ranking.
* [ ] Show evidence drawer.
* [ ] Add indexing pending state.
* [ ] Optional Base Sepolia cross schema query.

## Privy

* [ ] Create or load one wallet.
* [ ] Select ownership model.
* [ ] Create restricted signer or policy.
* [ ] Configure amount based rule.
* [ ] Fund test wallet.
* [ ] Execute allowed payment.
* [ ] Execute denied payment.
* [ ] Normalize policy error.
* [ ] Build policy panel.
* [ ] Hide all sensitive credentials.

## UI

* [ ] Fleet screen.
* [ ] Agent inspector.
* [ ] Identity panel.
* [ ] Agent Manifest panel.
* [ ] Authority panel.
* [ ] ENSIP 25 verification.
* [ ] Discover screen.
* [ ] Graph evidence.
* [ ] Task request.
* [ ] Allowed payment state.
* [ ] Denied payment state.
* [ ] Loading states.
* [ ] RPC error states.
* [ ] Graph indexing state.
* [ ] Optional activity timeline.

## Testing

* [ ] Unit tests.
* [ ] ENS integration test.
* [ ] ENS negative test.
* [ ] ENSIP 25 valid test.
* [ ] ENSIP 25 invalid test.
* [ ] Graph live test.
* [ ] AI discovery test.
* [ ] Privy allowed test.
* [ ] Privy denied test.
* [ ] Restart test.
* [ ] Fresh browser test.
* [ ] Three demo rehearsals.

## Submission

* [ ] Confirm ETHGlobal deadline.
* [ ] Confirm correct build pool.
* [ ] Confirm ENS prize requirements.
* [ ] Confirm Graph prize requirements.
* [ ] Confirm Privy prize requirements.
* [ ] Public repository.
* [ ] README architecture.
* [ ] Architecture diagram.
* [ ] Sponsor mapping.
* [ ] Demo video.
* [ ] No secrets.
* [ ] Transaction evidence.
* [ ] Source code links in submission.
