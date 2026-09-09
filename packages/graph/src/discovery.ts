import type { NormalisedAgent } from "./types";
import { Agent0Client, Agent0ProviderError, type Agent0Network } from "./client";

/**
 * Discovery: the `search_agent0` tool, the ranking step, and the checks that
 * keep a ranking honest.
 *
 * `docs/04` forbids inventing capabilities and inventing reputation, and both
 * are easy to do by accident here. A model asked to rank agents will happily
 * explain its choice using a field the response never carried, and a scorer
 * given a missing dimension will happily weight it at zero. So the ranking is
 * not trusted on its own: every explanation is validated against the candidate
 * it describes, and the absent validation dimension is a union rather than a
 * number so there is nothing to multiply.
 */

//////////////////////////////////////////////////////////////////////////////
// The tool — task 4.7
//////////////////////////////////////////////////////////////////////////////

export interface SearchAgent0Params {
  /** Free text from the operator. Used for ranking, never for filtering. */
  capability?: string;
  /** Hard filter. An agent with no MCP endpoint cannot be called over MCP. */
  requireMcp?: boolean;
  /**
   * Trust models the agent must declare, from `supportedTrusts`.
   *
   * A hard filter and deliberately conservative: an agent that declares nothing
   * is excluded when this is set, rather than being given the benefit of the
   * doubt. Declaring no trust model is not the same as supporting all of them.
   */
  trustModels?: string[];
  network?: Agent0Network;
  limit?: number;
}

export interface SearchAgent0Result {
  /** Everything the query returned, before filtering. */
  raw: NormalisedAgent[];
  /** What survived the hard filters. */
  candidates: NormalisedAgent[];
  /** Why each excluded agent was excluded, so a filter can be audited. */
  excluded: { graphAgentKey: string; reason: string }[];
  provenance: NormalisedAgent["provenance"];
  queriedAt: string;
}

/**
 * Run the search server-side and return normalised candidates.
 *
 * Filtering happens here, in code, and not in the model. A model asked to
 * "only include agents with MCP" will sometimes include one anyway, and the
 * failure is invisible — the explanation reads perfectly. A filter that runs
 * before the model is a filter that can be asserted, which is what Gate B's
 * assertion 2 does.
 */
export async function searchAgent0(
  params: SearchAgent0Params = {},
  client: Agent0Client = new Agent0Client({ network: params.network }),
): Promise<SearchAgent0Result> {
  const queriedAt = new Date().toISOString();

  // Fetched unfiltered so `raw` genuinely contains agents the filter removes.
  // Asking the subgraph to filter would make assertion 2 unprovable: there
  // would be nothing in the raw response for the filtered set to differ from.
  const raw = await client.searchAgents({ first: params.limit ?? 25 });

  const excluded: SearchAgent0Result["excluded"] = [];
  const candidates = raw.filter((agent) => {
    if (params.requireMcp && !agent.mcpEndpoint) {
      excluded.push({
        graphAgentKey: agent.graphAgentKey,
        reason: "no MCP endpoint",
      });
      return false;
    }
    if (params.trustModels?.length) {
      const declared = new Set(agent.supportedTrusts);
      const missing = params.trustModels.filter((t) => !declared.has(t));
      if (missing.length > 0) {
        excluded.push({
          graphAgentKey: agent.graphAgentKey,
          reason: `does not declare ${missing.join(", ")}`,
        });
        return false;
      }
    }
    return true;
  });

  return {
    raw,
    candidates,
    excluded,
    provenance: client.provenance(queriedAt),
    queriedAt,
  };
}

//////////////////////////////////////////////////////////////////////////////
// Explanation validation — task 4.10
//////////////////////////////////////////////////////////////////////////////

/**
 * The fields an explanation may cite, and how to read each one.
 *
 * An allowlist rather than a free-form path lookup, for two reasons. A model
 * inventing `agent.trustScore` should fail loudly rather than resolve to
 * undefined and be quietly treated as absent; and the allowlist is the list of
 * things the product is willing to claim a ranking was based on.
 *
 * `validation` is deliberately absent. It is not available on either Sepolia
 * network, and a citable field nobody can satisfy is an invitation to cite it.
 */
export const CITABLE_FIELDS: Record<
  string,
  (agent: NormalisedAgent) => unknown
