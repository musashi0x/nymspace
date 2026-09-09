/**
 * Gate A — Identity.
 *
 * Run: pnpm --filter @nymspace/ens verify:identity
 * Emits: packages/ens/evidence/gate-a.json
 *
 * Seven assertions, and three of them are negative results. A negative result
 * is the weakest kind of evidence because it has many possible causes that all
 * render identically — a revert from access control looks exactly like a revert
 * from an empty balance — so each one here is paired with a control that
 * eliminates the boring explanation:
 *
 *   - the two signers are asserted distinct before anything is sent, because if
 *     they collide every allowed write passes and every denial is a self-denial;
 *   - the denied writes run from the same signer, in the same run, against the
 *     same key that a permitted write just succeeded on;
 *   - each revert is decoded and required to be the resolver's own
 *     `EACUnauthorizedAccountRoles`, not a generic failure;
 *   - assertion 7 runs before assertion 6 is trusted, because a verifier that
 *     has never returned a negative has not been shown to work at all.
 *
 * Reads only. This gate spends gas on the two writes it needs — the permitted
 * one in (2) and nothing else — and asserts everything else from chain state
 * that `pnpm provision:fleet` and `pnpm register:identity` already created.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
import {
  EnsService,
  Erc8004Service,
  agentEndpointKey,
  agentRegistrationKey,
  assembleManifest,
  chainConfig,
  claimedEnsName,
  createViemChainClient,
  requireDeployed,
  universalResolverAbi,
  verifyEnsip25,
  type ViemChainClient,
} from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "gate-a.json");

const AGENT_SLUG = "research";
const REGISTRATION_CHAIN_ID = 84532;

//////////////////////////////////////////////////////////////////////////////

interface Assertion {
  n: number;
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: Assertion[] = [];
const transactions: { what: string; hash: Hex }[] = [];
const facts: Record<string, unknown> = {};

function assert(n: number, name: string, passed: boolean, detail: string): boolean {
  assertions.push({ n, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${n}. ${name} — ${detail}`);
  return passed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const env = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
    "ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS",
  ] as const);

  const organizationKey = env.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex;
  const controllerKey = env.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex;
  const registry = env.ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS as Address;

  const ensClient: ViemChainClient = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey,
    controllerKey,
  });
  const registrationClient: ViemChainClient = createViemChainClient({
    rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: REGISTRATION_CHAIN_ID,
    organizationKey,
    controllerKey,
  });

  const ens = new EnsService({ client: ensClient, config });
  const erc8004 = new Erc8004Service({
    client: registrationClient,
    registry,
    chainId: REGISTRATION_CHAIN_ID,
  });

  const ensName = `${AGENT_SLUG}.${deployed.parentLabel}.eth`;
  const mcpKey = agentEndpointKey("mcp");

  Object.assign(facts, {
    ensName,
    ensChainId: config.chainId,
    registrationChainId: REGISTRATION_CHAIN_ID,
    registry,
    resolver: deployed.permissionedResolver,
    parentRegistry: deployed.parentRegistry,
    organization: ensClient.organization,
    controller: ensClient.controller,
  });

  console.log(`Gate A — Identity\n  ${ensName}\n`);

  ////////////////////////////////////////////////////////////////////////////
  // Control 0 — the signers are different accounts
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Also Gate 0.4, and asserted again here because this is the gate it
   * invalidates. If the two keys derive the same address, assertions 2, 3 and 4
   * all pass while proving nothing: the permitted write succeeds because the
   * signer is the organization, and the denied writes would too.
   */
  const distinct = ensClient.organization !== ensClient.controller;
  assert(
    0,
    "the organization and controller are different accounts",
    distinct,
    distinct
      ? `${ensClient.organization} vs ${ensClient.controller}`
      : `both keys derive ${ensClient.organization}; every denial below would be a self-denial`,
  );
  if (!distinct) return finish();

  ////////////////////////////////////////////////////////////////////////////
  // 1 — the name resolves through the Universal Resolver
  ////////////////////////////////////////////////////////////////////////////

  try {
    const found = (await ensClient.readContract({
      address: config.ensv2.universalResolver as Address,
      abi: universalResolverAbi,
      functionName: "findResolver",
      args: [dnsEncode(ensName)],
    })) as [Address, Hex, Hex];

    const resolverFound = found[0];
    assert(
      1,
      `${ensName} resolves through the Universal Resolver`,
      resolverFound.toLowerCase() === deployed.permissionedResolver.toLowerCase(),
      `findResolver returned ${resolverFound}`,
    );
    facts["universalResolverFound"] = resolverFound;
  } catch (error) {
    assert(1, `${ensName} resolves through the Universal Resolver`, false, firstLine(messageOf(error)));
  }

  ////////////////////////////////////////////////////////////////////////////
  // 2 — the controller's permitted write confirms and changes the value
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The differential control for everything below. It must be the *controller*
   * writing, and the value must change: a read-back equal to a value that was
   * already there proves the read works, not the write.
   */
  const before = await ens.readText(ensName, mcpKey);
  const next = `https://mcp.nymspace.example/research?gate-a=${Date.now()}`;

  try {
    const hash = await ens.writeText({
      name: ensName,
      key: mcpKey,
      value: next,
      as: "controller",
    });
    transactions.push({ what: "controller setText agent-endpoint[mcp]", hash });
    const receipt = await ens.waitForReceipt(hash);
    const after = await ens.readText(ensName, mcpKey);

    assert(
      2,
      "the controller's permitted write confirms and changes the value",
      receipt.status === "success" && after === next && after !== before,
      `${hash} — ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
    );
  } catch (error) {
    assert(2, "the controller's permitted write confirms and changes the value", false, firstLine(messageOf(error)));
  }

  ////////////////////////////////////////////////////////////////////////////
  // 3 / 4 — the denials, each attributed to the resolver's own error
  ////////////////////////////////////////////////////////////////////////////

  const agentId = await resolveAgentId(erc8004, ensName);
  facts["erc8004AgentId"] = agentId;

  if (agentId) {
    const ensip25Key = agentRegistrationKey({
      chainId: REGISTRATION_CHAIN_ID,
      registry,
      agentId,
    });
    facts["ensip25Key"] = ensip25Key;

    await assertDenied(
      3,
      "the controller's setText on the ENSIP 25 key reverts",
      () =>
        ens.writeText({
          name: ensName,
          key: ensip25Key,
          value: "controller-must-not-write-this",
          as: "controller",
        }),
    );
  } else {
    assert(3, "the controller's setText on the ENSIP 25 key reverts", false, "no ERC 8004 registration to build the key from");
  }

  const tokenId = await ens.findTokenId(deployed.parentRegistry, AGENT_SLUG);
  await assertDenied(
    4,
    "the controller's setResolver reverts",
    () =>
      ens.setResolver({
        registry: deployed.parentRegistry,
        tokenId,
        resolver: deployed.permissionedResolver,
        as: "controller",
      }),
    // The registry is a different EAC domain from the resolver, so it raises
    // its own error — same family, different contract.
    ["EACUnauthorizedAccountRoles"],
  );

  ////////////////////////////////////////////////////////////////////////////
  // 5 — the registration claims this name
  ////////////////////////////////////////////////////////////////////////////

  if (agentId) {
    const file = await erc8004.registrationFile(agentId);
    const claim = file ? claimedEnsName(file) : undefined;
    assert(
      5,
      "an ERC 8004 registration claims this ENS name",
      claim?.toLowerCase() === ensName.toLowerCase(),
      claim ? `agent ${agentId} claims ${claim}` : `agent ${agentId} claims nothing`,
    );
  } else {
    assert(5, "an ERC 8004 registration claims this ENS name", false, "no registration found");
  }

  ////////////////////////////////////////////////////////////////////////////
  // 7 before 6 — prove the verifier can say no before believing its yes
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Deliberately out of order, and the ordering is the control. Every
   * mis-encoding in this path fails as an empty read, indistinguishable from an
   * honest absence — so a verifier that has only ever returned `verified` has
   * not been shown to work. This runs the identical verification against an
   * agent id that does not hold the record.
   */
  let negativeHeld = false;
  if (agentId) {
    const wrongId = (BigInt(agentId) + 1n).toString(10);
    const negative = await verifyEnsip25({
      ensName,
      agentId: wrongId,
      registry,
      chainId: REGISTRATION_CHAIN_ID,
      // The registry claim is forced to match, so the *only* thing being
      // tested is the ENS side. Otherwise this would pass as
      // `registry_claim_missing` and prove nothing about key construction.
      erc8004: { async claimsEnsName() { return { claims: true, claimed: ensName }; } },
      readText: (n, k) => ens.readText(n, k),
    });
    negativeHeld = negative.status === "ens_record_missing";
    assert(
      7,
      "a deliberately mis-encoded key returns ens_record_missing",
      negativeHeld,
      `agent ${wrongId} → ${negative.status}`,
    );
    facts["negativeVerificationKey"] = negative.key;
  } else {
    assert(7, "a deliberately mis-encoded key returns ens_record_missing", false, "no registration to mis-encode from");
  }

  ////////////////////////////////////////////////////////////////////////////
  // 6 — verification returns verified, carrying a read time
  ////////////////////////////////////////////////////////////////////////////

  if (agentId) {
    const result = await verifyEnsip25({
      ensName,
      agentId,
      registry,
      chainId: REGISTRATION_CHAIN_ID,
      erc8004,
      readText: (n, k) => ens.readText(n, k),
    });
    assert(
      6,
      "verification returns verified, carrying a read time",
      result.status === "verified" &&
        Number.isFinite(Date.parse(result.readAt)) &&
        // Only trusted because 7 held. A verifier that cannot fail has not
        // been shown to work.
        negativeHeld,
      `${result.status} at ${result.readAt}${negativeHeld ? "" : " (assertion 7 did not hold, so this is not trusted)"}`,
    );
    facts["verification"] = result;
  } else {
    assert(6, "verification returns verified, carrying a read time", false, "no registration to verify");
  }

  ////////////////////////////////////////////////////////////////////////////
  // 8 — task 3.16: a record changed on chain changes the manifest
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The manifest is a read-through view, so this must hold with no
   * invalidation step anywhere. Assembled, mutated on chain, assembled again —
   * and the second assembly must differ. A cache that outlived the request
   * would fail here and nowhere else.
   */
  try {
    const first = await assembleManifest({
      name: ensName,
      ens,
      ensChainId: config.chainId,
      ...(agentId && { registration: { agentId, service: erc8004 } }),
    });

    const mutated = `https://mcp.nymspace.example/research?manifest=${Date.now()}`;
    const hash = await ens.writeText({
      name: ensName,
      key: mcpKey,
      value: mutated,
      as: "controller",
    });
    transactions.push({ what: "controller setText for the manifest mutation", hash });
    await ens.waitForReceipt(hash);

    const second = await assembleManifest({
      name: ensName,
      ens,
      ensChainId: config.chainId,
      ...(agentId && { registration: { agentId, service: erc8004 } }),
    });

    assert(
      8,
      "a record changed on chain changes the next manifest, with no invalidation",
      first.endpoints.mcp?.value !== second.endpoints.mcp?.value &&
        second.endpoints.mcp?.value === mutated,
      `${JSON.stringify(first.endpoints.mcp?.value)} → ${JSON.stringify(second.endpoints.mcp?.value)}`,
    );
    facts["manifest"] = second;
  } catch (error) {
    assert(8, "a record changed on chain changes the next manifest, with no invalidation", false, firstLine(messageOf(error)));
  }

  finish();

  ////////////////////////////////////////////////////////////////////////////

  async function assertDenied(
    n: number,
    name: string,
    call: () => Promise<unknown>,
    expectedErrors: string[] = ["EACUnauthorizedAccountRoles"],
  ): Promise<void> {
    let detail: string;
    try {
      await call();
      assert(n, name, false, "the call succeeded — the boundary does not hold");
      return;
    } catch (error) {
      detail = messageOf(error);
    }

    // The whole point of the control: a revert is not enough. Out of gas, a
    // stale nonce and a malformed call all revert, and all render as a denial
    // in a pass/fail line unless the cause is read.
    const named = expectedErrors.find((candidate) => detail.includes(candidate));
    assert(
      n,
      name,
      Boolean(named),
      named
        ? `reverted with ${named}`
        : `reverted, but not with the contract's own authorization error: ${firstLine(detail)}`,
    );
  }
}

