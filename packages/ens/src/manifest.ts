import type { Address, ChainId } from "@nymspace/core";
import type { EnsService } from "./ens-service";
import type { Erc8004Service } from "./erc8004";
import { AGENT_CONTEXT_KEY, agentEndpointKey } from "./keys";
import { verifyEnsip25, type Ensip25Result } from "./ensip25";

/**
 * The Agent Manifest, assembled per request.
 *
 * `docs/06` says the manifest is a UX representation of ENS records plus linked
 * registry state, and `docs/04` repeats it. So this is a function, not a table:
 * there is no manifest entity, no manifest cache that outlives a request, and
 * no invalidation step to get wrong. Task 3.16 asserts the consequence — a
 * record changed on chain changes the next assembled manifest, with nothing in
 * between.
 *
 * The alternative, materialising on write, is the exact failure the product
 * argues against. It would also be quietly wrong the moment a record changed
 * underneath it, and wrong in the direction that looks fine.
 *
 * Every field carries where it was read from, because a manifest that mixes
 * three systems and labels none of them is asking the operator to guess which
 * one to distrust.
 */

export type ManifestSource = "ens" | "erc8004";

/** One field, with its provenance attached rather than implied. */
export interface ManifestField<T> {
  value: T;
  source: ManifestSource;
  /** The ENSIP 26 key, for an ENS-sourced field. */
  key?: string;
  chainId: ChainId;
  readAt: string;
}

export interface AgentManifest {
  name: string;
  /** Registry state, absent when the agent has no ERC 8004 registration. */
  registration?: {
    agentId: string;
    registry: Address;
    chainId: ChainId;
    owner: Address;
    claimedEnsName?: string;
  };
  context?: ManifestField<string>;
  endpoints: {
    mcp?: ManifestField<string>;
    a2a?: ManifestField<string>;
  };
  /** The full seven-state result, never a boolean. */
  verification: Ensip25Result | { status: "unchecked" };
  /** When this assembly started. The manifest as a whole is only true as of here. */
  assembledAt: string;
}

export interface AssembleManifestParams {
  name: string;
  ens: Pick<EnsService, "readText">;
  ensChainId: ChainId;
  /**
   * Absent for an agent with no ERC 8004 registration — which is most agents
   * for most of this change, and a normal state rather than an error.
   */
  registration?: {
    agentId: string;
    service: Erc8004Service;
  };
}

/**
 * Read every field the manifest shows, now.
 *
 * The ENS reads run together because they are independent and the manifest is
 * on a request path. The verification runs after, because it needs the registry
 * claim, and it is allowed to fail: a manifest with `rpc_error` verification is
 * still a useful manifest, while one that throws is a blank screen.
 */
export async function assembleManifest(
  params: AssembleManifestParams,
): Promise<AgentManifest> {
  const { name, ens, ensChainId } = params;
  const assembledAt = new Date().toISOString();

  const mcpKey = agentEndpointKey("mcp");
  const a2aKey = agentEndpointKey("a2a");

  const [context, mcp, a2a] = await Promise.all([
    ens.readText(name, AGENT_CONTEXT_KEY),
    ens.readText(name, mcpKey),
    ens.readText(name, a2aKey),
  ]);

  const field = (value: string, key: string): ManifestField<string> | undefined =>
    value.length > 0
      ? { value, source: "ens", key, chainId: ensChainId, readAt: assembledAt }
      : undefined;

  const manifest: AgentManifest = {
    name,
    ...(context.length > 0 && {
      context: field(context, AGENT_CONTEXT_KEY),
    }),
    endpoints: {
      ...(field(mcp, mcpKey) && { mcp: field(mcp, mcpKey) }),
      ...(field(a2a, a2aKey) && { a2a: field(a2a, a2aKey) }),
    },
    verification: { status: "unchecked" },
    assembledAt,
  };

  if (!params.registration) return manifest;

  const { agentId, service } = params.registration;

  // Registry state and verification, both live. An agent id we hold but a
  // registry that cannot answer is an `rpc_error` verification and an absent
  // registration block — not a thrown request.
  try {
    const [owner, file] = await Promise.all([
      service.ownerOf(agentId),
      service.registrationFile(agentId),
    ]);
    manifest.registration = {
      agentId,
      registry: service.registry,
      chainId: service.chainId,
      owner,
      ...(file?.services.find((s) => s.name === "ens")?.endpoint && {
        claimedEnsName: file.services.find((s) => s.name === "ens")!.endpoint,
      }),
    };
  } catch {
    // Left absent deliberately. The verification below reports the failure with
    // a reason, so swallowing it here loses nothing an operator can act on.
  }

  manifest.verification = await verifyEnsip25({
    ensName: name,
    agentId,
    registry: service.registry,
    chainId: service.chainId,
    erc8004: service,
    readText: (n, k) => ens.readText(n, k),
  });

  return manifest;
}