> = {
  name: (a) => a.name,
  description: (a) => a.description,
  claimedEnsName: (a) => a.claimedEnsName,
  mcpEndpoint: (a) => a.mcpEndpoint,
  a2aEndpoint: (a) => a.a2aEndpoint,
  webEndpoint: (a) => a.webEndpoint,
  supportedTrusts: (a) => (a.supportedTrusts.length > 0 ? a.supportedTrusts : undefined),
  feedbackCount: (a) => a.reputation.feedbackCount,
  meanFeedbackValue: (a) => a.reputation.meanFeedbackValue,
  owner: (a) => a.owner,
  agentWallet: (a) => a.agentWallet,
};

export interface RankedAgent {
  graphAgentKey: string;
  score: number;
  reason: string;
  /** Field names from {@link CITABLE_FIELDS} the reason relies on. */
  citedFields: string[];
}

export interface ExplanationProblem {
  graphAgentKey: string;
  problem: string;
}

export interface ValidationOutcome {
  valid: boolean;
  problems: ExplanationProblem[];
}

/**
 * Check every ranked entry against the candidate it describes.
 *
 * The strongest claim this product makes about its AI track is that the
 * explanation is grounded in returned data, which makes this the check that
 * claim rests on. A cited field that is absent from the candidate is a bug and
 * fails the run — `docs/13` calls it out, and Gate B assertion 4 mutation-tests
 * this function rather than trusting its output.
 */
export function validateExplanation(
  ranked: RankedAgent[],
  candidates: NormalisedAgent[],
): ValidationOutcome {
  const byKey = new Map(candidates.map((c) => [c.graphAgentKey, c]));
  const problems: ExplanationProblem[] = [];

  for (const entry of ranked) {
    const candidate = byKey.get(entry.graphAgentKey);
    if (!candidate) {
      problems.push({
        graphAgentKey: entry.graphAgentKey,
        problem: "ranked an agent that was not in the candidate set",
      });
      continue;
    }

    if (entry.citedFields.length === 0) {
      problems.push({
        graphAgentKey: entry.graphAgentKey,
        problem: "cited no fields, so the reason cannot be checked against data",
      });
    }

    for (const field of entry.citedFields) {
      const read = CITABLE_FIELDS[field];
      if (!read) {
        problems.push({
          graphAgentKey: entry.graphAgentKey,
          problem: `cited ${field}, which is not a field this response carries`,
        });
        continue;
      }
      const value = read(candidate);
      if (value === undefined || value === null || value === "") {
        problems.push({
          graphAgentKey: entry.graphAgentKey,
          problem: `cited ${field}, which is absent on this candidate`,
        });
      }
    }
  }

  return { valid: problems.length === 0, problems };
}

//////////////////////////////////////////////////////////////////////////////
// Indexing-pending — task 4.13
//////////////////////////////////////////////////////////////////////////////

/**
 * What to show for an agent that was registered but is not yet in the index.
 *
 * `docs/17` Risk 3 has no engineering mitigation, so it gets a real UI state
 * instead of a spinner: the last time we checked, the transaction that proves
 * the registration exists, and a way to check again. The transaction hash is
 * the point — it is evidence the registration happened even while the thing
 * that would confirm it has not caught up.
 */
export interface IndexingPending {
  status: "indexing_pending";
  graphAgentKey: string;
  registrationTxHash?: string;
  lastCheckedAt: string;
  indexedBlock?: number;
}

export type DiscoveredAgent = NormalisedAgent | IndexingPending;

export function isIndexingPending(
  value: DiscoveredAgent,
): value is IndexingPending {
  return (value as IndexingPending).status === "indexing_pending";
}

/**
 * Look for one agent, reporting "not indexed yet" rather than "not found".
 *
 * The distinction matters to an operator who just registered: "we cannot find
 * your agent" and "the index has not reached your agent" call for different
 * actions, and only one of them is alarming.
 */
export async function findAgentOrPending(
  graphAgentKey: string,
  options: {
    client?: Agent0Client;
    registrationTxHash?: string;
  } = {},
): Promise<DiscoveredAgent> {
  const client = options.client ?? new Agent0Client();
  const agent = await client.agentProfile(graphAgentKey);
  if (agent) return agent;

  let indexedBlock: number | undefined;
  try {
    indexedBlock = (await client.indexingHead()).blockNumber;
  } catch {
    // The head is a nicety here; its absence must not turn a pending state
    // into a provider error.
  }

  return {
    status: "indexing_pending",
    graphAgentKey,
    ...(options.registrationTxHash && {
      registrationTxHash: options.registrationTxHash,
    }),
    lastCheckedAt: new Date().toISOString(),
    ...(indexedBlock !== undefined && { indexedBlock }),
  };
}

