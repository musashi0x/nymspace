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
import { Badge, Field } from "./primitives";

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
 * is the only reason this is a client component; the fetch stays on the server.
 */

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
    width: proportional(1),
    renderCell: (row) => (
      <Text type="code" size="sm" hasTabularNumbers textWrap="nowrap">
        {new Date(row.occurredAt).toLocaleString()}
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
        <Field label="Evidence" value={JSON.stringify(row.evidence)} />
      </VStack>
    ),
  });

  return (
    <Table
      data={events}
      columns={COLUMNS}
      idKey="id"
      density="compact"
      dividers="none"
      hasHover
      textOverflow="truncate"
      plugins={{ expansion }}
    />
  );
}
