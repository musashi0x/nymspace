import { describe, expect, it } from "vitest";
import {
  agentMcpEndpoint,
  isPublishableEndpoint,
  publishableAgentMcpEndpoint,
} from "./mcp";

describe("isPublishableEndpoint", () => {
  it("accepts https", () => {
    expect(isPublishableEndpoint("https://api.example.com/mcp/research")).toBe(true);
    expect(isPublishableEndpoint("https://api.example.com/mcp/research?proof=1")).toBe(true);
  });

  it("refuses everything else, including a local origin", () => {
    for (const value of [
      "http://localhost:3112/mcp/research",
      "http://api.example.com/mcp/research",
      "ws://api.example.com/mcp",
      "api.example.com/mcp/research",
      "",
    ]) {
      expect(isPublishableEndpoint(value), value).toBe(false);
    }
  });
});

describe("publishableAgentMcpEndpoint", () => {
  it("derives the endpoint from an https base", () => {
    expect(publishableAgentMcpEndpoint("https://api.example.com/", "research")).toBe(
      "https://api.example.com/mcp/research",
    );
  });

  it("refuses a missing base, naming the variable", () => {
    expect(() => publishableAgentMcpEndpoint(undefined, "research")).toThrow(
      /AGENT_MCP_BASE_URL is not set/,
    );
  });

  it("refuses a local base before anything is built around it", () => {
    expect(() =>
      publishableAgentMcpEndpoint("http://localhost:3112", "research"),
    ).toThrow(/must be https/);
  });
});

describe("agentMcpEndpoint", () => {
  it("joins the origin and the label", () => {
    expect(agentMcpEndpoint("https://api.example.com", "research")).toBe(
      "https://api.example.com/mcp/research",
    );
  });

  it("gives the same answer with or without a trailing slash", () => {
    expect(agentMcpEndpoint("https://api.example.com/", "research")).toBe(
      agentMcpEndpoint("https://api.example.com", "research"),
    );
  });

  it("drops the base's path, query and fragment", () => {
    expect(
      agentMcpEndpoint("https://api.example.com/v1/?proof=1#x", "research"),
    ).toBe("https://api.example.com/mcp/research");
  });

  it("never carries a query string", () => {
    const url = new URL(agentMcpEndpoint("https://api.example.com/?a=b", "deploy"));
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("keeps a local origin's scheme and port", () => {
    expect(agentMcpEndpoint("http://localhost:3112", "trader")).toBe(
      "http://localhost:3112/mcp/trader",
    );
  });

  it("refuses anything that is not a label", () => {
    for (const bad of ["", "Research", "../admin", "a/b", "-x", "x-", "a?b"]) {
      expect(() => agentMcpEndpoint("https://api.example.com", bad)).toThrow(
        /not an agent label/,
      );
    }
  });

  it("refuses a base that is not a URL", () => {
    expect(() => agentMcpEndpoint("api.example.com", "research")).toThrow();
  });
});
