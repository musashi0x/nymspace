import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, database, isBotUserAgent } from "@nymspace/store";

/**
 * How many people have read the landing page.
 *
 * Two numbers, one aggregate over `page_views`: `views` is the row count and
 * `visitors` is the distinct visitor ids among them. Both exclude requests
 * classified as automated, and the count of those exclusions is returned too —
 * a bot filter whose effect cannot be seen is a claim rather than a
 * measurement.
 *
 * `since` is returned for the same reason. A bare total reads as all-time and
 * is not; it is "since the table was created", and the page says which.
 *
 * ## The visitor cookie
 *
 * A random id, first-party, `httpOnly`, one year. It is not an identity and the
 * page does not present it as one: clearing cookies makes a returning reader
 * new, and a client that sends no cookies is new on every request. So
 * `visitors` is a lower bound on nothing and an upper bound on people.
 *
 * `httpOnly` because nothing in the browser needs to read it — only this route
 * does — and a cookie script cannot touch is one a third-party script cannot
 * exfiltrate.
 *
 * ## Why this route builds its own Store
 *
 * Every other route takes its dependencies from `c.var.deps`, which is the
 * right default: a test injects fakes instead of arranging process state. This
 * one cannot, because `buildDeps` requires `ENSV2_ORGANIZATION_PRIVATE_KEY` and
 * `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY` to *construct* — before knowing whether
 * a request is a read or a write. Counting page views needs Postgres and
 * nothing else, so going through `buildDeps` would make a signing key a
 * prerequisite for a counter, and the route 500s without one.
 *
 * The general fix is to split those dependencies so reads need no keys. That
 * work exists and is not on this branch, so this route is scoped to what it
 * actually uses instead. `database()` is a pooled singleton, so this is one
 * connection pool, not one per request.
 *
 * ## Why POST records and GET does not
 *
 * `GET /v1/traffic` is safe: it reads and never writes. Recording on a GET
 * would make every prefetch, every crawler that ignores `robots.txt`, and
 * every retry a view. The browser records deliberately with a POST, which is
 * also what makes the write intentional enough to be worth a row.
 */

const recordSchema = z.object({
  /**
   * Bounded and required to start with `/`. It is user input that ends up in a
   * database column and, later, in an operator's terminal.
   */
  path: z
    .string()
    .min(1)
    .max(300)
    .refine((value) => value.startsWith("/"), {
      message: "path must start with /",
    }),
});

const VISITOR_COOKIE = "nymspace_visitor";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

let cached: Store | undefined;
const store = () => (cached ??= new Store(database()));

export const traffic = new Hono()
  .get("/", async (c) => {
    return c.json(await store().pageViewStats());
  })
  .post("/", zValidator("json", recordSchema), async (c) => {
    const { path } = c.req.valid("json");

    const visitorId = getCookie(c, VISITOR_COOKIE) ?? randomUUID();

    const stats = await store().recordPageView({
      visitorId,
      path,
      isBot: isBotUserAgent(c.req.header("user-agent")),
    });

    // Re-set on every request so the year rolls forward for a returning
    // reader rather than expiring on a fixed date a year after their first
    // visit.
    setCookie(c, VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    });

    return c.json(stats);
  });
