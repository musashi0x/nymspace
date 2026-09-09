"use client";

import {
  Table,
  pixel,
  proportional,
  useTableStickyColumns,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { Badge } from "./primitives";

/**
 * The fleet as rows.
 *
 * Each agent shows its five integration states separately, which is task 7.1
 * and `docs/09`'s closing instruction. A single "ready" badge would be easier
 * to read and would hide exactly the thing an operator needs: which integration
 * is incomplete. An agent with a verified identity and no wallet is not broken,
 * it is financially unprovisioned, and only five values can say so.
 *
 * Rows rather than a grid of cards. Five states per agent across a card grid
 * are five values you compare by scanning back and forth; as columns they line
 * up, and one agent stuck on ENSIP 25 is visible without reading any of the
 * others.
 */

/** How each track reads to an operator, and whether it is good news. */
const TRACK_LABELS: Record<
  string,
  Record<string, { text: string; tone: "good" | "warn" | "bad" | "neutral" }>
> = {
  ens: {
    draft: { text: "not registered", tone: "neutral" },
    pending: { text: "registering", tone: "warn" },
    active: { text: "ENS active", tone: "good" },
    failed: { text: "ENS failed", tone: "bad" },
  },
  erc8004: {
    unregistered: { text: "no registration", tone: "neutral" },
    pending: { text: "registering", tone: "warn" },
    registered: { text: "registered", tone: "good" },
    failed: { text: "registration failed", tone: "bad" },
  },
  ensip25: {
    unchecked: { text: "not checked", tone: "neutral" },
    checking: { text: "checking", tone: "warn" },
    verified: { text: "verified", tone: "good" },
    registry_claim_missing: { text: "no registry claim", tone: "warn" },
    ens_record_missing: { text: "no ENS record", tone: "warn" },
    mismatch: { text: "name mismatch", tone: "bad" },
    rpc_error: { text: "could not check", tone: "neutral" },
  },
  graph: {
    not_indexed: { text: "not indexed", tone: "neutral" },
    pending: { text: "indexing", tone: "warn" },
    indexed: { text: "discoverable", tone: "good" },
    provider_error: { text: "provider error", tone: "bad" },
  },
  financial: {
    no_wallet: { text: "no wallet", tone: "neutral" },
    wallet_created: { text: "wallet, no policy", tone: "warn" },
    policy_configured: { text: "policy configured", tone: "good" },
    financially_active: { text: "policy enforced", tone: "good" },
    failed: { text: "wallet failed", tone: "bad" },
  },
};

/**
 * Exported because the create screen renders the same five tracks while it
 * provisions. Two copies of this map would drift, and the copy that drifted
 * would be the one telling an operator an agent was fine.
 */
export function track(kind: string, value: string) {
  return TRACK_LABELS[kind]?.[value] ?? { text: value, tone: "neutral" as const };
}

export interface FleetRow extends Record<string, unknown> {
  id: string;
  ensName: string;
  controllerAddress: string;
  privyWalletId?: string | null;
  status: {
    ens: string;
    erc8004: string;
    ensip25: string;
    graph: string;
    financial: string;
  };
}

/** One status column, since all five read the same way. */
function statusColumn(
  kind: keyof FleetRow["status"],
  header: string,
): TableColumn<FleetRow> {
  return {
    key: kind,
    header,
    width: proportional(1),
    renderCell: (row) => {
      const t = track(kind, row.status[kind]);
      return <Badge tone={t.tone}>{t.text}</Badge>;
    },
  };
}

const COLUMNS: TableColumn<FleetRow>[] = [
  {
    key: "ensName",
    header: "agent",
    width: proportional(2),
    renderCell: (row) => (
      <VStack gap={0.5}>
        <Link href={`/console/agents/${row.id}`}>
          <Text type="code">{row.ensName}</Text>
        </Link>
        <Text type="code" size="2xs" color="secondary" wordBreak="break-all">
          {row.controllerAddress}
        </Text>
      </VStack>
    ),
  },
  statusColumn("ens", "identity"),
  statusColumn("erc8004", "registry"),
  statusColumn("ensip25", "verification"),
  statusColumn("graph", "discovery"),
  statusColumn("financial", "financial"),
  {
    key: "actions",
    header: "",
    width: pixel(180),
    renderCell: (row) => (
      <HStack gap={3} wrap="wrap">
        <Link href={`/console/agents/${row.id}`}>
          <Text type="body" size="sm">
            Inspect
          </Text>
        </Link>
        {/*
          Only offered when a wallet exists. A task request against an agent
          with no wallet is a link to a form that cannot submit.
        */}
        {row.privyWalletId ? (
          <Link href={`/console/agents/${row.id}#task`}>
            <Text type="body" size="sm" color="secondary">
              Request task
            </Text>
          </Link>
        ) : null}
      </HStack>
    ),
  },
];

export function FleetTable({ agents }: { agents: FleetRow[] }) {
  // Seven columns do not fit a narrow viewport, so the table scrolls inside its
  // own wrapper. Pinning the name is what keeps that readable: scrolled to the
  // financial column with the name gone, every row looks the same and the five
  // states stop belonging to anyone.
  const sticky = useTableStickyColumns<FleetRow>({ startKeys: ["ensName"] });

  return (
    <Table
      data={agents}
      columns={COLUMNS}
      idKey="id"
      density="compact"
      dividers="none"
      hasHover
      verticalAlign="top"
      plugins={{ sticky }}
    />
  );
}
