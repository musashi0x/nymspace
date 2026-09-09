/**
 * Provision the agent fleet on ENSv2 Sepolia — tasks 3.1 through 3.7.
 *
 * Run: pnpm provision:fleet
 *
 * Three subnames under the parent name, each with the resolver attached, each
 * carrying an `agent-context` record written by the organization; one
 * `agent-endpoint[mcp]` for the research agent; and record-scoped `SET_TEXT`
 * grants to the research controller — one resource per key, never a name-level
 * grant, never the wildcard.
 *
 * Lives at the repo root rather than in `@nymspace/ens` because it writes
 * activity events, and the domain package must not depend on the application's
 * persistence. Gate A (task 3.17) stays inside the package, where it belongs:
 * it reads chain and asserts, and needs no store at all.
 *
 * Idempotent. Every step checks chain state before spending, so a re-run after
 * a failure resumes rather than reverting on `NameAlreadyRegistered` — which
 * matters because the labels here are fixed, unlike the spike's timestamped
 * one, and a half-provisioned fleet is the normal state to recover from.
 */

import { formatEther } from "viem";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
import {
  AGENT_CONTEXT_KEY,
  AGENT_SUBNAME_OWNER_ROLES,
  EnsService,
  RESOLVER_ROLE,
  agentEndpointKey,
  buildAgentContext,
  chainConfig,
  createViemChainClient,
  encodeAgentContext,
  encodeDnsName,
  requireDeployed,
  textRecordResource,
  wildcardTextResource,
  type ViemChainClient,
} from "@nymspace/ens";
import {
  Store,
  closeDatabase,
  database,
  migrate,
  type ActivityEvidence,
} from "@nymspace/store";

//////////////////////////////////////////////////////////////////////////////
// The fleet
//////////////////////////////////////////////////////////////////////////////

const ORGANIZATION_ID = "nymspace";

/**
 * Three agents, per ADR 008, and only the research agent is delegated to.
 *
 * `docs/14`'s cut list drops the deploy agent first and the trader's
 * interactions second, so those two exist to prove the fleet is a fleet — that
 * grants are scoped per name — while the research agent carries the actual
 * proof. Giving all three controllers grants would cost gas and prove less:
 * task 3.7 needs a name whose controller has *no* grant to check leakage
 * against.
 */
const AGENTS = [
  {
    slug: "research",
    name: "Research",
    description: "Finds and ranks other agents from live registry data.",
    role: "Reads discovery data and may update its own MCP endpoint record.",
    /** Only the research agent gets a delegated endpoint in this change. */
    mcpEndpoint: "https://mcp.nymspace.example/research",
    delegated: true,
  },
  {
    slug: "trader",
    name: "Trader",
    description: "Executes payments inside a policy it cannot change.",
    role: "Holds a wallet under an amount-based policy. No record delegation.",
    delegated: false,
  },
  {
    slug: "deploy",
    name: "Deploy",
    description: "Provisions and retires agents on behalf of the organization.",
    role: "Reserved. First on the cut list in docs/14.",
    delegated: false,
  },
] as const;

/** One year. `register` reverts with `CannotSetPastExpiry` on anything past. */
const EXPIRY_SECONDS = 365n * 24n * 60n * 60n;

//////////////////////////////////////////////////////////////////////////////
// Reporting
//////////////////////////////////////////////////////////////////////////////

interface Step {
  what: string;
  ok: boolean;
  detail: string;
  txHash?: Hex;
}

const steps: Step[] = [];

