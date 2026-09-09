"use client";

import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { discover } from "@/lib/api";
import { classify, EMPTY_STATES } from "@/lib/console/errors";
import { graphStateFrom, LOADING_COPY } from "@/lib/console/state";
import { Absent, Badge, Empty, Loading, Outcome, Frame } from "./primitives";

/**
 * Screen 3 — Discover.
 *
 * A conversational box over live Agent0 data. The result card carries the
 * ranking's reason and, in the evidence drawer, the exact fields that reason
 * cites — task 7.11. That pairing is the whole claim: an explanation nobody can
 * check against data is a sentence, and this one is validated server-side
 * before it arrives.
 *
 * These stay framed cards rather than becoming table rows. `AGENTS.md` reserves
 * rows for uniform data and points inconsistent content at a list or card
 * layout, and a discovery result is not uniform: the reason is a paragraph of
 * varying length, the validation row drops entirely when no registry exists,
 * and the cited fields differ per agent. A table would truncate the one part of
 * this screen the product is actually claiming.
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
    <VStack gap={6}>
      <HStack gap={3} wrap="wrap" align="end">
        <TextInput
          label="Query"
          isLabelHidden
          value={query}
          onChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder="Find a trustworthy research agent with MCP support"
          width="100%"
          xstyle={undefined}
        />
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Search"
            onClick={() => void run()}
            isDisabled={busy}
          />
          {/* An explicit refresh that bypasses the browse cache — task 4.14. */}
          <Button
            variant="secondary"
            label="Refresh"
            onClick={() => void run(true)}
            isDisabled={busy}
          />
        </HStack>
      </HStack>

      {busy ? <Loading what={LOADING_COPY.discovery} /> : null}

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

          <VStack gap={4}>
            {result.results.map((agent) => (
              <Frame
                key={agent.graphId}
                title={agent.ensName ?? agent.name ?? agent.graphId}
                subtitle={agent.name ?? undefined}
              >
                <HStack gap={2} wrap="wrap">
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
                </HStack>

                {!agent.signals.validation.available ? (
                  <Text type="supporting" as="p">
                    {EMPTY_STATES.noValidation.detail}
                  </Text>
                ) : null}

                {agent.reason ? (
                  <VStack gap={1}>
                    <Text type="label">Why this agent</Text>
                    <Text as="p">{agent.reason}</Text>
                  </VStack>
                ) : (
                  <Absent what="the ranking step did not run, so there is no reason to show" />
                )}

                <Collapsible
                  defaultIsOpen={false}
                  trigger={
                    <Text type="supporting">
                      Evidence — the exact fields this reason cites
                    </Text>
                  }
                >
                  {/*
                    A VStack of mono lines rather than List/ListItem: Astryx's
                    ListItem takes a `label` string, and these need the code
                    face and break-all so a subgraph id or an owner address
                    wraps instead of escaping the frame.
                  */}
                  <VStack gap={1}>
                    {[
                      ...agent.citedFields,
                      `chain ${result.dataSource.chainId}`,
                      `subgraph ${result.dataSource.subgraphId}`,
                      `queried ${result.dataSource.fetchedAt}`,
                      `owner ${agent.owner}`,
                      ...(agent.mcpEndpoint ? [`mcp ${agent.mcpEndpoint}`] : []),
                    ].map((line) => (
                      <Text
                        key={line}
                        type="code"
                        size="2xs"
                        color="secondary"
                        hasTabularNumbers
                        wordBreak="break-all"
                      >
                        {line}
                      </Text>
                    ))}
                  </VStack>
                </Collapsible>
              </Frame>
            ))}
          </VStack>

          <Frame title="result provenance">
            <Text type="supporting" as="p">
              {result.candidateCount} candidate
              {result.candidateCount === 1 ? "" : "s"} from {result.rawCount} raw
              results · {result.excluded.length} excluded by the server-side
              filter · ranked by {result.ranking.model ?? "no model"}
            </Text>
            <Text type="supporting" as="p">
              Source: {result.dataSource.provider} · chain{" "}
              {result.dataSource.chainId} · subgraph{" "}
              <Text type="code" size="2xs">
                {result.dataSource.subgraphId}
              </Text>{" "}
              · read {result.dataSource.fetchedAt}
              {result.dataSource.cached ? " · served from cache" : ""}
            </Text>
            <Text type="supporting" as="p">
              Explanation check:{" "}
              {result.explanationValid ? (
                <Badge tone="good">every cited field present</Badge>
              ) : (
                <Badge tone="bad">
                  {result.explanationProblems.length} unsupported citation
                  {result.explanationProblems.length === 1 ? "" : "s"}
                </Badge>
              )}
            </Text>
          </Frame>
        </>
      ) : null}
    </VStack>
  );
}
