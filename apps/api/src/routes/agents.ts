import { Hono } from "hono";
import { validator } from "hono/validator";
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
 * the same `@nymspace/ens` the packages expose, with no second copy.
 *
 * Validation runs in a `validator` rather than inside the handler for two
 * reasons. It rejects malformed input before any domain call, which the spec
 * requires; and it is what gives the query parameters a type, so `hono/client`
 * can describe this route to the web application. Hono's own validator is used
 * rather than a schema library — two checks do not earn a dependency.
 */
export const agents = new Hono().get(
  "/:name/keys",
  validator("query", (value, c) => {
    const registry = value["registry"] as string | undefined;
    const agentId = value["agentId"] as string | undefined;

    if (registry && !/^0x[0-9a-fA-F]{40}$/.test(registry)) {
      return c.json({ error: "registry must be a 20-byte address" }, 400);
    }
    if (Boolean(registry) !== Boolean(agentId)) {
      return c.json(
        { error: "registry and agentId must be given together" },
        400,
      );
    }

    return { registry, agentId };
  }),
  (c) => {
    const name = c.req.param("name");
    const { registry, agentId } = c.req.valid("query");

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
  },
);
