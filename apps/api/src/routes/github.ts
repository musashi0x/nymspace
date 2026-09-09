import { Hono } from "hono";
import { getActivity, REVALIDATE_SECONDS } from "@nymspace/github";

/**
 * The landing page's commit activity, as raw JSON so anyone can diff what the
 * page claims against what GitHub actually returns.
 *
 * Moved off `/v1/activity` to make room for the agent timeline that
 * `docs/10_API_CONTRACT.md` specifies at that path. This is scaffolding from
 * the first change and unrelated to the fleet; the product contract wins the
 * shorter name.
 *
 * The memo replaces a capability lost when this moved out of Next: `fetch(...,
 * { next: { revalidate } })` cached the upstream response for a minute, a plain
 * Node process has no such cache, and GitHub allows sixty anonymous requests an
 * hour — so without it a handful of page loads turns the payload into a
 * rate-limit error. Deliberately in-process and deliberately dumb: one entry,
 * cleared by time, no invalidation to get wrong.
 */

type Activity = Awaited<ReturnType<typeof getActivity>>;

let cached: { at: number; data: Activity } | undefined;
let inflight: Promise<Activity> | undefined;

async function getActivityCached(): Promise<Activity> {
  const now = Date.now();
  if (cached && now - cached.at < REVALIDATE_SECONDS * 1000) return cached.data;

  // Collapse concurrent misses into one upstream call rather than a thundering herd.
  inflight ??= getActivity()
    .then((data) => {
      cached = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = undefined;
    });

  return inflight;
}

export const github = new Hono().get("/activity", async (c) => {
  const data = await getActivityCached();

  c.header(
    "Cache-Control",
    `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=60`,
  );
  return c.json(data);
});
