import { describe, expect, it } from "vitest";
import { agentMcpEndpoint } from "./mcp";

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
