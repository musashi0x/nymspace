import { describe, expect, it } from "vitest";
import { UnpublishableEndpointError, type Hex } from "@nymspace/core";
import type { ChainConfig } from "./chain";
import { EnsService } from "./ens-service";
import { AGENT_CONTEXT_KEY, agentEndpointKey } from "./keys";

/**
 * The https backstop on `writeText`, driven with a client that records rather
 * than signs.
 *
 * The record route validates before it gets here. Provisioning and the scripts
 * do not, and this is what stops a local `AGENT_MCP_BASE_URL` from becoming a
 * transaction on a public record.
 */
function service() {
  const calls: unknown[] = [];
  const client = {
    writeContract: async (args: unknown) => {
      calls.push(args);
      return "0xabc" as Hex;
    },
  } as unknown as ConstructorParameters<typeof EnsService>[0]["client"];

  // `{}` so construction reads no environment. The resolver address is the one
  // piece of deployed config a write needs, and it is pinned on the instance.
  const ens = new EnsService({ client, config: {} as ChainConfig });
  Object.defineProperty(ens, "resolver", {
    get: () => "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
  });
  return { ens, calls };
}

const name = "research.nymspace.eth";
const mcp = agentEndpointKey("mcp");

describe("writeText and the MCP endpoint record", () => {
  it("refuses a local, plain-http or malformed endpoint before building a transaction", async () => {
    const { ens, calls } = service();
    for (const value of [
      "http://localhost:3112/mcp/research",
      "http://api.example.com/mcp/research",
      "not a url",
    ]) {
      await expect(
        ens.writeText({ name, key: mcp, value, as: "controller" }),
      ).rejects.toBeInstanceOf(UnpublishableEndpointError);
    }
    expect(calls).toHaveLength(0);
  });

  it("writes an https endpoint, query string and all", async () => {
    const { ens, calls } = service();
    await ens.writeText({
      name,
      key: mcp,
      value: "https://api.example.com/mcp/research?proof=1",
      as: "controller",
    });
    expect(calls).toHaveLength(1);
  });

  it("allows clearing the record", async () => {
    const { ens, calls } = service();
    await ens.writeText({ name, key: mcp, value: "" });
    expect(calls).toHaveLength(1);
  });

  it("does not police keys that are not an MCP endpoint", async () => {
    const { ens, calls } = service();
    await ens.writeText({ name, key: AGENT_CONTEXT_KEY, value: "http://anything" });
    expect(calls).toHaveLength(1);
  });
});
