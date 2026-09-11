import { describe, expect, it } from "vitest";
import { normaliseAgent } from "./client";
import { CITABLE_FIELDS } from "./discovery";
import { candidateForModel } from "./ranking";
import type { GraphProvenance, RawAgent, RawRegistrationFile } from "./types";

/**
 * `mcpTools`: carried as a claim, empty treated as none, never ranked.
 *
 * The subgraph types the field `[String!]!` on both networks, so a
 * registration that lists no tools arrives as `[]` exactly like one that never
 * mentions them. Normalisation cannot recover a distinction the provider does
 * not keep, so `[]` is no claim.
 */

const PROVENANCE: GraphProvenance = {
  provider: "agent0",
  chainId: 84532,
  subgraphId: "test-subgraph",
  queriedAt: "2026-09-11T00:00:00.000Z",
};

function agentWith(file: Partial<RawRegistrationFile> | null): RawAgent {
  return {
    id: "84532:9",
    chainId: "84532",
    agentId: "9",
    owner: "0xb5e8e4b8543f2b1093bdca55a3f7fd16f56f55c9",
    operators: [],
    createdAt: "1",
    updatedAt: "1",
    totalFeedback: "0",
    lastActivity: "1",
    registrationFile:
      file === null
        ? null
        : {
            cid: "cid-9",
            name: "Pricer",
            supportedTrusts: [],
            oasfSkills: [],
            oasfDomains: [],
            mcpEndpoint: "https://mcp.example/pricer",
            ...file,
          },
    feedback: [],
    validations: [],
  };
}

describe("mcpTools through normalisation", () => {
  it("carries a non-empty list as the agent's claimed tools", () => {
    const agent = normaliseAgent(agentWith({ mcpTools: ["get_price", "place_order"] }), PROVENANCE);
    expect(agent.mcpTools).toEqual(["get_price", "place_order"]);
  });

  it("treats an empty list as no claim", () => {
    const agent = normaliseAgent(agentWith({ mcpTools: [] }), PROVENANCE);
    expect(agent).not.toHaveProperty("mcpTools");
  });

  it("treats a missing field as no claim", () => {
    const agent = normaliseAgent(agentWith({}), PROVENANCE);
    expect(agent).not.toHaveProperty("mcpTools");
  });

  it("has no claim when the registration file never parsed", () => {
    const agent = normaliseAgent(agentWith(null), PROVENANCE);
    expect(agent).not.toHaveProperty("mcpTools");
  });
});

describe("claims do not rank", () => {
  it("is not a citable field", () => {
    expect(Object.keys(CITABLE_FIELDS)).not.toContain("mcpTools");
  });

  it("leaves the model's view of a candidate unchanged", () => {
    const without = normaliseAgent(agentWith({}), PROVENANCE);
    const withClaim = normaliseAgent(
      agentWith({ mcpTools: ["get_price", "place_order"] }),
      PROVENANCE,
    );

    expect(withClaim.mcpTools).toBeDefined();
    expect(candidateForModel(withClaim)).toEqual(candidateForModel(without));
    expect(JSON.stringify(candidateForModel(withClaim))).not.toContain("place_order");
  });
});
