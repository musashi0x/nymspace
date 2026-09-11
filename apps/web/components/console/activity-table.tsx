"use client";

import {
  Table,
  proportional,
  useTableRowExpansion,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { useState } from "react";
import { Badge, Evidence, Field } from "./primitives";
import { RowWindowFooter, ScrollRegion, useRowWindow } from "./row-window";

/**
 * The activity timeline as rows.
 *
 * It used to be one framed card per event, which is the shape `AGENTS.md`
 * names first among the things not to do: dense data is rows, and `Card` is for
 * standalone widgets. A hundred framed events is a hundred widgets.
 *
 * The evidence does not fit a column — it is a different shape per source, and
 * that is the point of carrying it — so it lives in an expanded row rather than
 * being truncated into a cell or dropped. Expansion needs client state, which
 * is one of the two reasons this is a client component; the other is the row
 * window. The fetch stays on the server.
 */

/**
 * `2026-09-11 20:06:28`, not the locale's `9/11/2026, 8:06:28 PM`. Every
 * timestamp is the same width, so the column has a width that fits all of
 * them — the locale form loses its AM/PM tail to the truncation instead.
 * `hourCycle` rather than `hour12: false`, which renders midnight as 24:00
 * under some locale data.
 */
const WHEN = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const formatWhen = (iso: string) => WHEN.format(new Date(iso)).replace(",", "");

const STATUS_TONE = {
  success: "good",
  denied: "warn",
  failed: "bad",
  pending: "neutral",
} as const;

export interface ActivityRow extends Record<string, unknown> {
  id: string;
  summary: string;
  status: string;
  source: string;
  type: string;
  occurredAt: string;
  txHash?: string | null;
  actor?: string | null;
  agentId?: string | null;
  evidence?: unknown;
}

const COLUMNS: TableColumn<ActivityRow>[] = [
  {
    key: "occurredAt",
    header: "when",
    width: proportional(1, { minWidth: 190 }),
    renderCell: (row) => (
      <Text type="code" size="sm" hasTabularNumbers textWrap="nowrap">
        {formatWhen(row.occurredAt)}
      </Text>
    ),
  },
  {
    key: "status",
    header: "status",
    width: proportional(1),
    renderCell: (row) => (
      <Badge
        tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}
      >
        {row.status}
      </Badge>
    ),
  },
  { key: "source", header: "source", width: proportional(1) },
  { key: "type", header: "type", width: proportional(1) },
  { key: "summary", header: "what happened", width: proportional(3) },
];

export function ActivityTable({ events }: { events: ActivityRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const expansion = useTableRowExpansion<ActivityRow>({
    expandedKeys: expanded,
    onToggle: (key) =>
      setExpanded((prior) => {
        const next = new Set(prior);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    getRowKey: (row) => row.id,
    renderExpanded: (row) => (
      <VStack gap={0}>
        {row.txHash ? (
          <Field label="Transaction" value={row.txHash} />
        ) : null}
        {row.actor ? <Field label="Actor" value={row.actor} /> : null}
        {row.agentId ? (
          <Field
            label="Agent"
            value={
              <Link href={`/console/agents/${row.agentId}`}>{row.agentId}</Link>
            }
          />
        ) : null}
        {/*
          The evidence is whatever its source produced, rendered rather than
          summarised. A timeline that pretty-prints only the fields it already
          knows about cannot show you the one it did not expect.
        */}
        <Evidence value={row.evidence} />
      </VStack>
    ),
  });

  const windowed = useRowWindow(events);

  return (
    <VStack gap={0} width="100%" className="min-w-0">
      {/*
        `rowCount` is the loaded total rather than the visible one, so assistive
        technology announces "row 12 of 100" against the whole list instead of
        against the window — the same fact the footer states in text.
      */}
      <ScrollRegion
        scrollSelector=".astryx-table-scroll-wrapper"
        className="row-window"
      >
        <Table
          data={windowed.visible}
          columns={COLUMNS}
          idKey="id"
          density="compact"
          dividers="none"
          hasHover
          textOverflow="truncate"
          rowIndexStart={1}
          rowCount={windowed.loaded}
          plugins={{ expansion }}
        />
      </ScrollRegion>
      {/*
        Below the table, never inside it. A sentinel placed in the table's own
        markup would observe the horizontal scroll wrapper rather than the
        operator reaching the end of the list — design.md D2.
      */}
      <RowWindowFooter
        shown={windowed.shown}
        loaded={windowed.loaded}
        hasMore={windowed.hasMore}
        sentinelRef={windowed.sentinelRef}
        noun="event"
      />
    </VStack>
  );
}