//////////////////////////////////////////////////////////////////////////////
// The browse cache — task 4.14
//////////////////////////////////////////////////////////////////////////////

/**
 * A short cache for the browse view, and an explicit way past it.
 *
 * `docs/09` permits caching and forbids treating the cache as truth, so a hit
 * says so: `cached: true` with the time the underlying query ran, which the
 * interface labels. `refresh: true` bypasses it entirely and re-queries — the
 * capability spec requires a refresh to reach the authoritative source rather
 * than return the cached value, so this is not a cache-warming call.
 *
 * Deliberately in-process and deliberately dumb: one entry per key, cleared by
 * time, no invalidation to get wrong. The same reasoning as the GitHub activity
 * memo in `apps/api`.
 */
export const BROWSE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  value: SearchAgent0Result;
}

const browseCache = new Map<string, CacheEntry>();

export interface CachedSearch extends SearchAgent0Result {
  cached: boolean;
}

function cacheKey(params: SearchAgent0Params): string {
  return JSON.stringify({
    requireMcp: params.requireMcp ?? false,
    trustModels: [...(params.trustModels ?? [])].sort(),
    network: params.network ?? "default",
    limit: params.limit ?? 25,
  });
}

export async function searchAgent0Cached(
  params: SearchAgent0Params = {},
  options: { refresh?: boolean; client?: Agent0Client; now?: number } = {},
): Promise<CachedSearch> {
  const now = options.now ?? Date.now();
  const key = cacheKey(params);

  if (!options.refresh) {
    const hit = browseCache.get(key);
    if (hit && now - hit.at < BROWSE_CACHE_TTL_MS) {
      return { ...hit.value, cached: true };
    }
  }

  const value = await searchAgent0(params, options.client);
  browseCache.set(key, { at: now, value });
  return { ...value, cached: false };
}

/** Tests and the gate runner, so one case cannot leak into the next. */
export function clearBrowseCache(): void {
  browseCache.clear();
}

//////////////////////////////////////////////////////////////////////////////
// Request logging — task 4.15
//////////////////////////////////////////////////////////////////////////////

/**
 * One record per discovery request.
 *
 * `docs/12` wants the AI path auditable, and the fields here are chosen so a
 * result can be reconstructed and argued with after the fact: what was asked,
 * where it was asked, how long it took, what came back, what was chosen, why,
 * and whether the explanation survived validation.
 */
export interface DiscoveryLogEntry {
  query: SearchAgent0Params;
  endpoint: string;
  chainId: number;
  subgraphId: string;
  queriedAt: string;
  durationMs: number;
  resultCount: number;
  filteredCount: number;
  selectedIds: string[];
  explanationValid: boolean;
  explanationProblems: ExplanationProblem[];
  cached: boolean;
  providerError?: string;
}

export function buildLogEntry(params: {
  query: SearchAgent0Params;
  search: CachedSearch;
  ranked: RankedAgent[];
  validation: ValidationOutcome;
  durationMs: number;
  providerError?: unknown;
}): DiscoveryLogEntry {
  return {
    query: params.query,
    // The gateway URL carries the API key, so the log records the provider and
    // the subgraph rather than the address — a log line is the last place a
    // credential should end up.
    endpoint: `agent0:${params.search.provenance.subgraphId}`,
    chainId: params.search.provenance.chainId,
    subgraphId: params.search.provenance.subgraphId,
    queriedAt: params.search.queriedAt,
    durationMs: params.durationMs,
    resultCount: params.search.raw.length,
    filteredCount: params.search.candidates.length,
    selectedIds: params.ranked.map((r) => r.graphAgentKey),
    explanationValid: params.validation.valid,
    explanationProblems: params.validation.problems,
    cached: params.search.cached,
    // A ternary rather than a conditional spread: `providerError` is `unknown`,
    // so `x && {...}` widens to `unknown | object` and cannot be spread.
    ...(params.providerError !== undefined
      ? {
          providerError:
            params.providerError instanceof Agent0ProviderError
              ? params.providerError.message
              : String(params.providerError),
        }
      : {}),
  };
}
