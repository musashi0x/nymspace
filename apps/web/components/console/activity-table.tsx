"use client";

import {
  Table,
  proportional,
  useTableRowExpansion,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { explorerTxUrl, publicEnv } from "@nymspace/core";
import Link from "next/link";
import { useState } from "react";
import { Badge, Evidence, Field } from "./primitives";
import { RowWindowFooter, ScrollRegion, useRowWindow } from "./row-window";

/**
 * Where a row's transaction actually landed.
 *
 * `evidence.chainId` wins when the source carries one — `erc8004` writes on
 * whichever chain its registry is deployed to, which need not be this app's
 * configured chain. `privy` never carries a chain id on the evidence itself:
 * every payment and registration it signs goes through
 * `eip155:${REGISTRATION_CHAIN_ID}` in `apps/api/src/deps.ts`, so that value
 * is duplicated here rather than invented. Anything else — `ens`, `app` — ran
 * on the chain this deployment points at.
 */
const PRIVY_CHAIN_ID = 84532;

function chainIdOf(evidence: unknown): number {
  if (evidence && typeof evidence === "object" && "chainId" in evidence) {
    const value = (evidence as { chainId: unknown }).chainId;
    if (typeof value === "number") return value;
  }
  if (
    evidence &&
    typeof evidence === "object" &&
    "source" in evidence &&
    (evidence as { source: unknown }).source === "privy"
  ) {
    return PRIVY_CHAIN_ID;
  }
  return publicEnv().chainId;
}

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
        {row.txHash
          ? (() => {
              const url = explorerTxUrl(chainIdOf(row.evidence), row.txHash);
              return (
                <Field
                  label="Transaction"
                  value={
                    url ? (
                      <AstryxLink href={url} isExternalLink type="code" size="sm">
                        {row.txHash}
                      </AstryxLink>
                    ) : (
                      row.txHash
                    )
                  }
                />
              );
            })()
          : null}
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
