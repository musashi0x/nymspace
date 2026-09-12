"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { ACTIVITY_STATUSES, type ActivitySourceFilter } from "@/lib/api";
import { chartHeight, DOT, type Status, type SummaryRow } from "./outcome-status";
import { Loading } from "./primitives";

/**
 * The activity log counted by source and outcome — one stacked bar per source.
 *
 * It answers the question the timeline cannot: what is the fleet doing, and
 * how much of it was stopped. Selecting a segment filters the timeline below
 * through the URL, so the server re-reads the log for that pair and the view
 * survives a reload. The chart itself always shows the whole log; under a
 * filter the selected segment keeps its colour and the rest are muted, so the
 * context that made a segment worth selecting is still on screen after it is.
 *
 * Recharts, because Astryx ships no chart and its own dashboard templates draw
 * theirs with it (`openspec/specs/console-design-system`).
 */

/**
 * The bars load after the page, not with it (design.md D5).
 *
 * `ssr: false` because recharts measures its container in the browser and has
 * nothing to render on the server anyway. The legend and the filter controls
 * below stay in this module, so filtering works before the bars arrive.
 */
const OutcomeBars = dynamic(() => import("./outcome-bars"), {
  ssr: false,
  loading: () => <Loading what="Drawing the outcome chart" />,
});

export function OutcomeChart({
  rows,
  source,
  status,
}: {
  rows: SummaryRow[];
  source?: ActivitySourceFilter;
  status?: Status;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const navigate = (next: { source?: ActivitySourceFilter; status?: Status }) => {
    const params = new URLSearchParams();
    if (next.source) params.set("source", next.source);
    if (next.status) params.set("status", next.status);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  /** Selecting the selected segment again is how a pointer clears the filter. */
  const select = (rowSource: ActivitySourceFilter, rowStatus: Status) =>
    navigate(
      rowSource === source && rowStatus === status
        ? {}
        : { source: rowSource, status: rowStatus },
    );

  /**
   * `pending` only when the log holds one, or the URL asks for it. A legend
   * entry and a filter option for a status nothing has ever had is a claim
   * about an empty set.
   */
  const statuses = ACTIVITY_STATUSES.filter(
    (s) => s !== "pending" || status === "pending" || rows.some((row) => row.pending > 0),
  );

  return (
    <VStack gap={4} width="100%" className="min-w-0">
      {/*
        The chart's height, reserved here from the row count before the bars
        load, so the timeline below does not move when they arrive.
      */}
      <VStack width="100%" height={chartHeight(rows.length)} className="min-w-0">
        <OutcomeBars
          rows={rows}
          statuses={statuses}
          source={source}
          status={status}
          onSelect={select}
        />
      </VStack>

      <HStack gap={4} justify="between" align="end" className="flex-wrap">
        <HStack gap={3} align="center" className="flex-wrap">
          {statuses.map((s) => (
            <HStack key={s} gap={1} align="center">
              <StatusDot variant={DOT[s]} label={s} />
              <Text type="supporting" size="sm">
                {s}
              </Text>
            </HStack>
          ))}
        </HStack>

        {/*
          The keyboard path. Every filter a segment can set is reachable here
          too, and writes the same URL.
        */}
        <HStack gap={3} align="end" className="flex-wrap">
          <Selector
            label="Source"
            isLabelHidden
            size="sm"
            placeholder="All sources"
            options={rows.map((row) => row.source)}
            value={source ?? null}
            hasClear
            onChange={(value: string | null) =>
              navigate({ source: (value ?? undefined) as ActivitySourceFilter | undefined, status })
            }
          />
          <SegmentedControl
            label="Status"
            size="sm"
            value={status ?? "all"}
            onChange={(value) =>
              navigate({ source, status: value === "all" ? undefined : (value as Status) })
            }
          >
            <SegmentedControlItem value="all" label="all" />
            {statuses.map((s) => (
              <SegmentedControlItem key={s} value={s} label={s} />
            ))}
          </SegmentedControl>
          {source || status ? (
            <Button label="Clear filter" variant="ghost" size="sm" onClick={() => navigate({})} />
          ) : null}
        </HStack>
      </HStack>
    </VStack>
  );
}
