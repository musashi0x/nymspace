import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ActivityType } from "@nymspace/store";
import { ORGANIZATION_ID, type DepsEnv } from "../deps";
import { activityFilterSchema, readAt } from "./shared";

/**
 * The activity timeline — `docs/10_API_CONTRACT.md`'s `/api/activity`.
 *
 * One stream across every source, filtered by agent, source, type and status.
 * Four filter dimensions over an append-only log is the reason the store is
 * Postgres rather than a file (design.md D12).
 *
 * Denied and failed events are returned like any other. A timeline that quietly
 * drops them is a timeline that only ever shows success, and in this product a
 * denial is the evidence rather than the exception.
 */

export const activity = new Hono<DepsEnv>()
  .get("/", zValidator("query", activityFilterSchema), async (c) => {
    const { store } = c.var.deps;
    const filter = c.req.valid("query");

    const events = await store.listActivity({
      organizationId: ORGANIZATION_ID,
      ...(filter.agent && { agentId: filter.agent }),
      ...(filter.source && { source: filter.source }),
      ...(filter.type && { type: filter.type as ActivityType }),
      ...(filter.status && { status: filter.status }),
      limit: filter.limit,
    });

    return c.json({
      events,
      // Sorted by when the thing happened rather than when it was written, so a
      // slow confirmation does not reorder the story.
      order: "occurredAt desc" as const,
      filter,
      readAt: readAt(),
    });
  })
  /**
   * The log counted by source and outcome, over every event.
   *
   * Takes no filter on purpose. The console's outcome chart always shows the
   * whole log and highlights the selected segment; a summary that followed the
   * timeline's filter would collapse to one bar at the moment it is used.
   *
   * Chained rather than added with a statement, so it stays in `AppType` and
   * the web client sees it (see `CLAUDE.md`, "web ↔ api").
   */
  .get("/summary", async (c) => {
    const summary = await c.var.deps.store.summarizeActivity({
      organizationId: ORGANIZATION_ID,
    });
    return c.json({ ...summary, readAt: readAt() });
  });
