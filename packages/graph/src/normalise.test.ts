import { describe, expect, it, beforeEach } from "vitest";
import {
  Agent0Client,
  Agent0ProviderError,
  normaliseAgent,
  normaliseReputation,
} from "./client";
import {
  CITABLE_FIELDS,
  clearBrowseCache,
  findAgentOrPending,
  isIndexingPending,
  searchAgent0,
  searchAgent0Cached,
  validateExplanation,
} from "./discovery";
import { validationReachesModel } from "./ranking";
import type { GraphProvenance, RawAgent, RawFeedback, RawValidation } from "./types";

/**
 * Task 4.5 — normalisation against every case `docs/13_TEST_PLAN.md` names:
 * missing MCP endpoint, missing ENS claim, no feedback, pending validation,
 * revoked feedback excluded. Plus task 4.16's provider-failure case.
 *
 * No network. The whole point of putting normalisation in the package rather
 * than the route is that these cases can be decided in one place and tested
 * without an HTTP server.
 */

const PROVENANCE: GraphProvenance = {
  provider: "agent0",
  chainId: 84532,
  subgraphId: "test-subgraph",
  queriedAt: "2026-09-09T00:00:00.000Z",
};

function rawAgent(overrides: Partial<RawAgent> = {}): RawAgent {
  return {
    id: "84532:1",
    chainId: "84532",
    agentId: "1",
    agentURI: "data:application/json;base64,e30=",
    agentURIType: "unknown",
    owner: "0xb5e8e4b8543f2b1093bdca55a3f7fd16f56f55c9",
    operators: [],
    createdAt: "1",
    updatedAt: "1",
    totalFeedback: "0",
    lastActivity: "1",
    registrationFile: {
      cid: "cid-1",
      name: "Research",
      description: "Finds things",
      supportedTrusts: [],
      oasfSkills: [],
      oasfDomains: [],
      mcpEndpoint: "https://mcp.example/agent",
      ens: "research.nymspace.eth",
    },
    feedback: [],
    validations: [],
    ...overrides,
  };
}

function feedback(overrides: Partial<RawFeedback> = {}): RawFeedback {
  return {
    id: "f1",
    clientAddress: "0x1111111111111111111111111111111111111111",
    value: "5",
    isRevoked: false,
    createdAt: "1",
    ...overrides,
  };
}

describe("normalisation keeps absent fields absent", () => {
  it("renders a missing MCP endpoint as absent, not an empty string", () => {
    const agent = normaliseAgent(
      rawAgent({
        registrationFile: {
          cid: "c",
          supportedTrusts: [],
          oasfSkills: [],
          oasfDomains: [],
          mcpEndpoint: null,
          ens: "research.nymspace.eth",
        },
      }),
      PROVENANCE,
    );

    expect(agent.mcpEndpoint).toBeUndefined();
    // The difference that matters: an empty string renders as a broken link,
    // undefined renders as a missing capability.
    expect(agent.mcpEndpoint).not.toBe("");
  });

  it("renders a missing ENS claim as absent", () => {
    const agent = normaliseAgent(
      rawAgent({
        registrationFile: {
          cid: "c",
          supportedTrusts: [],
          oasfSkills: [],
          oasfDomains: [],
          ens: null,
        },
      }),
      PROVENANCE,
    );
    expect(agent.claimedEnsName).toBeUndefined();
  });

  /**
   * The common live case, not an error. Agent0 parses a registration file only
   * from `ipfs://` and base64 data URIs, so every agent registered with an
   * `https://` URI arrives with no file at all.
   */
  it("handles an agent with no registration file at all", () => {
    const agent = normaliseAgent(
      rawAgent({ registrationFile: null, agentURIType: "https" }),
      PROVENANCE,
    );

    expect(agent.name).toBeUndefined();
    expect(agent.claimedEnsName).toBeUndefined();
    expect(agent.mcpEndpoint).toBeUndefined();
    expect(agent.supportedTrusts).toEqual([]);
    // Still a real agent with a real owner — absent metadata, not absent agent.
    expect(agent.owner).toBe("0xb5e8e4b8543f2b1093bdca55a3f7fd16f56f55c9");
  });
});

