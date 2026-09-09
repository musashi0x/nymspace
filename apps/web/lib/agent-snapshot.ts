import type { AgentSnapshot } from "@nymspace/core";
import { apiBaseUrl } from "./api";

/**
 * Data source for the Agent Inspector.
 *
 * `GET /v1/agents/:name/snapshot` does not exist yet — it arrives with the
 * ENSv2 read endpoints. Until then this returns a placeholder so the screen can
 * be built and reviewed, and it says so in the return value.
 *
 * That flag is not decoration. Task #84's first acceptance criterion is that
 * the page renders live ENS data and not mock data, and the strategy doc's
 * whole complaint is about fixtures that read as real. So the source is part of
 * the contract, the page renders a warning while it is `placeholder`, and the
 * criterion stays visibly unmet until the endpoint lands rather than appearing
 * to pass because a fixture looks plausible.
 *
 * When the route ships, delete `PLACEHOLDER` and the `placeholder` arm. Nothing
 * else in the UI changes: it already renders `AgentSnapshot`.
 */

export type SnapshotResult =
  | { source: "live"; snapshot: AgentSnapshot }
  | { source: "placeholder"; snapshot: AgentSnapshot; reason: string }
  | { source: "error"; reason: string };

const SNAPSHOT_PATH = (name: string) =>
  `${apiBaseUrl}/v1/agents/${encodeURIComponent(name)}/snapshot`;

export async function fetchAgentSnapshot(
  name: string,
): Promise<SnapshotResult> {
  let res: Response;
  try {
    res = await fetch(SNAPSHOT_PATH(name), { cache: "no-store" });
  } catch (cause) {
    return {
      source: "placeholder",
      snapshot: placeholderSnapshot(name),
      reason:
        cause instanceof Error && cause.message
          ? `The API is not reachable (${cause.message}).`
          : "The API is not reachable.",
    };
  }

  // 404 is the expected answer until the route exists, and is not an error.
  if (res.status === 404) {
    return {
      source: "placeholder",
      snapshot: placeholderSnapshot(name),
      reason:
        "GET /v1/agents/:name/snapshot is not implemented yet, so no chain reads have happened.",
    };
  }

  if (!res.ok) {
    return {
      source: "error",
      reason: `The API answered ${res.status} for this name.`,
    };
  }

  return { source: "live", snapshot: (await res.json()) as AgentSnapshot };
}

/**
 * Shape-only placeholder. Every permission is `unknown` rather than
 * allowed/denied, because nothing has been read — showing a green "Allowed"
 * here would be inventing a chain state, which is the exact failure the
 * Inspector exists to make impossible.
 */
function placeholderSnapshot(name: string): AgentSnapshot {
  const parent = name.split(".").slice(1).join(".") || "nymspace.eth";
  const unread = (domain: "registry" | "resolver") =>
    ({
      state: "unknown",
      unavailableReason: "No chain read has been performed.",
      resource: "0x" as const,
      domain,
    }) as const;

  return {
    identity: {
      name,
      parent,
      owner: null,
      controller: null,
      resolver: null,
      registry: null,
    },
    records: { values: {}, unreadable: [] },
    authority: [
      {
        capability: "record:agent-context",
        label: "Edit agent-context",
        domain: "resolver",
        controller: unread("resolver"),
        organization: unread("resolver"),
      },
      {
        capability: "record:agent-endpoint[mcp]",
        label: "Edit MCP endpoint",
        domain: "resolver",
        controller: unread("resolver"),
        organization: unread("resolver"),
      },
      {
        capability: "record:agent-endpoint[a2a]",
        label: "Edit A2A endpoint",
        domain: "resolver",
        controller: unread("resolver"),
        organization: unread("resolver"),
      },
      {
        capability: "record:agent-registration",
        label: "Edit ENSIP 25 binding",
        domain: "resolver",
        controller: unread("resolver"),
        organization: unread("resolver"),
      },
      {
        capability: "registry:setResolver",
        label: "Change resolver",
        domain: "registry",
        controller: unread("registry"),
        organization: unread("registry"),
      },
      {
        capability: "registry:setSubregistry",
        label: "Change subregistry",
        domain: "registry",
        controller: unread("registry"),
        organization: unread("registry"),
      },
      {
        capability: "registry:transfer",
        label: "Transfer identity",
        domain: "registry",
        controller: unread("registry"),
        organization: unread("registry"),
      },
    ],
    ensip25: {
      status: "unavailable",
      reason: "The runtime verification endpoint is not implemented yet.",
    },
    provenance: {
      chainId: 11155111,
      blockNumber: "0",
      readAt: new Date(0).toISOString(),
      contracts: { registry: null, resolver: null },
    },
  };
}
