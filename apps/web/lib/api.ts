import type { AppType } from "@nymspace/api/app";
import { hc } from "hono/client";

/**
 * The typed client for `@nymspace/api`.
 *
 * The type comes from the API's own `AppType`, so a renamed or removed route is
 * a compile error here rather than a 404 in the browser. That is not
 * theoretical: moving the commit-activity route to `/v1/github/activity` to make
 * room for the agent timeline broke this file immediately, which is exactly the
 * drift a hand-written fetch wrapper would have shipped silently.
 *
 * Imported from `@nymspace/api/app` rather than the package root — the root is
 * `index.ts`, which calls `serve()` at module scope. The import is type-only and
 * erased at compile time either way, but pointing at the application rather than
 * the process keeps it that way by construction.
 *
 * Note on what does *not* go through here: the landing page's commit activity is
 * server-rendered straight from `@nymspace/github`, the same package the API
 * serves it from, so the page needs no network hop, no CORS and no API process.
 * This client is for calls the browser genuinely has to make.
 */

/**
 * Falls back to the local API port so a developer who has not written a `.env`
 * still gets a working link rather than a request to `undefined/v1/...`.
 */
export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3112";

export const api = hc<AppType>(apiBaseUrl);

/**
 * Every call checks `res.ok` inline rather than through a shared unwrap helper.
 *
 * That is not repetition for its own sake. Hono types a client response as a
 * union across status codes — the success body, and zod's error shape for a
 * 400 — and TypeScript narrows that union only where the check is written. A
 * helper taking the union collapses it to `unknown` before the caller ever sees
 * the success type, which throws away the reason for having a typed client at
 * all.
 *
 * Denials are not errors. The record and payment routes answer 200 with a typed
 * `denied` body, so those functions return it rather than throwing — treating a
 * refused write as an exception is the one thing `docs/11` says not to do.
 */
function requestFailed(status: number): Error {
  return new Error(`request failed: ${status}`);
}

/** Liveness, for a status indicator or a deploy check. */
export async function fetchHealth() {
  const res = await api.health.$get();
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/**
 * The addresses this deployment signs with.
 *
 * The create-agent screen reads `controller` from here rather than asking for
 * it. Only this address works, so a field that accepts any other is a field
 * that accepts a mistake.
 */
export async function fetchSigners() {
  const res = await api.v1.signers.$get();
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** The fleet, with each agent's five integration states separately. */
export async function fetchAgents() {
  const res = await api.v1.agents.$get();
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** Live ENS state for one agent: records, registration, verification. */
export async function fetchIdentity(id: string) {
  const res = await api.v1.agents[":id"].identity.$get({ param: { id } });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/**
 * The permission matrix, computed from chain.
 *
 * The response carries `control` and `queries` alongside the cells, so the
 * console can show the positive control that ran in the same request and the
 * resources behind each answer. A matrix without them is a table someone typed.
 */
export async function fetchPermissions(id: string, controller?: string) {
  const res = await api.v1.agents[":id"].permissions.$get({
    param: { id },
    query: { controller },
  });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

export async function grantPermission(
  id: string,
  body: { controller: string; recordKey: string; grant: boolean },
) {
  const res = await api.v1.agents[":id"].permissions.$post({
    param: { id },
    json: body,
  });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/**
 * A controller-signed record write.
 *
 * Returns the outcome rather than throwing on a denial: a refused write is the
 * permission proof, and the screen needs the reason and the old value to show
 * it.
 */
export async function writeRecord(
  id: string,
  body: { key: string; value: string },
) {
  const res = await api.v1.agents[":id"].records.$post({
    param: { id },
    json: body,
  });
  if (!res.ok) throw new Error(`record write failed: ${res.status}`);
  return res.json();
}

/** What connect accepts: an agent, never a URL — see `routes/mcp.ts`. */
export type ConnectTarget =
  | { kind: "fleet"; agentId: string }
  | { kind: "graph"; graphAgentKey: string };

/**
 * A read-only MCP handshake against the agent's published endpoint. Every
 * outcome, failures included, is a 200; a thrown error here is this API
 * failing, never the endpoint.
 */
export async function connectMcp(target: ConnectTarget) {
  const res = await api.v1.mcp.connect.$post({ json: { target } });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

export async function verifyIdentity(id: string) {
  const res = await api.v1.agents[":id"].verify.$post({ param: { id } });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

export async function fetchWallet(id: string) {
  const res = await api.v1.agents[":id"].wallet.$get({ param: { id } });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** Informational only. Privy still decides. */
export async function previewPayment(
  id: string,
  body: { amount: string; recipient: string; token?: string; memo?: string },
) {
  const res = await api.v1.agents[":id"].payments.preview.$post({
    param: { id },
    json: body,
  });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** Four typed outcomes, all of them HTTP 200. Never throws on a denial. */
export async function sendPayment(
  id: string,
  body: { amount: string; recipient: string; token?: string; memo?: string },
) {
  const res = await api.v1.agents[":id"].payments.$post({
    param: { id },
    json: body,
  });
  if (!res.ok) throw new Error(`payment request failed: ${res.status}`);
  return res.json();
}

/**
 * Execute a denied payment under the organization owner's key.
 *
 * Takes the id of the denial, not the payment fields: the amount that executes
 * is the one that was refused, read from the recorded request server-side. An
 * approval that carried its own amount would approve whatever the browser sent.
 */
export async function approvePayment(id: string, requestId: string) {
  const res = await api.v1.agents[":id"].payments[":requestId"].approve.$post({
    param: { id, requestId },
  });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** Discovery over live Agent0 data, ranked and explained. */
export async function discover(body: {
  query: string;
  requireMcp?: boolean;
  trustModels?: string[];
  limit?: number;
  refresh?: boolean;
}) {
  const res = await api.v1.discover.$post({ json: body });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** The activity timeline, filterable by agent, source, type and status. */
export async function fetchActivity(
  filter: {
    agent?: string;
    source?: "ens" | "erc8004" | "graph" | "privy" | "app";
    type?: string;
    status?: "pending" | "success" | "denied" | "failed";
    limit?: number;
  } = {},
) {
  const res = await api.v1.activity.$get({
    query: {
      ...filter,
      // The schema coerces, so the wire form is a string either way; sending it
      // as one keeps the query type honest about what a URL can carry.
      limit: filter.limit === undefined ? undefined : String(filter.limit),
    },
  });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** The raw commit-activity payload, for anyone diffing the page against it. */
export async function fetchCommitActivity() {
  const res = await api.v1.github.activity.$get();
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/**
 * Create an agent. Answers 202 — provisioning outlives the request.
 *
 * A label someone else owns comes back as a described outcome rather than a
 * thrown error, for the reason the record and payment calls do the same: the
 * name being taken is an answer about the world, not a fault in the request.
 * The caller renders it; nothing here decides it is exceptional.
 */
export async function createAgent(body: {
  label: string;
  name: string;
  description: string;
  role: string;
  controller: string;
  endpoints: { mcp?: string; a2a?: string };
  delegate?: boolean;
}) {
  const res = await api.v1.agents.$post({ json: body });
  if (res.status === 409) return res.json();
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}

/** The five tracks and the steps behind them, rebuilt from the activity log. */
export async function fetchProvisioning(id: string) {
  const res = await api.v1.agents[":id"].provisioning.$get({ param: { id } });
  if (!res.ok) throw requestFailed(res.status);
  return res.json();
}