describe("reputation excludes revoked feedback and never invents validation", () => {
  it("counts no feedback as zero and says nothing more", () => {
    const reputation = normaliseReputation([], []);
    expect(reputation.feedbackCount).toBe(0);
    expect(reputation.revokedExcluded).toBe(0);
    expect(reputation.meanFeedbackValue).toBeUndefined();
  });

  it("excludes revoked feedback and reports how much it excluded", () => {
    const reputation = normaliseReputation(
      [
        feedback({ id: "a", value: "5" }),
        feedback({ id: "b", value: "1", isRevoked: true }),
        feedback({ id: "c", value: "3" }),
      ],
      [],
    );

    expect(reputation.feedbackCount).toBe(2);
    expect(reputation.revokedExcluded).toBe(1);
    // The mean is over live feedback only: including the revoked 1 would give 3.
    expect(reputation.meanFeedbackValue).toBe(4);
  });

  /**
   * The load-bearing one. No ValidationRegistry is deployed on either Sepolia
   * network, and an agent nobody validated is not an agent that scored zero.
   */
  it("reports absent validation as unavailable, with no number to weight", () => {
    const reputation = normaliseReputation([], []);

    expect(reputation.validation.available).toBe(false);
    expect(reputation.validation).not.toHaveProperty("completed");
    expect(reputation.validation).not.toHaveProperty("meanScore");
    if (!reputation.validation.available) {
      expect(reputation.validation.reason).toBe("none_recorded");
    }
  });

  it("distinguishes a network with no registry from an agent nobody validated", () => {
    const reputation = normaliseReputation([], [], {
      validationRegistryDeployed: false,
    });
    if (!reputation.validation.available) {
      expect(reputation.validation.reason).toBe("no_validation_registry");
    }
  });

  /**
   * `response` is 0-100 where 0 means pending. Averaging a pending zero in
   * would report a failing score for an agent that has not been assessed.
   */
  it("does not average a pending validation's zero into the score", () => {
    const validations: RawValidation[] = [
      { id: "v1", validatorAddress: "0x1", response: 0, status: "PENDING", createdAt: "1" },
      { id: "v2", validatorAddress: "0x2", response: 80, status: "COMPLETED", createdAt: "1" },
    ];
    const reputation = normaliseReputation([], validations);

    expect(reputation.validation.available).toBe(true);
    if (reputation.validation.available) {
      expect(reputation.validation.completed).toBe(1);
      expect(reputation.validation.pending).toBe(1);
      expect(reputation.validation.meanScore).toBe(80);
    }
  });
});

describe("the filter runs in code, before the model", () => {
  const client = (agents: RawAgent[]) =>
    new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: { agents } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });

  it("removes an agent with no MCP endpoint and says why", async () => {
    const result = await searchAgent0(
      { requireMcp: true },
      client([
        rawAgent({ id: "84532:1" }),
        rawAgent({
          id: "84532:2",
          registrationFile: {
            cid: "c",
            supportedTrusts: [],
            oasfSkills: [],
            oasfDomains: [],
            mcpEndpoint: null,
          },
        }),
      ]),
    );

    expect(result.raw).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.excluded).toEqual([
      { graphAgentKey: "84532:2", reason: "no MCP endpoint" },
    ]);
  });

  /**
   * Declaring no trust model is not the same as supporting every trust model.
   * The conservative reading is the one that cannot invent a capability.
   */
  it("excludes an agent that declares no trust model when one is required", async () => {
    const result = await searchAgent0(
      { trustModels: ["reputation"] },
      client([rawAgent()]),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.excluded[0]?.reason).toMatch(/does not declare reputation/);
  });
});

describe("a provider failure is not an empty market", () => {
  /** Task 4.16 and Gate B assertion 6. */
  it("throws a typed provider error rather than returning zero candidates", async () => {
    const failing = new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async () =>
        new Response("upstream is down", { status: 503 })) as unknown as typeof fetch,
    });

    await expect(searchAgent0({}, failing)).rejects.toBeInstanceOf(
      Agent0ProviderError,
    );
  });

  it("distinguishes an unreachable provider from a rejected one", async () => {
    const unreachable = new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });

    await expect(searchAgent0({}, unreachable)).rejects.toThrow(/unreachable/);
  });

  it("surfaces a GraphQL error body rather than treating it as no data", async () => {
    const erroring = new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "bad indexers" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
    });

    await expect(searchAgent0({}, erroring)).rejects.toThrow(/bad indexers/);
  });
});

