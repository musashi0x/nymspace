import { Hono } from "hono";
import {
  agentEndpointKey,
  agentRegistrationKey,
  encodeDnsName,
} from "@nymspace/ens";

/**
 * Key construction for one agent name. Pure derivation, no chain access — the
 * chain-reading routes arrive with the Day 1 spike, once `EnsService` has a
 * verified client and a real resource deriver behind it.
 *
 * It exists now because it proves the thing worth proving: this server imports
 * the same `@nymspace/ens` the Next route handlers import, with no second copy.
 */
export const agents = new Hono();

agents.get("/:name/keys", (c) => {
  const name = c.req.param("name");
  const registry = c.req.query("registry");
  const agentId = c.req.query("agentId");

  if (registry && !/^0x[0-9a-fA-F]{40}$/.test(registry)) {
    return c.json({ error: "registry must be a 20-byte address" }, 400);
  }
  if (Boolean(registry) !== Boolean(agentId)) {
    return c.json({ error: "registry and agentId must be given together" }, 400);
  }

  return c.json({
    name,
    dnsName: encodeDnsName(name),
    keys: {
      context: "agent-context",
      mcp: agentEndpointKey("mcp"),
      a2a: agentEndpointKey("a2a"),
      registration:
        registry && agentId
          ? agentRegistrationKey({
              chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111),
              registry: registry as `0x${string}`,
              agentId,
            })
          : null,
    },
  });
});
