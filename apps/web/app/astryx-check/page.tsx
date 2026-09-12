"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import {
  Table,
  proportional,
  useTableSelection,
  useTableSortable,
  type TableColumn,
  type TableSortState,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { AddressChip } from "@/components/console/visitor";
import {
  Absent,
  Badge,
  Empty,
  Field,
  Frame,
  Loading,
  Outcome,
  Provenance,
} from "@/components/console/primitives";

/**
 * Astryx smoke test (task #82), extended into Gate B for the design register.
 *
 * The original purpose stands: if the reset, the core stylesheet and the theme
 * all reach the browser, the buttons below are themed rather than bare native
 * controls. What follows proves the two things about `Frame` that cannot be
 * checked by reading it.
 *
 * First, that an interactive Astryx component keeps working inside it. The
 * table below sorts and selects; if `Frame` were doing anything other than
 * wrapping, one of those would break here rather than in the console.
 *
 * Second, that the punch follows its surface. The same frame is rendered on
 * the page body and inside a Card. The reference hardcodes the page background
 * because in prose a figure only ever sits on the page, so this is exactly the
 * bug that is invisible if you only ever look at the default surface: the
 * dashed edge must not run through either title.
 *
 * ## Nothing here is read from anything
 *
 * This page is the one surface in the product that displays values no read
 * produced, and it has to stay obvious about that. It used to show
 * `research.nymspace.eth`, `trader.nymspace.eth` and `deploy.nymspace.eth`
 * against invented read times and an address whose first six characters
 * matched the real permissioned resolver — on a route that answers 200 on the
 * production domain. A reader who found it had a console screen in front of
 * them, and `docs/03`'s rule against fake success placeholders is precisely
 * about that: a read time is this product's evidence that a value was true at
 * a moment, and printing one that never happened forges the evidence rather
 * than the value.
 *
 * One of the rows was also wrong about the system: `deploy.nymspace.eth` on
 * chain 84532. The name lives on Sepolia; only the ERC 8004 registration is on
 * Base Sepolia. Invented data drifts from the thing it imitates, which is the
 * second reason not to imitate it.
 *
 * So the rows name no agent that exists, the addresses are plainly not
 * addresses, and the provenance says so in words. It has to be the words:
 * `Provenance` renders `toLocaleTimeString()`, so the epoch comes out as
 * "8:00:00 AM" and reads as plausible as anything else. A timestamp cannot
 * disclaim itself — only the source beside it can.
 *
 * Frame, Table, sorting and selection are all exercised exactly as before.
 * None of that needed real names.
 */

interface Row extends Record<string, unknown> {
  name: string;
  chain: string;
  readAt: string;
}

const ROWS: Row[] = [
  { name: "specimen-one.invalid", chain: "—", readAt: "—" },
  { name: "specimen-two.invalid", chain: "—", readAt: "—" },
  { name: "specimen-three.invalid", chain: "—", readAt: "—" },
];

const COLUMNS: TableColumn<Row>[] = [
  { key: "name", header: "agent", width: proportional(2), sortable: true },
  { key: "chain", header: "chain", width: proportional(1), sortable: true },
  { key: "readAt", header: "read at", width: proportional(1) },
];

function ProofTable() {
  const [sort, setSort] = useState<TableSortState>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const sorted = [...ROWS].sort((a, b) => {
    const entry = sort[0];
    if (!entry) return 0;
    const dir = entry.direction === "ascending" ? 1 : -1;
    return String(a[entry.sortKey]).localeCompare(String(b[entry.sortKey])) * dir;
  });

  const sortable = useTableSortable<Row>({ sort, onSortChange: setSort });
  const selection = useTableSelection<Row>({
    getIsItemSelected: (item) => selected.includes(item.name),
    onSelectItem: ({ item, isSelected }) =>
      setSelected((prior) =>
        isSelected
          ? [...prior, item.name]
          : prior.filter((name) => name !== item.name),
      ),
    onSelectAll: ({ isAllSelected }) =>
      setSelected(isAllSelected ? ROWS.map((row) => row.name) : []),
    getIsAllSelected: () => selected.length === ROWS.length,
    getIsIndeterminate: () => selected.length > 0 && selected.length < ROWS.length,
  });

  return (
    <VStack gap={3}>
      <Table
        data={sorted}
        columns={COLUMNS}
        idKey="name"
        density="compact"
        dividers="none"
        plugins={{ sortable, selection }}
      />
      <Text type="supporting" as="p">
        {selected.length} selected · sorted by {sort[0]?.sortKey ?? "nothing"}
      </Text>
    </VStack>
  );
}

