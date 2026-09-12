import type { ActivityStatusFilter, fetchActivitySummary } from "@/lib/api";

/**
 * What the outcome chart's two halves share — the filter controls that load
 * with the page, and the recharts bars that load after it.
 *
 * Its own module, and free of recharts, so the controls can import it without
 * pulling the chart library back into the page's first load. That split is the
 * whole point of `outcome-bars.tsx` being lazily imported.
 */

export type SummaryRow = Awaited<ReturnType<typeof fetchActivitySummary>>["bySource"][number];
export type Status = ActivityStatusFilter;

/** The same mapping `Badge` uses in `primitives.tsx`: good, warn, bad, neutral. */
export const DOT: Record<Status, "success" | "warning" | "error" | "neutral"> = {
  success: "success",
  denied: "warning",
  failed: "error",
  pending: "neutral",
};

/**
 * Chart geometry. Recharts takes these as numbers; they size SVG shapes and
 * are not CSS. The height is shared because the page reserves it before the
 * bars arrive, and a reservation that disagreed with the chart would move the
 * timeline when they did.
 */
export const ROW_HEIGHT = 40;
export const MARGIN = { top: 4, right: 16, bottom: 4, left: 0 };
export const chartHeight = (rowCount: number) =>
  rowCount * ROW_HEIGHT + MARGIN.top + MARGIN.bottom;
