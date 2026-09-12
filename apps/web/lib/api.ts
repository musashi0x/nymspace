import type { AppType } from "@nymspace/api/app";
import { hc, type InferRequestType } from "hono/client";

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

/**
 * Writes go to this app; reads go straight to the API.
 *
 * Every route that spends the organization's money needs a bearer token now
 * (`apps/api/src/write-gate.ts`), and the browser must not hold one — a
 * credential in client JavaScript is a credential in view source. So a `POST`
 * is rewritten to `/api/gateway/<path>` on this origin, where a route handler
 * adds the token server-side and forwards it.
 *
 * `hc` keeps its `AppType`, so the call sites below are still typed against the
 * API's own routes and a renamed route is still a compile error. Only the
 * transport moved.
 *
 * Reads are left alone on purpose. They answer anyone by design — the product's
 * argument is that its claims are checkable — and sending them through this app
 * would add a hop that proves nothing and hides which origin actually served
 * the data.
 *
 * Server-side callers skip the rewrite: `window` is undefined there, the token
 * is already in the environment, and a server component calling its own route
 * handler over HTTP would be a request to itself for no reason.
 *
 * Exported because `hc` is not the only caller. The chat console runs a plan by
 * fetching the exact paths the plan names — it cannot use the typed client,
 * since the whole point of a plan is that the path came from the API at runtime
 * rather than from a route literal at compile time. That hand-built fetch went
 * straight to the API and started failing with 401 the moment writes were
 * gated, which is how this ended up exported rather than private: the rule
 * about where a write goes belongs in one place, and anything that sends one
 * has to be able to reach it.
 */
export function gatewayFetch(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const inBrowser = typeof window !== "undefined";

  if (method !== "POST" || !inBrowser) return fetch(input, init);

  const url = new URL(typeof input === "string" ? input : input.toString());
  const proxied = new URL(
    `/api/gateway${url.pathname}${url.search}`,
    window.location.origin,
  );
  return fetch(proxied, init);
}

export const api = hc<AppType>(apiBaseUrl, { fetch: gatewayFetch });

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

/**
 * Every agent's financial authority in one read.
 *
 * Not a loop over `fetchWallet`. That route throws when a policy cannot be
 * read, so looping it from here would force a choice between failing the whole
 * screen and swallowing each failure into `null` — and `null` is
 * indistinguishable from "this agent has no wallet". The aggregate answers with
 * a third state per agent instead; see `apps/api/src/routes/treasury.ts`.
 */
export async function fetchTreasury() {
  const res = await api.v1.treasury.$get();
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

/**
 * The activity route's filter, as the API's own schema declares it.
 *
 * Derived rather than restated. The hand-written union this replaced had
 * already drifted — it omitted `mcp`, which the API accepts — and a restated
 * union drifts silently, where a derived one fails typecheck.
 */
type ActivityQuery = InferRequestType<typeof api.v1.activity.$get>["query"];

export type ActivitySourceFilter = NonNullable<ActivityQuery["source"]>;
export type ActivityStatusFilter = NonNullable<ActivityQuery["status"]>;

/**
 * A list that must name every member of `T`.
 *
 * A missing member makes the argument require a `missing` property naming it,
 * so the next source the API accepts fails typecheck here instead of being
 * silently unreachable from the console's filter controls.
 */
const everyOf =
  <T extends string>() =>
  <const L extends readonly T[]>(
    list: L & ([Exclude<T, L[number]>] extends [never] ? unknown : { missing: Exclude<T, L[number]> }),
  ): L =>
    list;

/**
 * The values a URL may filter the timeline by. Here rather than beside the
 * chart: exports of a `"use client"` module reach a server component as client
 * references, not values, and the page validates `searchParams` against these.
 */
export const ACTIVITY_SOURCES = everyOf<ActivitySourceFilter>()([
  "ens",
  "erc8004",
  "graph",
  "privy",
  "app",
  "mcp",
]);

/** In stacking order: what went through, then what was stopped. */
export const ACTIVITY_STATUSES = everyOf<ActivityStatusFilter>()([
  "success",
  "denied",
  "failed",
  "pending",
]);

/** The activity timeline, filterable by agent, source, type and status. */
export async function fetchActivity(
  filter: Omit<ActivityQuery, "limit"> & { limit?: number } = {},
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

/**
 * The whole log counted by source and outcome — never a page of it. The
 * timeline's rows are capped, and counting them would undercount in silence.
 */
export async function fetchActivitySummary() {
  const res = await api.v1.activity.summary.$get();
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
