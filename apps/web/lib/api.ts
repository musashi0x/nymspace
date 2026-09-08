import type { AppType } from "@nymspace/api/app";
import { hc } from "hono/client";

/**
 * The typed client for `@nymspace/api`.
 *
 * The type comes from the API's own `AppType`, so a renamed or removed route is
 * a compile error here rather than a 404 in the browser. That is the whole
 * point: the alternative is a hand-written fetch wrapper, which is exactly the
 * drift the split was supposed to avoid, written by hand.
 *
 * Imported from `@nymspace/api/app` rather than the package root — the root is
 * `index.ts`, which calls `serve()` at module scope. The import is type-only
 * and erased at compile time either way, but pointing at the application rather
 * than the process keeps it that way by construction.
 *
 * Note on what does *not* go through here: the landing page's commit activity.
 * That is server-rendered straight from `@nymspace/github`, the same package
 * the API serves `/v1/activity` from, so the page needs no network hop, no CORS
 * and no API process to render. This client is for calls the browser genuinely
 * has to make.
 */

/**
 * Falls back to the local API port so a developer who has not written a `.env`
 * still gets a working link rather than a request to `undefined/v1/...`.
 */
export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3112";

export const api = hc<AppType>(apiBaseUrl);

/** Liveness, for a status indicator or a deploy check. */
export async function fetchHealth() {
  const res = await api.health.$get();
  if (!res.ok) throw new Error(`API health check failed: ${res.status}`);
  return res.json();
}

/**
 * The ENSIP 25 and ENSIP 26 record keys for one agent name.
 *
 * The chain-reading routes arrive with the Day 1 spike; this is the derivation
 * the API can already answer, and it is what makes the type link load-bearing —
 * rename the route in `apps/api` and this file stops compiling.
 */
export async function fetchAgentKeys(
  name: string,
  registration?: { registry: string; agentId: string },
) {
  const res = await api.v1.agents[":name"].keys.$get({
    param: { name },
    // Both keys are always present because the route validates them as a pair;
    // omitting one and sending the other is the 400 this shape makes unspellable.
    query: {
      registry: registration?.registry,
      agentId: registration?.agentId,
    },
  });

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `Agent keys request failed: ${res.status}`);
  }
  return res.json();
}

/** The raw commit-activity payload, for anyone diffing the page against it. */
export async function fetchActivity() {
  const res = await api.v1.activity.$get();
  if (!res.ok) throw new Error(`Activity request failed: ${res.status}`);
  return res.json();
}
