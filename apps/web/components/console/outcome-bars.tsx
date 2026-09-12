"use client";

import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { ActivitySourceFilter } from "@/lib/api";
import { DOT, MARGIN, chartHeight, type Status, type SummaryRow } from "./outcome-status";

/**
 * The recharts half of the outcome chart, and the only module that imports
 * recharts.
 *
 * Loaded lazily by `outcome-chart.tsx`. Imported statically, recharts brought
 * redux toolkit, immer and d3 into the activity page's first load: +127 KB
 * gzipped, +52%, measured from `next build` (tasks.md 6.2). The page shell, the
 * timeline and the filter controls do not need any of it to be usable.
 */

/**
 * The timeline's badge colours, as token references.
 *
 * `var()` resolves inside SVG `fill`, so a theme switch recolours the chart
 * with no JavaScript. Status carries meaning the timeline has already given
 * colours to, which is why this is not the categorical data palette: a denied
 * segment and a denied badge have to be the same colour.
 */
const FILL: Record<Status, { full: string; muted: string }> = {
  success: { full: "var(--color-success)", muted: "var(--color-success-muted)" },
  denied: { full: "var(--color-warning)", muted: "var(--color-warning-muted)" },
  failed: { full: "var(--color-error)", muted: "var(--color-error-muted)" },
  pending: { full: "var(--color-text-secondary)", muted: "var(--color-neutral)" },
};

const BAR_SIZE = 20;
const AXIS_WIDTH = 112;
const AXIS_TICK = { fill: "var(--color-text-secondary)" };
const CURSOR = { fill: "var(--color-background-muted)" };

export default function OutcomeBars({
  rows,
  statuses,
  source,
  status,
  onSelect,
}: {
  rows: SummaryRow[];
  statuses: Status[];
  source?: ActivitySourceFilter;
  status?: Status;
  onSelect: (source: ActivitySourceFilter, status: Status) => void;
}) {
  const emphasised = (rowSource: string, rowStatus: Status) =>
    (!source || source === rowSource) && (!status || status === rowStatus);

  // Keyed by string: the axis formatter hands back whatever the tick carries.
  const totals = new Map<string, number>(rows.map((row) => [row.source, row.total]));
  const described = rows
    .map((row) => `${row.source}: ${statuses.map((s) => `${row[s]} ${s}`).join(", ")}`)
    .join("; ");

  /*
    `isAnimationActive` is left at recharts' default, "auto", which already
    disables animation for prefers-reduced-motion.

    Arrow keys move the tooltip between sources (recharts' accessibility layer)
    but never activate a segment — hence the controls beside the chart.
  */
  return (
    <BarChart
      data={rows}
      layout="vertical"
      responsive
      width="100%"
      height={chartHeight(rows.length)}
      margin={MARGIN}
      barSize={BAR_SIZE}
      title="Events by source and outcome"
      desc={`Events by source and outcome, over the whole log. ${described}.`}
    >
      <XAxis type="number" hide allowDecimals={false} />
      <YAxis
        type="category"
        dataKey="source"
        width={AXIS_WIDTH}
        axisLine={false}
        tickLine={false}
        tick={AXIS_TICK}
        // Every bar states its total as text, so a three-event source stays
        // readable beside a fifty-nine-event one.
        tickFormatter={(value: string) => `${value} · ${totals.get(value) ?? 0}`}
      />
      <Tooltip cursor={CURSOR} content={<OutcomeTooltip statuses={statuses} />} />
      {statuses.map((s) => (
        <Bar
          key={s}
          dataKey={s}
          name={s}
          stackId="outcome"
          cursor="pointer"
          onClick={(bar) => onSelect((bar.payload as SummaryRow).source, s)}
        >
          {rows.map((row) => (
            <Cell
              key={row.source}
              fill={emphasised(row.source, s) ? FILL[s].full : FILL[s].muted}
            />
          ))}
        </Bar>
      ))}
    </BarChart>
  );
}

/** One source's breakdown, in the design system's surface and status dots. */
function OutcomeTooltip({
  active,
  payload,
  statuses,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: SummaryRow }>;
  statuses: Status[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <Card padding={3} elevation="low">
      <VStack gap={1}>
        <Text type="code" size="sm" hasTabularNumbers>
          {row.source} · {row.total}
        </Text>
        {statuses.map((s) => (
          <HStack key={s} gap={2} align="center">
            <StatusDot variant={DOT[s]} label={s} />
            <Text type="supporting" size="sm" hasTabularNumbers>
              {row[s]} {s}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Card>
  );
}
