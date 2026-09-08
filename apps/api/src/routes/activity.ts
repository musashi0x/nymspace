import { Hono } from "hono";
import { getActivity, REVALIDATE_SECONDS } from "@nymspace/github";

/**
 * The same payload the landing page renders, exposed as raw JSON so anyone can
 * diff what the page claims against what GitHub actually returns.
 *
 * The logic is unchanged from the Next route handler this moved from — the
 * payload contract is the thing being preserved. One capability did not survive
 * the move and is replaced here: Next's `fetch(..., { next: { revalidate } })`
 * cached the upstream GitHub response for a minute. A plain Node process has no
 * such cache, and GitHub allows sixty anonymous requests an hour, so without a
 * replacement a handful of page loads would turn the payload into a rate-limit
 * error. The memo below is that replacement, deliberately in-process and
 * deliberately dumb: one entry, cleared by time, no invalidation to get wrong.
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

export const activity = new Hono().get("/", async (c) => {
  const data = await getActivityCached();

  c.header(
    "Cache-Control",
    `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=60`,
  );
  return c.json(data);
});
