import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  AGENT_CONTEXT_KEY,
  agentEndpointKey,
  agentRegistrationKey,
  assembleManifest,
} from "@nymspace/ens";
import { CONSOLE_SUGGESTIONS } from "@nymspace/core";
import type {
  ConsoleAnswer,
  LensDetail,
  LensEdge,
  LensNode,
  LensPlan,
  LensTone,
  PlanStep,
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
 * Intents:
 *
 *   fleet            every agent against every track
 *   agent <name>     one agent's identity, authority and records
 *   audit <name>     that agent's lifecycle, from the activity log
 *   create / grant / write / pay    answered with a plan, never performed
 *   mcp <name>       connect to its MCP endpoint — also a plan, unsigned
 *
 * Nothing in this file writes. The action intents return a {@link LensPlan}
 * naming the product routes that would do the work, and the operator's
 * confirmation is what sends them — so the chat can propose an irreversible
 * change without ever being the thing that made it.
 */

const askSchema = z.object({
  message: z.string().min(1).max(400),
});

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

  /**
   * Writes are matched first, and answered with a plan rather than performed.
   *
   * Before the read intents, because "show research" and "let research write
   * its context" both name an agent and the second must not be answered with a
   * diagram. Nothing in this function writes: every write branch returns a
   * {@link LensPlan}, which is an offer the operator has to accept, and the
   * requests it names are the product routes any other screen would call.
   */
  const plan = await matchPlan(text, message, deps);
  if (plan) return plan;

  if (/\b(audit|trail|history|timeline|what happened)\b/.test(text)) {
    const id = await matchAgent(text, deps);
    if (id) return auditLens(id, deps);
  }

  if (/\b(fleet|agents|everything|all)\b/.test(text) && !nameIn(text, deps)) {
    return fleetLens(deps);
  }

  /**
   * A question about an agent's MCP server, before the agent lens.
   *
   * After the plans, so "as research, set its mcp endpoint to …" stays a
   * record write; before the lens, so "what does research's mcp serve" is not
   * answered with a diagram of permissions. Both name the agent and say "mcp",
   * and only word order separates them — which is why `chat.test.ts` pins
   * all three.
   */
  if (
    /\bmcp\b/.test(text) &&
    /\b(serves?|offers?|tools?|connect|reachable|answers?|up|live|working)\b/.test(text)
  ) {
    const id = await matchAgent(text, deps);
    const plan = id ? await connectPlan(id, deps) : undefined;
    if (plan) return plan;
  }

  const slug = await matchAgent(text, deps);
  if (slug) return agentLens(slug, deps);

  return {
    kind: "unanswered",
    message:
      "I did not recognise an agent or a topic in that. I answer from live ENS, ERC 8004 and permission reads, so I can only answer about things I can go and check.",
    suggestions: [...CONSOLE_SUGGESTIONS],
  };
}

/** Cheap pre-check so "show me the agents" does not beat "show research". */
function nameIn(text: string, _deps: Deps): boolean {
  return /\b[a-z0-9-]+\.[a-z0-9-]+\.eth\b/.test(text);
}

//////////////////////////////////////////////////////////////////////////////
// Audit — the lifecycle, read back from what was written at the time
//////////////////////////////////////////////////////////////////////////////

/**
 * One agent's history, oldest first.
 *
 * Chronological, against the timeline screen's newest-first, because this
 * answers "what happened to this agent" rather than "what just happened". A
 * lifecycle read backwards is a list of events; read forwards it is a story
 * with an offboarding at the end.
 *
 * Denials are rows like any other. A trail that showed only successes would be
 * the one artifact in this product capable of proving nothing was ever refused
 * — see `store.listActivity`, which refuses to filter them for the same reason.
 */
