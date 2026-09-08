import { serverEnv } from "@nymspace/core/env";
import type { NormalisedAgent, RawAgentRegistration } from "./types";

/**
 * The Agent0 subgraph client.
 *
 * Deliberately thin: the query surface is settled on Day 2 against the live
 * subgraph, and guessing it now would produce queries that fail in a way the
 * response body explains better than this file could.
 */

export type Agent0Network = "sepolia" | "base-sepolia";

export interface Agent0ClientOptions {
  network?: Agent0Network;
  fetchImpl?: typeof fetch;
}

export class Agent0Client {
  private readonly network: Agent0Network;
  private readonly fetchImpl: typeof fetch;

  constructor({ network = "sepolia", fetchImpl = fetch }: Agent0ClientOptions = {}) {
    this.network = network;
    this.fetchImpl = fetchImpl;
  }

  private endpoint(): string {
    const env = serverEnv();
    const subgraphId =
      this.network === "sepolia"
        ? env.graph.agent0SepoliaSubgraphId
        : env.graph.agent0BaseSepoliaSubgraphId;

    if (!env.graph.apiKey) throw new Error("GRAPH_API_KEY is required");
    if (!subgraphId) {
      throw new Error(
        `Missing subgraph id for network ${this.network}; set the matching GRAPH_AGENT0_*_SUBGRAPH_ID`,
      );
    }

    return `https://gateway.thegraph.com/api/${env.graph.apiKey}/subgraphs/id/${subgraphId}`;
  }

  /** Execute one GraphQL query against the configured subgraph. */
  async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchImpl(this.endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: document, variables }),
    });

    if (!response.ok) {
      throw new Error(`Agent0 subgraph responded ${response.status}`);
    }

    const body = (await response.json()) as { data?: T; errors?: unknown[] };
    if (body.errors?.length) {
      throw new Error(`Agent0 subgraph error: ${JSON.stringify(body.errors)}`);
    }
    if (!body.data) throw new Error("Agent0 subgraph returned no data");

    return body.data;
  }
}

/**
 * Collapse a raw registration into the shape the UI consumes. Absent fields
 * stay absent rather than becoming empty strings, so "no MCP endpoint" renders
 * as a missing capability rather than a broken link.
 */
export function normaliseAgent(
  raw: RawAgentRegistration,
  reputation: NormalisedAgent["reputation"],
): NormalisedAgent {
  const endpoints = raw.endpoints ?? [];
  const find = (protocol: string) =>
    endpoints.find((e) => e.protocol === protocol)?.url ?? undefined;

  return {
    agentId: raw.agentId,
    registry: raw.registry,
    chainId: raw.chainId,
    claimedEnsName: raw.claimedEnsName ?? undefined,
    mcpEndpoint: find("mcp"),
    a2aEndpoint: find("a2a"),
    reputation,
  };
}