/**
 * The agent id this name is bound to, confirmed against chain.
 *
 * The id comes from configuration; that it claims *this* name is read from the
 * registry, so a stale or wrong pointer fails here rather than quietly
 * verifying somebody else's agent.
 */
async function resolveAgentId(
  erc8004: Erc8004Service,
  ensName: string,
): Promise<string | undefined> {
  const candidate = pinnedAgentId();
  try {
    const file = await erc8004.registrationFile(candidate);
    if (file && claimedEnsName(file)?.toLowerCase() === ensName.toLowerCase()) {
      return candidate;
    }
  } catch {
    // A token that does not exist, or a lagging replica.
  }
  return undefined;
}

/**
 * The agent id, from configuration.
 *
 * An output of `pnpm register:identity`, recorded in `.env` the same way the
 * spike's proxy addresses are — the registry does not answer "which agent
 * claims this name", so the alternative is walking the id space, which is a
 * poor way to find one agent and would tie this gate to the registry staying
 * small. This gate still reads every *assertion* from chain; only the pointer
 * is configuration.
 */
function pinnedAgentId(): string {
  const pinned = process.env["ERC8004_RESEARCH_AGENT_ID"];
  if (!pinned) {
    throw new Error(
      "ERC8004_RESEARCH_AGENT_ID is not set. `pnpm register:identity` prints the " +
        "agent id it created; copy it into .env so this gate has a pointer to verify.",
    );
  }
  return pinned;
}

function dnsEncode(name: string): Hex {
  let out = "0x";
  for (const label of name.split(".").filter(Boolean)) {
    const bytes = new TextEncoder().encode(label);
    out += bytes.length.toString(16).padStart(2, "0");
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  }
  return `${out}00` as Hex;
}

function finish(): void {
  const failures = assertions.filter((a) => !a.passed);
  const go = failures.length === 0;

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify({ ranAt: new Date().toISOString(), gate: "A", go, facts, assertions, transactions }, null, 2)}\n`,
  );

  console.log(
    `\n${assertions.length - failures.length}/${assertions.length} assertions passed`,
  );
  console.log(`evidence: ${EVIDENCE_PATH}`);
  console.log(go ? "\nGate A: PASS" : "\nGate A: FAIL");
  if (!go) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Gate A could not run: ${firstLine(messageOf(error))}`);
  process.exitCode = 1;
});