async function auditLens(id: string, deps: Deps): Promise<ConsoleAnswer> {
  const agent = await deps.store.getAgent(id);
  if (!agent) return unrecognised();

  const events = await deps.store.listActivity({
    organizationId: ORGANIZATION_ID,
    agentId: id,
  });
  const ordered = [...events].reverse();

  const lanes = ["WHEN", "WHAT", "EVIDENCE"];
  const nodes: LensNode[] = [];
  const edges: LensEdge[] = [];

  for (const [i, event] of ordered.entries()) {
    const tone: LensTone =
      event.status === "success"
        ? "verified"
        : event.status === "denied"
          ? "denied"
          : event.status === "failed"
            ? "absent"
            : "unknown";

    nodes.push({
      id: `when:${i}`,
      lane: "WHEN",
      label: event.occurredAt.slice(11, 19) + "Z",
      sublabel: event.occurredAt.slice(0, 10),
      tone: "active",
    });
    nodes.push({
      id: `what:${i}`,
      lane: "WHAT",
      label: event.type,
      sublabel: event.summary,
      badge: event.status,
      tone,
    });
    nodes.push({
      id: `ev:${i}`,
      lane: "EVIDENCE",
      // A zero hash is what provisioning writes when a step never reached a
      // chain. Shown as absent rather than as a transaction, because a row of
      // sixty-four noughts in a hash column is a link somebody will click.
      label: event.txHash && !/^0x0+$/.test(event.txHash) ? short(event.txHash) : "no transaction",
      sublabel: event.actor ? `actor ${short(event.actor)}` : event.source,
      tone: event.txHash && !/^0x0+$/.test(event.txHash) ? "verified" : "absent",
    });

    edges.push({ from: `when:${i}`, to: `what:${i}`, tone: "active" });
    edges.push({ from: `what:${i}`, to: `ev:${i}`, label: event.status, tone });
  }

  const denied = ordered.filter((e) => e.status === "denied").length;

  return {
    kind: "lens",
    title: `${agent.ensName} — audit trail`,
    pills: [
      { label: `${ordered.length} events`, tone: "active" },
      ...(denied > 0
        ? [{ label: `${denied} denied`, tone: "denied" as LensTone }]
        : []),
    ],
    lanes,
    nodes,
    edges,
    caption:
      ordered.length === 0
        ? "Nothing has been recorded for this agent yet."
        : `${ordered.length} events from creation onward, oldest first. Denials are kept.`,
    detail: ordered.map((event) => ({
      label: event.occurredAt,
      value: `${event.type} ${event.status} — ${event.summary}`,
      provenance: "STORE",
    })),
    readAt: readAt(),
  };
}

function unrecognised(): ConsoleAnswer {
  return {
    kind: "unanswered",
    message:
      "I did not recognise an agent or a topic in that. I answer from live ENS, ERC 8004 and permission reads, so I can only answer about things I can go and check.",
    suggestions: [...CONSOLE_SUGGESTIONS],
  };
}

//////////////////////////////////////////////////////////////////////////////
// Plans — understood, described, and not performed
//////////////////////////////////////////////////////////////////////////////

/**
 * The five write intents, in the order the demo walks them.
 *
 * Each returns a plan naming real endpoints with real bodies; none of them
 * calls one. The matchers stay narrow and literal for the reason
 * {@link matchAgent} gives: a near-miss here would not return the wrong
 * diagram, it would offer to sign the wrong transaction.
 *
 * Two of them expect to be refused. `expectDenial` carries that forward so the
 * console can say "this is the boundary holding" rather than working it out
 * from a failure it was not expecting — the distinction `docs/11` spends its
 * length on, and the one an approving operator most needs to see in advance.
 */
async function matchPlan(
  text: string,
  original: string,
  deps: Deps,
): Promise<LensPlan | undefined> {
  // 1. Onboard.
  const created = /\b(create|onboard|add|register)\b.*\bagent\b/.test(text)
    ? /\b(?:create|onboard|add|register)\s+(?:a|an|the)?\s*([a-z0-9][a-z0-9-]{1,30})\s+agent\b/.exec(text)?.[1]
    : undefined;
  if (created) return onboardPlan(created, deps);

  // 2. Grant a record key to the controller.
  if (/\b(let|allow|grant|give)\b/.test(text) && /\b(update|write|edit|change|set)\b/.test(text)) {
    const id = await matchAgent(text, deps);
    const key = matchRecordKey(text);
    if (id && key) return grantPlan(id, key, deps);
  }

  // 3 and 4. A controller-signed record write — permitted or refused.
  if (/\bas\b/.test(text) && /\b(set|update|change|write)\b/.test(text)) {
    const id = await matchAgent(text, deps);
    const key = matchRecordKey(text);
    if (id && key) return recordPlan(id, key, original, deps);
  }

  // 5. Pay.
  if (/\b(pay|send|transfer)\b/.test(text)) {
    const id = await matchAgent(text, deps);
    const amount = matchEth(text);
    if (id && amount) return paymentPlan(id, amount, text, deps);
  }

  return undefined;
}

