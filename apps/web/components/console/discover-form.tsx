"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { discover } from "@/lib/api";
import { classify, EMPTY_STATES } from "@/lib/console/errors";
import { graphStateFrom, LOADING_COPY } from "@/lib/console/state";
import { Absent, Badge, Empty, Loading, Outcome, Panel } from "./primitives";

/**
 * Screen 3 — Discover.
 *
 * A conversational box over live Agent0 data. The result card carries the
 * ranking's reason and, in the evidence drawer, the exact fields that reason
 * cites — task 7.11. That pairing is the whole claim: an explanation nobody can
 * check against data is a sentence, and this one is validated server-side
 * before it arrives.
 */

type Result = Awaited<ReturnType<typeof discover>>;

export function DiscoverForm() {
  const [query, setQuery] = useState(
    "Find a trustworthy research agent with MCP support",
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(refresh = false) {
    setBusy(true);
    setError(null);
    try {
      setResult(await discover({ query, refresh }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  // Keyed on the candidate count, not the rendered list. A ranking outage
  // leaves the candidates intact, and treating that as "nothing matched" would
  // tell the operator the market is empty when it is not.
  const state = graphStateFrom({
    error,
    resultCount: result?.candidateCount ?? 0,
  });
  const rankingUnavailable =
    result !== null && "error" in result.ranking && result.ranking.error;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
          placeholder="Find a trustworthy research agent with MCP support"
        />
        <div className="flex gap-2">
          <Button onClick={() => void run()} disabled={busy}>
            Search
          </Button>
          {/* An explicit refresh that bypasses the browse cache — task 4.14. */}
          <Button variant="outline" onClick={() => void run(true)} disabled={busy}>
            Refresh
          </Button>
        </div>
      </div>

      {/*
        The board specifies this exact string for "Graph read in progress"
        (task #88), so it is used verbatim rather than paraphrased. Note the
        wording describes waiting on the index rather than querying it — worth
        revisiting with whoever wrote the copy, but not worth silently
        diverging from an acceptance criterion.
      */}
      {busy ? <Loading what={LOADING_COPY.graph} /> : null}

      {state === "provider_error" ? (
        <Outcome
          tone="fault"
          title={classify({ error: error ?? "" }).title}
          detail={error ?? undefined}
          action="This is not an empty market — the query never reached the subgraph."
        />
      ) : null}

      {result ? (
        <>
          {state === "empty" ? (
            <Empty
              title={EMPTY_STATES.noGraphMatch.title}
              detail={EMPTY_STATES.noGraphMatch.detail}
            />
          ) : null}

          {rankingUnavailable ? (
            <Outcome
              tone="waiting"
              title="Ranking unavailable"
              detail={String(rankingUnavailable)}
              action="The candidates below are live and unranked. Nothing has been ordered or explained, so nothing is claimed about which fits best."
            />
          ) : null}

          <div className="flex flex-col gap-4">
            {result.results.map((agent) => (
              <Panel
                key={agent.graphId}
                title={agent.ensName ?? agent.name ?? agent.graphId}
                subtitle={agent.name ?? undefined}
              >
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">ERC 8004 #{agent.agentId}</Badge>
                  {agent.mcpEndpoint ? (
                    <Badge tone="good">MCP available</Badge>
                  ) : (
                    <Badge tone="neutral">no MCP</Badge>
                  )}
                  <Badge tone="neutral">
                    feedback {agent.signals.feedbackCount}
                    {agent.signals.revokedExcluded > 0
                      ? ` (${agent.signals.revokedExcluded} revoked, excluded)`
                      : ""}
                  </Badge>
                  {/*
                    The trust row drops rather than showing a zero — task 4.11.
                    No ValidationRegistry exists on this network, and an agent
                    nobody validated has not scored zero.
                  */}
                  {agent.signals.validation.available ? (
                    <Badge tone="good">
                      validation {agent.signals.validation.completed} completed
                    </Badge>
                  ) : null}
                </div>

                {!agent.signals.validation.available ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {EMPTY_STATES.noValidation.detail}
                  </p>
                ) : null}

                {agent.reason ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium">Why this agent</p>
                    <p className="text-sm leading-relaxed">{agent.reason}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Unranked — the ranking step did not run, so there is no
                    reason to show.
                  </p>
                )}

                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    Evidence — the exact fields this reason cites
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1 font-mono text-[0.65rem]">
                    {agent.citedFields.map((field) => (
                      <li key={field}>· {field}</li>
                    ))}
                    <li>· chain {result.dataSource.chainId}</li>
                    <li>· subgraph {result.dataSource.subgraphId}</li>
                    <li>· queried {result.dataSource.fetchedAt}</li>
                    <li>· owner {agent.owner}</li>
                    {agent.mcpEndpoint ? <li>· mcp {agent.mcpEndpoint}</li> : null}
                  </ul>
                </details>
              </Panel>
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              {result.candidateCount} candidate
              {result.candidateCount === 1 ? "" : "s"} from {result.rawCount} raw
              results · {result.excluded.length} excluded by the server-side
              filter · ranked by {result.ranking.model ?? "no model"}
            </p>
            <p>
              Source: {result.dataSource.provider} · chain{" "}
              {result.dataSource.chainId} · subgraph{" "}
              <span className="font-mono">{result.dataSource.subgraphId}</span> ·
              read {result.dataSource.fetchedAt}
              {result.dataSource.cached ? " · served from cache" : ""}
            </p>
            <p>
              Explanation check:{" "}
              {result.explanationValid ? (
                <Badge tone="good">every cited field present</Badge>
              ) : (
                <Badge tone="bad">
                  {result.explanationProblems.length} unsupported citation
                  {result.explanationProblems.length === 1 ? "" : "s"}
                </Badge>
              )}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
