import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  AGENT_CONTEXT_KEY,
  agentEndpointKey,
  agentRegistrationKey,
  assembleManifest,
} from "@nymspace/ens";
import type {
  ConsoleAnswer,
  LensDetail,
  LensEdge,
  LensNode,
  LensTone,
} from "@nymspace/core";
import { ORGANIZATION_ID, REGISTRATION_CHAIN_ID, type DepsEnv } from "../deps";
import { readAt } from "./shared";

/**
 * The console's chat, answered from live reads rather than from a model.
 *
 * There is no language model behind this and that is the design, not a
 * shortcut. The product's claim is that everything displayed is derived from
 * the system that owns it — so an answer here is assembled from the same ENS,
 * ERC 8004 and EAC reads the Inspector uses, and the intent step is a matcher
 * over a small vocabulary rather than a generator. A model asked to describe a
 * permission can be fluent and wrong; a matcher can only be one or the other,
 * and when it is wrong it says so.
 *
 * That is why {@link LensUnanswered} exists as a separate shape. A question
 * this cannot parse gets a list of questions it can, not an empty diagram —
 * an empty diagram is a claim about the fleet, and the failure here is a
 * failure to understand, which is a claim about the question.
 *
 * Intents, deliberately few:
 *
 *   fleet          every agent against every track
 *   agent <name>   one agent's identity, authority and records
 *
 * Adding a third means adding a matcher and a builder, both of which are read
 * paths. Nothing in this file writes.
 */

const askSchema = z.object({
  message: z.string().min(1).max(400),
});

const SUGGESTIONS = [
  "show me the fleet",
  "show research",
  "who can write agent-context on research",
] as const;

export const chat = new Hono<DepsEnv>().post(
  "/",
  zValidator("json", askSchema),
  async (c) => {
    const message = c.req.valid("json").message.trim();
    const answer = await route(message, c.var.deps);
    return c.json(answer);
  },
);

type Deps = DepsEnv["Variables"]["deps"];

async function route(message: string, deps: Deps): Promise<ConsoleAnswer> {
  const text = message.toLowerCase();

  if (/\b(fleet|agents|everything|all)\b/.test(text) && !nameIn(text, deps)) {
    return fleetLens(deps);
  }

  const slug = await matchAgent(text, deps);
  if (slug) return agentLens(slug, deps);

  return {
    kind: "unanswered",
    message:
      "I did not recognise an agent or a topic in that. I answer from live ENS, ERC 8004 and permission reads, so I can only answer about things I can go and check.",
    suggestions: [...SUGGESTIONS],
  };
}

/** Cheap pre-check so "show me the agents" does not beat "show research". */
function nameIn(text: string, _deps: Deps): boolean {
  return /\b[a-z0-9-]+\.[a-z0-9-]+\.eth\b/.test(text);
}

/**
 * Match a question to an agent by slug or ENS name.
 *
 * Substring rather than fuzzy: a near-miss that resolves to the wrong agent
 * would answer confidently about something nobody asked about, and every
 * answer here carries an address someone might act on.
 */
async function matchAgent(text: string, deps: Deps): Promise<string | undefined> {
  const agents = await deps.store.listAgents(ORGANIZATION_ID);
  const hit = agents.find(
    (agent) =>
      text.includes(agent.ensName.toLowerCase()) ||
      new RegExp(`\\b${agent.slug.toLowerCase()}\\b`).test(text),
  );
  return hit?.id;
}

//////////////////////////////////////////////////////////////////////////////
// Fleet
//////////////////////////////////////////////////////////////////////////////

/**
 * Every agent against every system, one row each.
 *
 * The five provisioning tracks stay separate here for the same reason
 * `docs/09` keeps them separate in the store: collapsing them into one status
 * hides which integration is incomplete, and on this screen that would be a
 * green row for an agent with no wallet.
 */
