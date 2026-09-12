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
// From `@nymspace/core`, never `@nymspace/privy` — that package is `server-only`
// guarded and importing it here would break the client boundary. `task-request`
// takes the same route to the same function.
import { formatAmount } from "@nymspace/core";
import { Absent, Badge, Provenance } from "./primitives";
import { RowWindowFooter, ScrollRegion, useRowWindow } from "./row-window";

/**
 * Who may spend, and how much per transaction.
 *
 * Wallet administration across the fleet, which until now existed only as one
 * frame inside a single agent's page — answerable for one agent at a time, and
 * never comparable. `docs/08` names wallet administration among the B2B
 * workflows; this is the screen that makes it one.
 *
 * ## What this table refuses to draw
 *
 * No balance column. The wallet route does not return one, reading it would
 * cost an RPC per agent on a second chain, and its failure mode renders as
 * `0.00 USDC` — a fabricated number on the one screen whose entire job is
 * saying what is actually true about money. `EMPTY_STATES.noWallet` already
 * commits the product to that position: "no wallet, no policy, and therefore no
 * balance to show."
 *
 * No total either. A policy limit is a per-transaction cap, not a budget and
 * not a balance, so three agents sharing one 5 USDC policy have no 15 USDC of
 * anything. Summed into a headline it would be read as a treasury balance,
 * which is why the header counts wallets instead.
 */

// `extends Record<string, unknown>` because Astryx's `Table` constrains its row
// type that way, and an interface gets no implicit index signature. `FleetRow`
// does the same thing for the same reason.
export interface TreasuryRow extends Record<string, unknown> {
  id: string;
  slug: string;
  ensName: string;
  controllerAddress: string;
  wallet:
    | {
        status: "provisioned";
        address: string;
        policy: {
          label: string;
          maxAmount: string;
          token: { address: string; symbol: string; decimals: number } | null;
          ruleName: string;
        } | null;
      }
    | { status: "no_wallet" }
    | { status: "unavailable"; reason: string };
  readAt: string;
}

/**
 * Four states, and the third one is why this screen needed its own route.
 *
 * `no_wallet` and `unavailable` are opposite claims — one says this agent has
 * no financial authority, the other says we do not currently know what its
 * authority is — so they get different words, different tones, and different
 * copy in every cell. Collapsing them would understate an agent's power, which
 * is the direction that actually matters.
 */
function walletBadge(wallet: TreasuryRow["wallet"]) {
  if (wallet.status === "no_wallet") {
    return <Badge tone="neutral">not provisioned</Badge>;
  }
  if (wallet.status === "unavailable") {
    return <Badge tone="bad">policy unreadable</Badge>;
  }
  return wallet.policy ? (
    <Badge tone="good">policy enforced</Badge>
  ) : (
    <Badge tone="warn">wallet, no policy</Badge>
  );
}

const COLUMNS: TableColumn<TreasuryRow>[] = [
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
  {
    // Two, not one: at `proportional(1)` the badge clipped to "not provisi…",
    // and a truncated status is worse than a shorter word — the reader cannot
    // tell "not provisioned" from "policy unreadable", which are the two states
    // this column exists to keep apart.
    key: "wallet",
    header: "authority",
    width: proportional(2),
    renderCell: (row) => walletBadge(row.wallet),
  },
  {
    key: "address",
    header: "wallet",
    width: proportional(2),
    renderCell: (row) =>
      row.wallet.status === "provisioned" ? (
        <Text type="code" size="2xs" wordBreak="break-all">
          {row.wallet.address}
        </Text>
      ) : row.wallet.status === "unavailable" ? (
        <Absent what="the wallet exists; its policy could not be read" />
      ) : (
        <Absent what="no wallet provisioned" />
      ),
  },
  {
    key: "limit",
    header: "per transaction",
    width: proportional(2),
    renderCell: (row) => {
      if (row.wallet.status === "no_wallet") {
        return <Absent what="no policy, so no limit" />;
      }
      if (row.wallet.status === "unavailable") {
        // Unknown, not absent. The distinction is the whole point of the state.
        return <Absent what="Privy did not answer — the limit is unknown" />;
      }
      if (!row.wallet.policy) {
        return <Absent what="nothing constrains this wallet" />;
      }
      return (
        <VStack gap={0.5}>
          {/*
            Never the raw base-unit number. `5000000` unqualified is the
            confidently-wrong figure the token helpers exist to prevent — it is
            5 USDC, and six decimals is not a detail the reader should carry.
          */}
          <Text type="code" hasTabularNumbers>
            {formatAmount(row.wallet.policy.maxAmount, row.wallet.policy.token)}
          </Text>
          {/*
            Per row, because each policy was read at its own moment. One
            timestamp in the header would claim a simultaneity that did not
            happen.
          */}
          <Provenance source="privy" readAt={row.readAt} />
        </VStack>
      );
    },
  },
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
          Only where a policy is actually enforced. Offering "request a task"
          against an agent whose limit could not be read is a link to a form
          that cannot tell the operator what it is about to be judged by.
        */}
        {row.wallet.status === "provisioned" && row.wallet.policy ? (
          <Link href={`/console/agents/${row.id}#task`}>
            <Text type="body" size="sm" color="secondary">
              Request a task
            </Text>
          </Link>
        ) : null}
      </HStack>
    ),
  },
];

export function TreasuryTable({ rows }: { rows: TreasuryRow[] }) {
  const sticky = useTableStickyColumns<TreasuryRow>({ startKeys: ["ensName"] });
  const windowed = useRowWindow(rows);

  return (
    <VStack gap={0} width="100%" className="min-w-0">
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
          verticalAlign="top"
          rowIndexStart={1}
          rowCount={windowed.loaded}
          plugins={{ sticky }}
        />
      </ScrollRegion>
      <RowWindowFooter
        shown={windowed.shown}
        loaded={windowed.loaded}
        hasMore={windowed.hasMore}
        sentinelRef={windowed.sentinelRef}
        noun="agent"
      />
    </VStack>
  );
}