/**
 * Which record key a sentence is about.
 *
 * Only the three this product defines, matched on the words an operator would
 * actually type. An unrecognised key returns nothing rather than a guess: the
 * key is the whole subject of a permission, and inventing one would produce a
 * plan to grant authority over a record that does not exist.
 */
function matchRecordKey(text: string): string | undefined {
  if (/\b(mcp|endpoint)\b/.test(text) && !/\ba2a\b/.test(text)) {
    return agentEndpointKey("mcp");
  }
  if (/\ba2a\b/.test(text)) return agentEndpointKey("a2a");
  if (/\b(context|agent-context)\b/.test(text)) return AGENT_CONTEXT_KEY;
  return undefined;
}

/** Wei from a sentence naming ETH. Decimal string, because 2^53 is not enough. */
function matchEth(text: string): string | undefined {
  const hit = /\b(\d+(?:\.\d+)?)\s*(?:eth|ether)\b/.exec(text);
  if (!hit?.[1]) return undefined;
  const [whole, fraction = ""] = hit[1].split(".");
  return `${whole}${fraction.padEnd(18, "0").slice(0, 18)}`.replace(/^0+(?=\d)/, "");
}

function onboardPlan(label: string, deps: Deps): LensPlan {
  const ensName = `${label}.${deps.parentName}`;
  return {
    kind: "plan",
    title: `Onboard ${ensName}`,
    summary:
      `Registers the subname, points it at the Permissioned Resolver and records the controller. ` +
      `Four Sepolia transactions, signed by the organization. The name is permanent; the grants that follow are not.`,
    steps: [
      {
        title: `Register ${ensName} and set its resolver`,
        method: "POST",
        path: "/v1/agents",
        body: { label, controller: deps.controller },
        actor: "organization",
      },
    ],
    closing:
      "The agent exists and owns nothing else yet. It can write no records until a key is granted.",
  };
}

function grantPlan(id: string, key: string, deps: Deps): LensPlan {
  return {
    kind: "plan",
    title: `Grant ${key}`,
    summary:
      `Authorizes the controller ${short(deps.controller)} to write ${key} on this name. ` +
      `Only the organization can grant it, and only the organization can take it back.`,
    steps: [
      {
        title: `Authorize SET_TEXT on ${key}`,
        method: "POST",
        path: `/v1/agents/${id}/permissions`,
        body: { controller: deps.controller, recordKey: key, grant: true },
        actor: "organization",
      },
    ],
    closing: "Re-read the agent and that cell says allowed, from chain.",
  };
}

/**
 * A controller-signed record write, and whether it is expected to survive.
 *
 * The expectation comes from a live `canSetText` rather than from the key's
 * name, so the plan cannot promise a denial the resolver would not actually
 * produce. That matters more than it sounds: a plan that said "this will be
 * refused" and then succeeded would be the console teaching an operator to
 * distrust its warnings.
 */
async function recordPlan(
  id: string,
  key: string,
  original: string,
  deps: Deps,
): Promise<LensPlan | undefined> {
  const agent = await deps.store.getAgent(id);
  if (!agent) return undefined;

  const allowed = await deps.ens.canSetText(agent.ensName, key, agent.controllerAddress);
  const value = matchValue(original) ?? `https://example.com/${key}`;

  return {
    kind: "plan",
    title: allowed ? `Write ${key}` : `Attempt ${key}`,
    summary: allowed
      ? `The controller writes its own record. It holds SET_TEXT on this key, so the resolver will accept it.`
      : `The controller does not hold SET_TEXT on this key. The resolver will refuse, and that refusal is the result.`,
    steps: [
      {
        title: allowed ? `Set ${key}` : `Try to set ${key}`,
        method: "POST",
        path: `/v1/agents/${id}/records`,
        body: { key, value },
        actor: "controller",
        ...(allowed
          ? {}
          : {
              expectDenial:
                "EACUnauthorizedAccountRoles — the Permissioned Resolver refuses a controller that was never granted this key.",
            }),
      },
    ],
    closing: allowed
      ? "The record is on chain. The old value and the transaction hash are both in the result."
      : "Nothing changed, and the refusal came from the contract rather than from this console.",
  };
}

