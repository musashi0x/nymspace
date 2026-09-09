/**
 * Gate B — Discovery.
 *
 * Run: pnpm --filter @nymspace/graph verify:discovery
 * Emits: packages/graph/evidence/gate-b.json
 *
 * The gate lies by returning one candidate. With a single agent the filter and
 * the ranker both pass without executing anything, and the demo works exactly
 * once — so assertion 1 forces plurality and assertion 2 forces the filter to
 * actually remove something. The second lie is that a fixture and a live
 * response have the same shape, which is what assertion 6 is for: with the key
 * removed the identical request must fail, proving the request left the
 * process at all.
 *
 * Assertion 4 mutation-tests the checker rather than the output. A validator
 * that has only ever returned `valid` has not been shown to work, and the
 * strongest claim this product makes about its AI track rests on that
 * validator.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  Agent0Client,
  Agent0ProviderError,
  buildLogEntry,
  clearBrowseCache,
  defaultNetwork,
  rankAgents,
  searchAgent0,
  searchAgent0Cached,
  validateExplanation,
  type RankedAgent,
} from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "gate-b.json");

const REQUEST =
  "Find an agent that can answer research questions over MCP, and say why it fits.";

//////////////////////////////////////////////////////////////////////////////

interface Assertion {
  n: number;
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: Assertion[] = [];
const facts: Record<string, unknown> = {};

function assert(n: number, name: string, passed: boolean, detail: string): boolean {
  assertions.push({ n, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${n}. ${name} — ${detail}`);
  return passed;
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  clearBrowseCache();
  const network = defaultNetwork();
  const client = new Agent0Client({ network });

  console.log(`Gate B — Discovery\n  network ${network}\n`);
  facts["network"] = network;

  const startedAt = Date.now();
  /**
   * A wide page on purpose. MCP-capable agents are a small slice of the
   * registry — 2 in the first 25 on Base Sepolia, 4 in the first 100 — and
   * assertion 1 demands three so the ranker has something to choose between. A
   * page too small to clear that bar would fail the gate for a reason that says
   * nothing about the code.
   */
  const search = await searchAgent0Cached(
    { requireMcp: true, capability: REQUEST, limit: 100 },
    { client, refresh: true },
  );
  const searchMs = Date.now() - startedAt;

  facts["rawCount"] = search.raw.length;
  facts["candidateCount"] = search.candidates.length;
  facts["excluded"] = search.excluded;
  facts["provenance"] = search.provenance;

  ////////////////////////////////////////////////////////////////////////////
  // 1 — plurality, so the ranker had something to choose between
  ////////////////////////////////////////////////////////////////////////////

  assert(
    1,
    "a live query returns at least three candidates",
    search.candidates.length >= 3,
    `${search.candidates.length} candidates from ${search.raw.length} raw results in ${searchMs}ms`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 2 — the filter removed something that was really there
  ////////////////////////////////////////////////////////////////////////////

  const lackingMcp = search.raw.filter((a) => !a.mcpEndpoint);
  const filteredOut = lackingMcp.every(
    (a) => !search.candidates.some((c) => c.graphAgentKey === a.graphAgentKey),
  );

  assert(
    2,
    "an agent lacking MCP is present in the raw response and absent from the filtered set",
    lackingMcp.length > 0 && filteredOut,
    lackingMcp.length === 0
      ? "every raw result had an MCP endpoint, so the filter never executed"
      : `${lackingMcp.length} raw results lacked MCP and none survived the filter`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 5 — provenance, before anything is ranked
  ////////////////////////////////////////////////////////////////////////////

  const p = search.provenance;
  assert(
    5,
    "the response carries provider, chain, subgraph id and query time",
    Boolean(p.provider && p.chainId && p.subgraphId) &&
      Number.isFinite(Date.parse(p.queriedAt)),
    `${p.provider} chain ${p.chainId} subgraph ${p.subgraphId} at ${p.queriedAt}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 3 / 4 — the ranking, and the validator that checks it
  ////////////////////////////////////////////////////////////////////////////

  let ranked: RankedAgent[] = [];
  let rankingError: string | undefined;

  try {
    const ranking = await rankAgents(REQUEST, search.candidates);
    ranked = ranking.ranked;
    facts["criteria"] = ranking.criteria;
    facts["ranked"] = ranking.ranked;
    facts["model"] = ranking.model;

    assert(
      3,
      "every field the explanation cites is present on the candidate it describes",
      ranking.validation.valid,
      ranking.validation.valid
        ? `${ranking.ranked.length} ranked, all citations check out`
        : JSON.stringify(ranking.validation.problems),
    );
  } catch (error) {
    rankingError = messageOf(error);
    assert(3, "every field the explanation cites is present on the candidate it describes", false, rankingError);
  }

  /**
   * The mutation test. A validator is only evidence if it can fail, and this
   * corrupts a real explanation in the same run rather than asserting against a
   * fixture — so it tests the checker that just produced assertion 3.
   */
  const corrupted: RankedAgent[] = (ranked.length > 0
    ? [{ ...ranked[0]!, citedFields: ["trustScore"] }]
    : [
        {
          graphAgentKey: search.candidates[0]?.graphAgentKey ?? "unknown",
          score: 1,
          reason: "Invented.",
          citedFields: ["trustScore"],
        },
      ]);

  const corruptedOutcome = validateExplanation(corrupted, search.candidates);
  assert(
    4,
    "the validator rejects a deliberately corrupted explanation in the same run",
    !corruptedOutcome.valid,
    corruptedOutcome.valid
      ? "the validator accepted a citation of a field that does not exist"
      : corruptedOutcome.problems.map((x) => x.problem).join("; "),
  );
  facts["corruptedExplanationVerdict"] = corruptedOutcome;

  ////////////////////////////////////////////////////////////////////////////
  // 6 — with the key removed, the identical request fails
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Proves the request left the process. A seeded or cached result would sail
   * through every assertion that only inspects the body, and this is the one
   * that cannot be satisfied without a real network call.
   */
  clearBrowseCache();
  let providerErrored = false;
  let providerDetail = "the request succeeded without a key";
  try {
    const keyless = new Agent0Client({
      network,
      apiKey: "",
      subgraphId: client.subgraphId(),
    });
    const result = await searchAgent0({ requireMcp: true }, keyless);
    providerDetail = `returned ${result.candidates.length} candidates with no API key`;
  } catch (error) {
    providerErrored = error instanceof Agent0ProviderError;
    providerDetail = messageOf(error);
  }

  assert(
    6,
    "with the API key removed the identical request produces a provider error and zero candidates",
    providerErrored,
    providerDetail,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 7 — an absent validation dimension changes no score
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The assertion that catches invented reputation. It holds structurally —
   * `validation` is not a citable field and never reaches the model — so this
   * checks the structure rather than re-running the model and comparing two
   * non-deterministic outputs, which would prove less and cost more.
   */
  const validationCited = ranked.some((r) =>
    r.citedFields.some((f) => /valid/i.test(f)),
  );
  const validationInReason = ranked.some((r) => /validat/i.test(r.reason));

  assert(
    7,
    "no score or explanation rests on the absent validation dimension",
    !validationCited && !validationInReason,
    validationCited
      ? "a ranking cited a validation field"
      : validationInReason
        ? "an explanation mentioned validation, which is unavailable on this network"
        : "validation is neither citable nor cited",
  );

  ////////////////////////////////////////////////////////////////////////////

  const log = buildLogEntry({
    query: { requireMcp: true, capability: REQUEST, limit: 100 },
    search,
    ranked,
    validation: validateExplanation(ranked, search.candidates),
    durationMs: Date.now() - startedAt,
    ...(rankingError && { providerError: rankingError }),
  });
  facts["log"] = log;

  const failures = assertions.filter((a) => !a.passed);
  const go = failures.length === 0;

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        gate: "B",
        go,
        facts,
        assertions,
        // The raw response and the filtered set, as the gate contract requires.
        raw: search.raw,
        candidates: search.candidates,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\n${assertions.length - failures.length}/${assertions.length} assertions passed`);
  console.log(`evidence: ${EVIDENCE_PATH}`);
  console.log(go ? "\nGate B: PASS" : "\nGate B: FAIL");
  if (!go) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Gate B could not run: ${messageOf(error)}`);
  process.exitCode = 1;
});
