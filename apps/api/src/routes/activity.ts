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

export const activity = new Hono<DepsEnv>().get(
  "/",
  zValidator("query", activityFilterSchema),
  async (c) => {
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
  },
);