async function fleetLens(deps: Deps): Promise<ConsoleAnswer> {
  const agents = await deps.store.listAgents(ORGANIZATION_ID);
  const lanes = ["ENS", "ERC 8004", "VERIFICATION"];

  const nodes: LensNode[] = [];
  const edges: LensEdge[] = [];
  const detail: LensDetail[] = [];

  for (const agent of agents) {
    const status = agent.provisioning;

    nodes.push({
      id: `${agent.id}:ens`,
      lane: "ENS",
      label: agent.ensName,
      sublabel: status.ens,
      badge: status.ens === "active" ? "active" : status.ens,
      tone: status.ens === "active" ? "active" : "unknown",
    });
    nodes.push({
      id: `${agent.id}:erc8004`,
      lane: "ERC 8004",
      label: agent.erc8004AgentId ? `#${agent.erc8004AgentId}` : "not registered",
      sublabel: status.erc8004,
      tone: status.erc8004 === "registered" ? "verified" : "absent",
    });
    nodes.push({
      id: `${agent.id}:ensip25`,
      lane: "VERIFICATION",
      label: status.ensip25 === "verified" ? "verified" : status.ensip25,
      sublabel: "ENSIP 25",
      tone: status.ensip25 === "verified" ? "verified" : "unknown",
    });

    edges.push({ from: `${agent.id}:ens`, to: `${agent.id}:erc8004`, tone: "active" });
    edges.push({
      from: `${agent.id}:erc8004`,
      to: `${agent.id}:ensip25`,
      label: "claims",
      tone: status.ensip25 === "verified" ? "verified" : "unknown",
    });

    detail.push({
      label: agent.ensName,
      value: `ens=${status.ens} erc8004=${status.erc8004} ensip25=${status.ensip25} graph=${status.graph} financial=${status.financial}`,
      provenance: "STORE",
    });
  }

  const verified = agents.filter(
    (a) => a.provisioning.ensip25 === "verified",
  ).length;

  return {
    kind: "lens",
    title: "Fleet",
    pills: [
      { label: `${agents.length} agents`, tone: "active" },
      { label: `${verified} verified`, tone: verified ? "verified" : "unknown" },
      {
        label: `${agents.length - verified} unverified`,
        tone: agents.length - verified ? "unknown" : "verified",
      },
    ],
    lanes,
    nodes,
    edges,
    caption: `${agents.length} agents across ${lanes.length} systems. Provisioning progress is the store's own record; open an agent to read its state from chain.`,
    detail,
    readAt: readAt(),
  };
}

//////////////////////////////////////////////////////////////////////////////
// One agent
//////////////////////////////////////////////////////////////////////////////

/**
 * One agent, read from chain in this request.
 *
 * The authority lane is the point of the whole console, so each of its cells is
 * a `canSetText` against the resolver's own fallback chain — the same call the
 * Inspector's matrix makes, not a copy of its answer. Every denial in it is
 * accompanied by the organization's own allowed cell in `detail`, because a
 * wrong resource derivation and a genuine denial produce the same value and
 * only a positive control in the same request separates them.
 */