describe("explanation validation", () => {
  const agent = normaliseAgent(rawAgent(), PROVENANCE);

  it("accepts a reason resting on fields the candidate carries", () => {
    const outcome = validateExplanation(
      [
        {
          graphAgentKey: "84532:1",
          score: 1,
          reason: "Has an MCP endpoint and describes itself as finding things.",
          citedFields: ["mcpEndpoint", "description"],
        },
      ],
      [agent],
    );
    expect(outcome.valid).toBe(true);
  });

  it("rejects a field that is absent on the candidate", () => {
    const outcome = validateExplanation(
      [
        {
          graphAgentKey: "84532:1",
          score: 1,
          reason: "It has an A2A endpoint.",
          citedFields: ["a2aEndpoint"],
        },
      ],
      [agent],
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.problems[0]?.problem).toMatch(/absent on this candidate/);
  });

  it("rejects a field name the response does not carry at all", () => {
    const outcome = validateExplanation(
      [
        {
          graphAgentKey: "84532:1",
          score: 1,
          reason: "It has the highest trust score.",
          citedFields: ["trustScore"],
        },
      ],
      [agent],
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.problems[0]?.problem).toMatch(/not a field this response carries/);
  });

  it("rejects a ranking over an agent that was not a candidate", () => {
    const outcome = validateExplanation(
      [
        {
          graphAgentKey: "84532:999",
          score: 1,
          reason: "Invented.",
          citedFields: ["name"],
        },
      ],
      [agent],
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.problems[0]?.problem).toMatch(/not in the candidate set/);
  });

  it("rejects a reason that cites nothing, since it cannot be checked", () => {
    const outcome = validateExplanation(
      [{ graphAgentKey: "84532:1", score: 1, reason: "It feels right.", citedFields: [] }],
      [agent],
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.problems[0]?.problem).toMatch(/cited no fields/);
  });

  /**
   * Task 4.11, from the other side: validation is not citable, so a ranking
   * cannot rest on it even if the model tries.
   */
  it("does not offer validation as a citable field", () => {
    expect(Object.keys(CITABLE_FIELDS)).not.toContain("validation");
    expect(validationReachesModel(agent)).toBe(false);
  });
});

describe("the browse cache is a cache, and a refresh is not", () => {
  beforeEach(() => clearBrowseCache());

  function countingClient() {
    let calls = 0;
    const client = new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: { agents: [rawAgent()] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    return { client, calls: () => calls };
  }

  it("serves a second identical request from cache, and labels it", async () => {
    const { client, calls } = countingClient();
    const first = await searchAgent0Cached({}, { client });
    const second = await searchAgent0Cached({}, { client });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls()).toBe(1);
    // The cached copy still carries the time the underlying query ran, which is
    // what lets the interface say how old it is instead of implying it is live.
    expect(second.queriedAt).toBe(first.queriedAt);
  });

  it("bypasses the cache on refresh and reaches the provider", async () => {
    const { client, calls } = countingClient();
    await searchAgent0Cached({}, { client });
    const refreshed = await searchAgent0Cached({}, { client, refresh: true });

    expect(refreshed.cached).toBe(false);
    expect(calls()).toBe(2);
  });

  it("expires, so a cache cannot outlive its window", async () => {
    const { client, calls } = countingClient();
    await searchAgent0Cached({}, { client, now: 0 });
    const later = await searchAgent0Cached({}, { client, now: 60_000 });

    expect(later.cached).toBe(false);
    expect(calls()).toBe(2);
  });

  it("does not serve one query's results for a different query", async () => {
    const { client, calls } = countingClient();
    await searchAgent0Cached({ requireMcp: true }, { client });
    await searchAgent0Cached({ requireMcp: false }, { client });
    expect(calls()).toBe(2);
  });
});

describe("indexing pending is a state, not a not-found", () => {
  it("reports pending with the registration hash when the agent is absent", async () => {
    const client = new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        const data = body.query.includes("_meta")
          ? { _meta: { block: { number: 42 }, hasIndexingErrors: false } }
          : { agent: null };
        return new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    const result = await findAgentOrPending("84532:9209", {
      client,
      registrationTxHash: `0x${"a".repeat(64)}`,
    });

    expect(isIndexingPending(result)).toBe(true);
    if (isIndexingPending(result)) {
      // The evidence that survives the wait: the registration happened even
      // though the thing that would confirm it has not caught up.
      expect(result.registrationTxHash).toBe(`0x${"a".repeat(64)}`);
      expect(result.indexedBlock).toBe(42);
      expect(Date.parse(result.lastCheckedAt)).not.toBeNaN();
    }
  });

  it("returns the agent once it is indexed", async () => {
    const client = new Agent0Client({
      network: "base-sepolia",
      apiKey: "test-key",
      subgraphId: "test-subgraph",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: { agent: rawAgent() } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });

    const result = await findAgentOrPending("84532:1", { client });
    expect(isIndexingPending(result)).toBe(false);
  });
});
