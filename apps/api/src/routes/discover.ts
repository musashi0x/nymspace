import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import {
  Agent0ProviderError,
  buildLogEntry,
  rankAgents,
  searchAgent0Cached,
  validateExplanation,
  RankingProviderError,
} from "@nymspace/graph";
import { ORGANIZATION_ID, type DepsEnv } from "../deps";
import { discoverSchema, readAt } from "./shared";

/**
 * Discovery, from `docs/10_API_CONTRACT.md`.
 *
 * The search runs server-side and the model ranks over what it returned —
 * design.md D4. The response carries the candidates, the ranking, the
 * explanation, the validator's verdict on that explanation, and the provider it
 * all came from, because a ranking whose provenance is missing is a claim.
 */

export const discover = new Hono<DepsEnv>().post(
  "/",
  zValidator("json", discoverSchema),
  async (c) => {
    const { store, graph } = c.var.deps;
    const { query, requireMcp, trustModels, limit, refresh } = c.req.valid("json");
    const startedAt = Date.now();

    let search;
    try {
      search = await searchAgent0Cached(
        { requireMcp, ...(trustModels && { trustModels }), limit },
        { client: graph, refresh },
      );
    } catch (error) {
      /**
       * A provider outage is not an empty market — task 4.16.
       *
       * 502 rather than an empty result list, because "no agents matched" and
       * "we could not ask" are different answers and a caller that cannot tell
       * them apart will render an outage as a market with nothing in it.
       */
      if (error instanceof Agent0ProviderError) {
        throw new HTTPException(502, {
          message: `discovery provider unavailable: ${error.message}`,
        });
      }
      throw error;
    }

    let ranked: Awaited<ReturnType<typeof rankAgents>> | undefined;
    let rankingError: string | undefined;
    try {
      ranked = await rankAgents(query, search.candidates);
    } catch (error) {
      // A ranking failure degrades to an unranked list rather than failing the
      // request: the candidates are real and useful without an explanation, and
      // the caller is told the ranking is missing rather than shown an order
      // nothing produced.
      rankingError =
        error instanceof RankingProviderError ? error.message : String(error);
    }

    const validation =
      ranked?.validation ?? validateExplanation([], search.candidates);

    const log = buildLogEntry({
      query: { capability: query, requireMcp, limit },
      search,
      ranked: ranked?.ranked ?? [],
      validation,
      durationMs: Date.now() - startedAt,
      ...(rankingError && { providerError: rankingError }),
    });

    await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      source: "graph",
      type: "graph.discovery.executed",
      status: rankingError ? "failed" : "success",
      occurredAt: search.queriedAt,
      summary: `Discovery for ${JSON.stringify(query)} returned ${search.candidates.length} candidates`,
      evidence: {
        source: "graph",
        chainId: search.provenance.chainId,
        subgraphId: search.provenance.subgraphId,
        queriedAt: search.provenance.queriedAt,
      },
      metadata: { log },
    });

    const byKey = new Map(search.candidates.map((a) => [a.graphAgentKey, a]));

    /**
     * When the ranking fails, the candidates still ship — unranked.
     *
     * They are real, they came from a live query, and they are useful without
     * an explanation. Returning an empty list instead would make a ranking
     * outage indistinguishable from an empty market, which is the same mistake
     * as returning zero candidates for a provider error one layer down.
     */
    const ordered: { graphAgentKey: string; score: number | null; reason: string | null; citedFields: string[] }[] =
      ranked?.ranked.map((entry) => ({
        graphAgentKey: entry.graphAgentKey,
        score: entry.score,
        reason: entry.reason,
        citedFields: entry.citedFields,
      })) ??
      search.candidates.map((agent) => ({
        graphAgentKey: agent.graphAgentKey,
        score: null,
        reason: null,
        citedFields: [],
      }));

    return c.json({
      query,
      results: ordered.flatMap((entry) => {
        const agent = byKey.get(entry.graphAgentKey);
        if (!agent) return [];
        return [
          {
            graphId: agent.graphAgentKey,
            agentId: agent.agentId,
            name: agent.name ?? null,
            ensName: agent.claimedEnsName ?? null,
            mcpEndpoint: agent.mcpEndpoint ?? null,
            owner: agent.owner,
            signals: {
              feedbackCount: agent.reputation.feedbackCount,
              revokedExcluded: agent.reputation.revokedExcluded,
              meanFeedbackValue: agent.reputation.meanFeedbackValue ?? null,
              // The union travels intact. A number here would let the console
              // render an absent dimension as a score — docs/04 forbids it, and
              // task 4.11 is the assertion.
              validation: agent.reputation.validation,
            },
            score: entry.score,
            reason: entry.reason,
            citedFields: entry.citedFields,
          },
        ];
      }),
      // Everything the query returned, so the console can show what the filter
      // removed rather than only what survived it.
      candidateCount: search.candidates.length,
      rawCount: search.raw.length,
      excluded: search.excluded,
      criteria: ranked?.criteria ?? [],
      explanationValid: validation.valid,
      explanationProblems: validation.problems,
      ranking: ranked
        ? { model: ranked.model, rankedAt: ranked.rankedAt }
        : { model: null, rankedAt: null, error: rankingError ?? null },
      dataSource: {
        provider: search.provenance.provider,
        chainId: search.provenance.chainId,
        subgraphId: search.provenance.subgraphId,
        fetchedAt: search.provenance.queriedAt,
        cached: search.cached,
      },
      readAt: readAt(),
    });
  },
);