async function agentLens(agentId: string, deps: Deps): Promise<ConsoleAnswer> {
  const { store, ens, erc8004, config, registry, organization } = deps;
  const agent = await store.getAgent(agentId);
  if (!agent) {
    return {
      kind: "unanswered",
      message: `I matched "${agentId}" but the store no longer has it.`,
      suggestions: [...SUGGESTIONS],
    };
  }

  const manifest = await assembleManifest({
    name: agent.ensName,
    ens,
    ensChainId: config.chainId,
    ...(agent.erc8004AgentId && {
      registration: { agentId: agent.erc8004AgentId, service: erc8004 },
    }),
  });

  const [owner, resolver] = await Promise.all([
    ens.findOwner(registry, agent.slug),
    ens.getResolver(registry, agent.slug),
  ]);

  const keys = [
    AGENT_CONTEXT_KEY,
    agentEndpointKey("mcp"),
    agentEndpointKey("a2a"),
    ...(agent.erc8004AgentId && agent.erc8004Registry
      ? [
          agentRegistrationKey({
            chainId: REGISTRATION_CHAIN_ID,
            registry: agent.erc8004Registry,
            agentId: agent.erc8004AgentId,
          }),
        ]
      : []),
  ];

  /**
   * Every cell at once.
   *
   * Sequentially this was eight round trips to Sepolia and the answer took
   * about five seconds, which on a chat screen is long enough that the loading
   * line stops reading as progress. The cells are independent — each is one
   * `hasRoles` against its own resource — so nothing is lost by asking
   * together, and the positive control goes in the same batch so it is still
   * the same request it is controlling for.
   */
  const [controllerCells, control] = await Promise.all([
    Promise.all(
      keys.map(async (key) => ({
        key,
        allowed: await ens.canSetText(
          agent.ensName,
          key,
          agent.controllerAddress,
        ),
      })),
    ),
    ens.canSetText(agent.ensName, agentEndpointKey("mcp"), organization),
  ]);

  const allowed: Record<string, boolean> = Object.fromEntries(
    controllerCells.map((cell) => [cell.key, cell.allowed]),
  );

  const values: Record<string, string | null> = {
    [AGENT_CONTEXT_KEY]: manifest.context?.value ?? null,
    [agentEndpointKey("mcp")]: manifest.endpoints.mcp?.value ?? null,
    [agentEndpointKey("a2a")]: manifest.endpoints.a2a?.value ?? null,
  };

  const lanes = ["IDENTITY", "AUTHORITY", "RECORDS"];
  const nodes: LensNode[] = [];
  const edges: LensEdge[] = [];

  const verified = manifest.verification.status === "verified";

  nodes.push({
    id: "name",
    lane: "IDENTITY",
    label: agent.ensName,
    sublabel: `owner ${short(owner)}`,
    badge: verified ? "verified" : manifest.verification.status,
    tone: verified ? "verified" : "unknown",
  });

  if (agent.erc8004AgentId) {
    nodes.push({
      id: "registration",
      lane: "IDENTITY",
      label: `ERC 8004 #${agent.erc8004AgentId}`,
      sublabel: `chain ${REGISTRATION_CHAIN_ID}`,
      tone: "verified",
    });
    edges.push({
      from: "registration",
      to: "name",
      label: "claims",
      tone: verified ? "verified" : "unknown",
    });
  }

  for (const key of keys) {
    const id = `perm:${key}`;
    const permitted = allowed[key] === true;
    nodes.push({
      id,
      lane: "AUTHORITY",
      label: shortKey(key),
      sublabel: `controller ${short(agent.controllerAddress)}`,
      badge: permitted ? "allowed" : "denied",
      tone: permitted ? "active" : "denied",
    });
    edges.push({ from: "name", to: id, tone: permitted ? "active" : "denied" });

    const value = values[key];
    if (value !== undefined) {
      const recordId = `rec:${key}`;
      nodes.push({
        id: recordId,
        lane: "RECORDS",
        label: shortKey(key),
        sublabel: value ? truncate(value) : "not set",
        tone: value ? "active" : "absent",
      });
      edges.push({
        from: id,
        to: recordId,
        label: permitted ? "may write" : "may not write",
        tone: permitted ? "active" : "denied",
      });
    }
  }

  const allowedCount = Object.values(allowed).filter(Boolean).length;

  const detail: LensDetail[] = [
    { label: "Owner", value: owner, provenance: `CHAIN ${config.chainId}` },
    { label: "Controller", value: agent.controllerAddress, provenance: "STORE" },
    { label: "Registry", value: registry, provenance: `CHAIN ${config.chainId}` },
    { label: "Resolver", value: resolver, provenance: `CHAIN ${config.chainId}` },
    {
      label: "ENSIP 25",
      value: manifest.verification.status,
      provenance: `CHAIN ${REGISTRATION_CHAIN_ID}`,
    },
    ...keys.map((key) => ({
      label: key,
      value: allowed[key] ? "allowed" : "denied",
      provenance: `CHAIN ${config.chainId}`,
    })),
    {
      /**
       * Without this row every denial above is unfalsifiable: a bad resource
       * derivation returns false for everything and looks exactly like a
       * correctly locked-down agent.
       */
      label: "Positive control",
      value: `${short(organization)} on ${shortKey(agentEndpointKey("mcp"))} → ${
        control ? "allowed" : "DENIED — the read path is not working"
      }`,
      provenance: `CHAIN ${config.chainId}`,
    },
  ];

  return {
    kind: "lens",
    title: agent.ensName,
    pills: [
      {
        label: verified ? "verified" : manifest.verification.status,
        tone: verified ? "verified" : "unknown",
      },
      { label: `${allowedCount} allowed`, tone: allowedCount ? "active" : "unknown" },
      {
        label: `${keys.length - allowedCount} denied`,
        tone: keys.length - allowedCount ? "denied" : "active",
      },
    ],
    lanes,
    nodes,
    edges,
    caption: `${nodes.length} components across ${lanes.length} lanes, read from chain at ${manifest.assembledAt}.`,
    detail,
    readAt: manifest.assembledAt,
  };
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** `agent-registration[0x…][9209]` is unreadable on a node. */
function shortKey(key: string): string {
  return key.length > 28 ? `${key.slice(0, 20)}…]` : key;
}

function truncate(value: string, at = 34): string {
  return value.length > at ? `${value.slice(0, at)}…` : value;
}

export type { LensTone };
