/**
 * Gate D — Authority is contract-derived.
 *
 * Run: pnpm test:matrix-live
 * Emits: evidence/gate-d.json
 *
 * The gate `docs/17` Risk 10 exists for, and the one guarding success metric
 * one in `docs/01`: that 100 percent of displayed permission state is contract
 * derived.
 *
 * It lies by being correct today for the wrong reason. The intended policy in
 * `docs/03_UX_SPEC.md` is a table somebody typed, so a console that hardcodes
 * that table passes every visual inspection perfectly and fails the moment
 * chain state and intent diverge — which is exactly what a judge probes. No
 * amount of reading the code settles it, so this gate changes the chain and
 * requires the interface to follow.
 *
 * Assertions 1 and 2 are the whole point: revoke a grant on chain, ask again,
 * require the cell to have flipped; re-grant, require it to flip back. Nothing
 * hardcoded survives that, and nothing cached does either.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
import {
  EnsService,
  RESOLVER_ROLE,
  agentEndpointKey,
  chainConfig,
  createViemChainClient,
  encodeDnsName,
  nameResource,
  requireDeployed,
  textRecordResource,
  wildcardTextResource,
  type ViemChainClient,
} from "@nymspace/ens";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "gate-d.json");

const API = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3112";
const AGENT_ID = "agent-research";
const AGENTS = ["research", "trader", "deploy"] as const;

//////////////////////////////////////////////////////////////////////////////

interface Assertion {
  n: number;
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: Assertion[] = [];
const facts: Record<string, unknown> = {};
const transactions: { what: string; hash: Hex }[] = [];

function assert(n: number, name: string, passed: boolean, detail: string): void {
  assertions.push({ n, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${n}. ${name} — ${detail}`);
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

interface MatrixResponse {
  controller: Address;
  recordPermissions: Record<string, boolean>;
  registryPermissions: Record<string, boolean>;
  control: { account: Address; key: string; allowed: boolean };
  queries: { cell: string; resources: string[] }[];
  source: string;
  readAt: string;
}

/**
 * Read the matrix through the API, which is what the console renders.
 *
 * Reading the chain directly here would test the chain rather than the
 * interface — and the claim under test is about what the interface displays.
 */