function step(entry: Step): Step {
  steps.push(entry);
  console.log(
    `${entry.ok ? "ok  " : "FAIL"}  ${entry.what.padEnd(52)} ${entry.detail}`,
  );
  return entry;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

//////////////////////////////////////////////////////////////////////////////
// Runner
//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const keys = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
  ] as const);

  const client: ViemChainClient = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey: keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: keys.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  const ens = new EnsService({ client, config });
  const parentName = `${deployed.parentLabel}.eth`;
  const registry = deployed.parentRegistry;

  console.log(`Provisioning ${AGENTS.length} agents under ${parentName}`);
  console.log(`  registry  ${registry}`);
  console.log(`  resolver  ${deployed.permissionedResolver}`);
  console.log(`  organization ${client.organization}`);
  console.log(`  controller   ${client.controller}`);
  console.log(
    `  balance      ${formatEther(await client.getBalance(client.organization))} ETH\n`,
  );

  const db = database();
  await migrate(db);
  const store = new Store(db);

  await store.upsertOrganization({
    id: ORGANIZATION_ID,
    displayName: "Nymspace",
    parentEnsName: parentName,
    chainId: config.chainId,
  });

  const ensEvidence = (txHash: Hex, contract: Address): ActivityEvidence => ({
    source: "ens",
    txHash,
    contractAddress: contract,
  });

  //////////////////////////////////////////////////////////////////////////
  // 3.1 / 3.2 — register the subnames, read back, record the hashes
  //////////////////////////////////////////////////////////////////////////

  for (const agent of AGENTS) {
    const ensName = `${agent.slug}.${parentName}`;
    const agentId = `agent-${agent.slug}`;

    await store.upsertAgent({
      id: agentId,
      organizationId: ORGANIZATION_ID,
      slug: agent.slug,
      ensName,
      controllerAddress: client.controller,
    });

    const existingOwner = await ens.findOwner(registry, agent.slug);
    const unregistered =
      existingOwner === "0x0000000000000000000000000000000000000000";

    if (unregistered) {
      const expiry =
        BigInt(Math.floor(Date.now() / 1000)) + EXPIRY_SECONDS;
      try {
        const hash = await ens.registerSubname({
          registry,
          label: agent.slug,
          owner: client.organization,
          // Zero: an agent name has no children, and wiring a subregistry it
          // does not need would be authority nobody asked for.
          subregistry: "0x0000000000000000000000000000000000000000",
          resolver: deployed.permissionedResolver,
          roleBitmap: AGENT_SUBNAME_OWNER_ROLES,
          expiry,
        });
        const receipt = await ens.waitForReceipt(hash);
        step({
          what: `3.1 register ${ensName}`,
          ok: receipt.status === "success",
          detail: hash,
          txHash: hash,
        });

        await store.recordEvent({
          organizationId: ORGANIZATION_ID,
          agentId,
          source: "ens",
          type: "agent.created",
          status: receipt.status === "success" ? "success" : "failed",
          occurredAt: new Date().toISOString(),
          actor: client.organization,
          txHash: hash,
          summary: `Registered ${ensName}`,
          evidence: ensEvidence(hash, registry),
        });
      } catch (error) {
        step({
          what: `3.1 register ${ensName}`,
          ok: false,
          detail: messageOf(error),
        });
        continue;
      }
    } else {
      step({
        what: `3.1 register ${ensName}`,
        ok: true,
        detail: `already registered, owner ${existingOwner}`,
      });
    }

    // 3.2 — read back what was written. The resolver in particular: a subname
    // registered without one resolves to nothing, and the failure would not
    // surface until a record read returned empty for a reason that looked like
    // a permission problem.
    const [owner, resolver] = await Promise.all([
      ens.findOwner(registry, agent.slug),
      ens.getResolver(registry, agent.slug),
    ]);

    const resolverAttached =
      resolver.toLowerCase() === deployed.permissionedResolver.toLowerCase();
    step({
      what: `3.2 read back ${ensName}`,
      ok:
        owner.toLowerCase() === client.organization.toLowerCase() &&
        resolverAttached,
      detail: `owner ${owner}, resolver ${resolver}${resolverAttached ? "" : " (MISMATCH)"}`,
    });

    if (resolverAttached) {
      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId,
        source: "ens",
        type: "ens.resolver.attached",
        status: "success",
        occurredAt: new Date().toISOString(),
        summary: `${ensName} resolves through ${resolver}`,
        evidence: {
          source: "ens",
          // The attachment happened in the registration transaction; the read
          // above is the confirmation, and it is the registration that is the
          // evidence.
          txHash:
            steps.find((s) => s.what === `3.1 register ${ensName}`)?.txHash ??
            (`0x${"0".repeat(64)}` as Hex),
          contractAddress: registry,
        },
      });
    }

    // Provisioning stays `pending` here. Task 7.19 requires it to complete only
    // after a read-back confirms the name, the resolver, the grants, and the
    // absence of protected authority — and the grants have not been made yet at
    // this point in the run. Marking it active now would report a fully
    // provisioned agent whose delegation had not been attempted.
    await store.setProvisioning(agentId, {
      ens: resolverAttached ? "pending" : "failed",
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 3.3 — agent-context on all three, written by the organization
  //////////////////////////////////////////////////////////////////////////

  for (const agent of AGENTS) {
    const ensName = `${agent.slug}.${parentName}`;
    const context = encodeAgentContext(
      buildAgentContext({
        name: agent.name,
        description: agent.description,
        operator: parentName,
        role: agent.role,
      }),
    );

    const before = await ens.readText(ensName, AGENT_CONTEXT_KEY);
    // Compared on everything but `updatedAt`, so a re-run does not spend gas
    // rewriting an identical context with a new timestamp.
    if (sameContext(before, context)) {
      step({
        what: `3.3 agent-context ${agent.slug}`,
        ok: true,
        detail: "already current, not rewritten",
      });
      continue;
    }

    try {
      const hash = await ens.writeText({
        name: ensName,
        key: AGENT_CONTEXT_KEY,
        value: context,
        as: "organization",
      });
      const receipt = await ens.waitForReceipt(hash);
      step({
        what: `3.3 agent-context ${agent.slug}`,
        ok: receipt.status === "success",
        detail: hash,
        txHash: hash,
      });

      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId: `agent-${agent.slug}`,
        source: "ens",
        type: "ens.record.updated",
        status: "success",
        occurredAt: new Date().toISOString(),
        actor: client.organization,
        txHash: hash,
        summary: `Wrote ${AGENT_CONTEXT_KEY} on ${ensName}`,
        evidence: ensEvidence(hash, deployed.permissionedResolver),
      });
    } catch (error) {
      step({
        what: `3.3 agent-context ${agent.slug}`,
        ok: false,
        detail: messageOf(error),
      });
    }
  }

  //////////////////////////////////////////////////////////////////////////
  // 3.4 — agent-endpoint[mcp] for the research agent only
  //////////////////////////////////////////////////////////////////////////

  const research = AGENTS[0];
  const researchName = `${research.slug}.${parentName}`;
  const mcpKey = agentEndpointKey("mcp");

  {
    const before = await ens.readText(researchName, mcpKey);
    if (before === research.mcpEndpoint) {
      step({
        what: "3.4 agent-endpoint[mcp] research",
        ok: true,
        detail: "already current",
      });
    } else {
      try {
        const hash = await ens.writeText({
          name: researchName,
          key: mcpKey,
          value: research.mcpEndpoint,
          as: "organization",
        });
        const receipt = await ens.waitForReceipt(hash);
        step({
          what: "3.4 agent-endpoint[mcp] research",
          ok: receipt.status === "success",
          detail: hash,
          txHash: hash,
        });
        await store.recordEvent({
          organizationId: ORGANIZATION_ID,
          agentId: "agent-research",
          source: "ens",
          type: "ens.record.updated",
          status: "success",
          occurredAt: new Date().toISOString(),
          actor: client.organization,
          txHash: hash,
          summary: `Wrote ${mcpKey} on ${researchName}`,
          evidence: ensEvidence(hash, deployed.permissionedResolver),
        });
      } catch (error) {
        step({
          what: "3.4 agent-endpoint[mcp] research",
          ok: false,
          detail: messageOf(error),
        });
      }
    }
  }

  // A2A and web stay unset, per task 3.4. There is no A2A endpoint, and a
  // record pointing at one that does not answer is a claimed capability the
  // agent does not have.

  //////////////////////////////////////////////////////////////////////////
  // 3.5 — record-scoped grants to the research controller
  //////////////////////////////////////////////////////////////////////////

  /**
   * One resource per key. `authorizeTextRoles` takes the key itself, so the
   * grant lands on `resource(node, partHash(key))` and reaches nothing else —
   * which is the entire delegation claim. A name-level grant would let the
   * controller rewrite the ENSIP 25 record, and task 3.12 asserts it cannot.
   */
  const OPERATIONAL_KEYS = [mcpKey];
  const dnsName = encodeDnsName(researchName);

  for (const key of OPERATIONAL_KEYS) {
    const already = await ens.resolverHasRoles(
      textRecordResource(researchName, key),
      RESOLVER_ROLE.SET_TEXT,
      client.controller,
    );
    if (already) {
      step({
        what: `3.5 grant SET_TEXT on ${key}`,
        ok: true,
        detail: "already granted",
      });
      continue;
    }

    try {
      const hash = await ens.authorizeTextRole({
        dnsName,
        key,
        controller: client.controller,
        authorized: true,
      });
      const receipt = await ens.waitForReceipt(hash);
      step({
        what: `3.5 grant SET_TEXT on ${key}`,
        ok: receipt.status === "success",
        detail: hash,
        txHash: hash,
      });
      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId: "agent-research",
        source: "ens",
        type: "ens.permission.granted",
        status: "success",
        occurredAt: new Date().toISOString(),
        actor: client.organization,
        txHash: hash,
        summary: `Granted SET_TEXT on ${key} to ${client.controller}`,
        evidence: ensEvidence(hash, deployed.permissionedResolver),
      });
    } catch (error) {
      step({
        what: `3.5 grant SET_TEXT on ${key}`,
        ok: false,
        detail: messageOf(error),
      });
    }
  }

  //////////////////////////////////////////////////////////////////////////
  // 3.6 — the wildcard is empty, on every name
  //////////////////////////////////////////////////////////////////////////

  /**
   * One shared resolver serves all three agents, so a single wildcard grant
   * would let the research controller rewrite that key on every name in the
   * resolver. Asserted per key rather than assumed, because nothing in the
   * grant path constructs a wildcard and the assertion is what proves it.
   */
  for (const key of OPERATIONAL_KEYS.concat(AGENT_CONTEXT_KEY)) {
    const held = await ens.resolverHasRoles(
      wildcardTextResource(key),
      RESOLVER_ROLE.SET_TEXT,
      client.controller,
    );
    step({
      what: `3.6 wildcard empty for ${key}`,
      ok: !held,
      detail: held
        ? "CONTROLLER HOLDS THE WILDCARD — it can rewrite this key on every name"
        : "no wildcard grant",
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 3.7 — grants do not leak across names
  //////////////////////////////////////////////////////////////////////////

  for (const agent of AGENTS.filter((a) => !a.delegated)) {
    const otherName = `${agent.slug}.${parentName}`;
    // `canSetText` rather than a single resource read: it evaluates all three
    // alternatives the resolver's own `onlyPartRoles` accepts, so a leak
    // through the name-level or wildcard resource cannot hide from it.
    const canWrite = await ens.canSetText(otherName, mcpKey, client.controller);
    step({
      what: `3.7 no leak onto ${agent.slug}`,
      ok: !canWrite,
      detail: canWrite
        ? `LEAK — the research controller can write ${mcpKey} on ${otherName}`
        : `research controller cannot write ${mcpKey} on ${otherName}`,
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 7.19 — provisioning completes only on a full chain read-back
  //////////////////////////////////////////////////////////////////////////

  /**
   * Four facts, all re-read from chain, before any agent is called active.
   *
   * The name resolves, the resolver is the one we deployed, the controller can
   * write what it was granted, and it cannot reach what it was not. The last of
   * those is the one worth spelling out: an agent whose controller can write
   * everything is provisioned in the sense that nothing errored, and is exactly
   * the state this product exists to prevent.
   */
  for (const agent of AGENTS) {
    const ensName = `${agent.slug}.${parentName}`;
    const agentId = `agent-${agent.slug}`;

    const [owner, resolver, canWriteGranted, canWriteProtected] = await Promise.all([
      ens.findOwner(registry, agent.slug),
      ens.getResolver(registry, agent.slug),
      agent.delegated
        ? ens.canSetText(ensName, mcpKey, client.controller)
        : Promise.resolve(true),
      ens.canSetText(ensName, AGENT_CONTEXT_KEY, client.controller),
    ]);

    const confirmed =
      owner.toLowerCase() === client.organization.toLowerCase() &&
      resolver.toLowerCase() === deployed.permissionedResolver.toLowerCase() &&
      canWriteGranted &&
      // agent-context is written by the organization and never delegated, so a
      // controller that can write it holds authority nobody granted.
      !canWriteProtected;

    step({
      what: `7.19 read-back ${agent.slug}`,
      ok: confirmed,
      detail: confirmed
        ? "name, resolver, grants and absence of protected authority all confirmed"
        : `owner ${owner === client.organization}, resolver ${resolver === deployed.permissionedResolver}, granted ${canWriteGranted}, protected-reachable ${canWriteProtected}`,
    });

    await store.setProvisioning(agentId, { ens: confirmed ? "active" : "failed" });
  }

  //////////////////////////////////////////////////////////////////////////

  const failures = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failures.length}/${steps.length} steps passed`);
  console.log(
    `balance after: ${formatEther(await client.getBalance(client.organization))} ETH`,
  );

  if (failures.length > 0) {
    console.log("\nFailed:");
    for (const failure of failures) {
      console.log(`  ${failure.what}: ${failure.detail}`);
    }
    process.exitCode = 1;
  }

  await closeDatabase();
}

/** Equal but for `updatedAt`, so a re-run does not pay to rewrite a timestamp. */
function sameContext(before: string, next: string): boolean {
  try {
    const a = JSON.parse(before) as Record<string, unknown>;
    const b = JSON.parse(next) as Record<string, unknown>;
    delete a["updatedAt"];
    delete b["updatedAt"];
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Not top-level `await`: the root package is CommonJS, so tsx transforms this
// file with esbuild's cjs output format, which rejects it.
main().catch(async (error: unknown) => {
  console.error(`provisioning failed: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