export default function AstryxCheck() {
  return (
    <VStack gap={8} padding={6} hAlign="start" className="surface-body min-h-screen">
      <VStack gap={4} hAlign="start">
        <Button variant="primary" size="md" label="Primary" />
        <Button variant="secondary" size="md" label="Secondary" />
        <Button variant="ghost" size="md" label="Ghost" />
        <Button variant="destructive" size="md" label="Destructive" />
      </VStack>

      <Frame
        title="on the page body"
        subtitle="Default surface. Sorting and selection both run inside the frame."
      >
        <ProofTable />
      </Frame>

      <Card>
        <Frame
          surface="card"
          title="on a card"
          subtitle="Same frame, different punch. The edge must not cross this title."
        >
          <Text as="p">
            A frame whose punch does not match its surface shows the dashed edge
            running straight through the title and the corner marks.
          </Text>
        </Frame>
      </Card>

      <Frame
        title="a runtime title long enough that a centred nowrap caption would overflow both edges of its own frame, which is why this one is left-anchored and truncates"
      >
        <Text as="p">design.md Q2.</Text>
      </Frame>

      {/*
        The console's vocabulary, rendered without the API. Every one of these
        is reachable in the product only behind a live read, which is exactly
        why they are worth a static surface: a primitive that renders wrong in
        an error state is a primitive nobody sees until the error happens.
      */}
      <Frame
        title="fields"
        subtitle="Nothing below was read from anything, and the source beside each value is what says so — the time cannot, because Provenance renders the clock only, so any instant it is given comes out looking like a plausible one. Provenance is a type error to omit; the last row is an in-process value, which is why it carries none."
      >
        <Field
          label="Owner"
          // Not an address. It is the right length to lay out like one and
          // cannot be mistaken for one, which is the whole requirement: this
          // page proves the row renders, not that anybody owns anything. The
          // value here used to begin `0x45DaD5`, the real permissioned
          // resolver's first six characters, on a route the production domain
          // answers.
          value="0xEXAMPLE—not an address—rendered to prove the row lays out"
          source="not a read — static demo"
          readAt="1970-01-01T00:00:00.000Z"
        />
        <Field
          label="agent-context"
          value={<Absent what="no agent-context written" />}
          source="not a read — static demo"
          readAt="1970-01-01T00:00:00.000Z"
        />
        <Field label="Controller" value="specimen-one.invalid" />
      </Frame>

      <Frame title="states">
        <HStack gap={2} wrap="wrap">
          <Badge tone="good">ENS active</Badge>
          <Badge tone="warn">registering</Badge>
          <Badge tone="bad">name mismatch</Badge>
          <Badge tone="neutral">not registered</Badge>
        </HStack>
        <Provenance source="not a read — static demo" readAt="1970-01-01T00:00:00.000Z" />
        <Loading what="Reading roles from the resolver" />
      </Frame>

      <Frame
        title="outcomes"
        subtitle="A denial is the control plane working, so it reads as information rather than as a red error."
      >
        <Outcome
          tone="proof"
          title="Write denied by the resolver"
          detail="0x45DaD5…d1F2 on agent-context reverted: Unauthorized(resource, account)"
          action="This is the expected result. The same code path returned allowed for the control account in this request."
        />
        <Outcome tone="waiting" title="Registering" detail="tx 0x9f2c…" />
        <Outcome tone="fault" title="Could not reach the resolver" detail="RPC timeout after 10s" />
      </Frame>

      {/*
        The connected-visitor chip, which is otherwise only reachable behind a
        Privy login — so this is the only place its copied state can be checked
        without an account.
      */}
      <Frame
        title="connected visitor"
        subtitle="The address is a label, never the value: six characters and four identify it, and the clipboard carries all forty-two."
      >
        <HStack gap={2} align="center" wrap="wrap">
          {/*
            The zero address, which is the only honest choice here.

            This demo needs a real forty-two characters or it stops
            demonstrating the thing it exists for — the shortening and the
            clipboard. A plausible-looking invented address satisfies that and
            renders as somebody's connected wallet; the zero address satisfies
            it and is universally nobody, which is already how the rest of this
            codebase reads it (`ZERO` means "not registered" in every chain read
            we make).
          */}
          <AddressChip address="0x0000000000000000000000000000000000000000" />
          <Button size="sm" variant="ghost" label="Disconnect" />
        </HStack>
      </Frame>

      <Frame title="nothing here">
        <Empty
          title="No agents yet"
          detail="Provisioning writes the first subname under nymspace.eth. Nothing is cached, so this is genuinely empty rather than unloaded."
        />
      </Frame>
    </VStack>
  );
}