async function readMatrix(): Promise<MatrixResponse> {
  const response = await fetch(`${API}/v1/agents/${AGENT_ID}/permissions`);
  if (!response.ok) {
    throw new Error(
      `the API answered ${response.status}. Is it running? \`pnpm --filter @nymspace/api start\``,
    );
  }
  return (await response.json()) as MatrixResponse;
}

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const env = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
  ] as const);

  const client: ViemChainClient = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey: env.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: env.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });
  const ens = new EnsService({ client, config });

  const parent = `${deployed.parentLabel}.eth`;
  const ensName = `research.${parent}`;
  const mcpKey = agentEndpointKey("mcp");
  const dnsName = encodeDnsName(ensName);

  console.log(`Gate D — Authority is contract-derived\n  ${ensName}\n`);
  Object.assign(facts, {
    ensName,
    api: API,
    cell: mcpKey,
    controller: client.controller,
    organization: client.organization,
  });

  const before = await readMatrix();
  facts["matrixBefore"] = before;

  if (!before.recordPermissions[mcpKey]) {
    assert(0, "the cell under test starts allowed", false, `${mcpKey} is already denied — nothing to revoke`);
    return finish();
  }

  ////////////////////////////////////////////////////////////////////////////
  // 1 — revoke on chain, and the interface follows
  ////////////////////////////////////////////////////////////////////////////

  const revokeHash = await ens.authorizeTextRole({
    dnsName,
    key: mcpKey,
    controller: client.controller,
    authorized: false,
  });
  transactions.push({ what: "revoke SET_TEXT", hash: revokeHash });
  await ens.waitForReceipt(revokeHash);

  const afterRevoke = await readMatrix();
  facts["matrixAfterRevoke"] = afterRevoke;

  assert(
    1,
    "a grant revoked on chain flips the cell on the next read",
    before.recordPermissions[mcpKey] === true &&
      afterRevoke.recordPermissions[mcpKey] === false,
    `${mcpKey}: allowed → ${afterRevoke.recordPermissions[mcpKey] ? "allowed" : "denied"} (tx ${revokeHash})`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 2 — re-grant, and it flips back
  ////////////////////////////////////////////////////////////////////////////

  const grantHash = await ens.authorizeTextRole({
    dnsName,
    key: mcpKey,
    controller: client.controller,
    authorized: true,
  });
  transactions.push({ what: "re-grant SET_TEXT", hash: grantHash });
  await ens.waitForReceipt(grantHash);

  const afterGrant = await readMatrix();
  facts["matrixAfterGrant"] = afterGrant;

  assert(
    2,
    "re-granting flips it back, so the first flip was not a one-way cache miss",
    afterGrant.recordPermissions[mcpKey] === true,
    `${mcpKey}: denied → ${afterGrant.recordPermissions[mcpKey] ? "allowed" : "denied"} (tx ${grantHash})`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 3 — every rendered cell has a query behind it
  ////////////////////////////////////////////////////////////////////////////

  const rendered = Object.keys(afterGrant.recordPermissions);
  const queried = new Set(afterGrant.queries.map((q) => q.cell));
  const unbacked = rendered.filter((cell) => !queried.has(cell));

  assert(
    3,
    "every rendered cell has a role query in that request's own trace",
    unbacked.length === 0,
    unbacked.length === 0
      ? `${rendered.length} cells, ${queried.size} traced`
      : `no query behind ${unbacked.join(", ")}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 4 — a positive control rendered allowed in the same request
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The control that makes every denial meaningful. A wrong resource derivation
   * and a genuine refusal are the same `false`, so a matrix of denials proves
   * nothing unless something in the same request came back allowed through the
   * same code path.
   */
  const anyDenied = Object.values(afterGrant.recordPermissions).some((v) => !v);
  assert(
    4,
    "a positive control rendered allowed in the same request as a denied cell",
    afterGrant.control.allowed && anyDenied,
    `control ${afterGrant.control.account} on ${afterGrant.control.key} → ${afterGrant.control.allowed ? "allowed" : "denied"}; ${
      Object.values(afterGrant.recordPermissions).filter((v) => !v).length
    } denied cells`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 5 — a name-scoped grant renders as allowed, not denied
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The narrow bug this catches: a matrix that checks only
   * `resource(node, part)` renders a name-level grant as a denial, and that is a
   * UI lying in the safe-looking direction — the worst kind, because nobody
   * investigates a permission that reads as absent.
   *
   * Asserted against the resolver's own alternatives rather than by making a
   * name-level grant, which would hand the controller every text key on the
   * name and is not a state worth creating on a demo namespace even briefly.
   */
  const alternatives = afterGrant.queries.find((q) => q.cell === mcpKey)?.resources ?? [];
  const expected = [
    textRecordResource(ensName, mcpKey),
    wildcardTextResource(mcpKey),
    nameResource(ensName),
  ].map(String);

  assert(
    5,
    "the matrix evaluates all three resources onlyPartRoles accepts",
    expected.every((r) => alternatives.includes(r)),
    `${alternatives.length} resources queried per cell; name-scope included: ${alternatives.includes(expected[2]!)}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 6 — the wildcard is empty on every agent
  ////////////////////////////////////////////////////////////////////////////

  /**
   * One shared resolver serves all three agents, so a single wildcard grant
   * would let the research controller rewrite that key on every name in it.
   * Checked directly against chain rather than through the API, because the
   * question is about the resolver's storage and not about what is displayed.
   */
  const leaks: string[] = [];
  for (const slug of AGENTS) {
    for (const key of [mcpKey, "agent-context"]) {
      const held = await ens.resolverHasRoles(
        wildcardTextResource(key),
        RESOLVER_ROLE.SET_TEXT,
        client.controller,
      );
      if (held) leaks.push(`${slug}:${key}`);
    }
  }

  assert(
    6,
    "the wildcard resource reads empty for every granted key across all three agents",
    leaks.length === 0,
    leaks.length === 0
      ? "no wildcard grant on any key"
      : `wildcard held for ${leaks.join(", ")}`,
  );

  finish();
}

function finish(): void {
  const failures = assertions.filter((a) => !a.passed);
  const go = failures.length === 0;

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify({ ranAt: new Date().toISOString(), gate: "D", go, facts, assertions, transactions }, null, 2)}\n`,
  );

  console.log(`\n${assertions.length - failures.length}/${assertions.length} assertions passed`);
  console.log(`evidence: ${EVIDENCE_PATH}`);
  console.log(go ? "\nGate D: PASS" : "\nGate D: FAIL");
  if (!go) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Gate D could not run: ${messageOf(error)}`);
  process.exitCode = 1;
});