/** The quoted or trailing value in "set X to Y". */
function matchValue(original: string): string | undefined {
  const quoted = /["“](.+?)["”]/.exec(original);
  if (quoted?.[1]) return quoted[1];
  const trailing = /\bto\s+(.+?)\s*$/i.exec(original);
  return trailing?.[1];
}

/**
 * Preview, then pay — two steps on purpose.
 *
 * The preview is the only place the spend limit is visible before the money
 * moves, and `docs/08` is explicit that a payment screen must show the policy
 * it is about to be judged by. Collapsing them into one call would make the
 * limit something the operator learns from the refusal.
 */
async function paymentPlan(
  id: string,
  amountWei: string,
  text: string,
  deps: Deps,
): Promise<LensPlan | undefined> {
  const agent = await deps.store.getAgent(id);
  if (!agent) return undefined;

  const recipient = /0x[0-9a-fA-F]{40}/.exec(text)?.[0] ?? agent.controllerAddress;

  return {
    kind: "plan",
    title: "Pay from the agent wallet",
    summary:
      `Checks the amount against the wallet's Privy policy, then sends it. Native ETH on Base Sepolia — ` +
      `this adapter does not transfer tokens, whatever a policy's tokenAddress says.`,
    steps: [
      {
        title: "Preview against the spend limit",
        method: "POST",
        path: `/v1/agents/${id}/payments/preview`,
        body: { amount: amountWei, recipient },
        actor: "agent wallet",
      },
      {
        title: "Send the payment",
        method: "POST",
        path: `/v1/agents/${id}/payments`,
        body: { amount: amountWei, recipient },
        actor: "agent wallet",
        expectDenial:
          "Over the per-transaction limit, Privy refuses on the signing path and no transaction is broadcast. Under it, this succeeds.",
      },
    ],
    closing:
      "The preview and the outcome are separate evidence: one is the policy, the other is what the signer did with it.",
  };
}

/**
 * Connect, offered rather than performed (design D11).
 *
 * A connect is a read, but it reads somebody else's server and writes an
 * activity row, and this file performs neither. So it is a plan of one step
 * that no key signs, sent only when the operator runs it — to the same route
 * the inspector's Connect button calls, through the same guard.
 */
async function connectPlan(id: string, deps: Deps): Promise<LensPlan | undefined> {
  const agent = await deps.store.getAgent(id);
  if (!agent) return undefined;

  return {
    kind: "plan",
    title: `Connect to ${agent.ensName}'s MCP endpoint`,
    summary:
      "Reads the endpoint from ENS, then performs an MCP handshake and lists its tools through the outbound guard. " +
      "No tool on the server is called, and nothing is signed.",
    steps: [
      {
        title: "Handshake and list tools",
        method: "POST",
        path: "/v1/mcp/connect",
        body: { target: { kind: "fleet", agentId: id } },
        actor: "none",
      },
    ],
    closing:
      "The outcome is a claim about the endpoint at the moment it was read: connected, with what it serves, or where and why it failed.",
  };
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

    /**
     * The ENS node carries the link, because it is the one that is the agent.
     *
     * The other two in this row are facts about it — a registration number, a
     * verification verdict — and linking those would offer three doors to one
     * room. The caption tells the reader to open an agent to read its state
     * from chain; this is what it means.
     */
    nodes.push({
      id: `${agent.id}:ens`,
      lane: "ENS",
      label: agent.ensName,
      sublabel: status.ens,
      badge: status.ens === "active" ? "active" : status.ens,
      tone: status.ens === "active" ? "active" : "unknown",
      href: `/console/agents/${agent.id}`,
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
      suggestions: [...CONSOLE_SUGGESTIONS],
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
    // Linked here too. This answer is already about one agent, but it is where
    // a reader decides to act — and the page is where writing lives.
    href: `/console/agents/${agent.id}`,
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
