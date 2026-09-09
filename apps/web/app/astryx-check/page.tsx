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
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { Frame } from "@/components/console/frame";

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
 */

interface Row extends Record<string, unknown> {
  name: string;
  chain: string;
  readAt: string;
}

const ROWS: Row[] = [
  { name: "research.nymspace.eth", chain: "11155111", readAt: "12:04:11" },
  { name: "trader.nymspace.eth", chain: "11155111", readAt: "12:04:09" },
  { name: "deploy.nymspace.eth", chain: "84532", readAt: "12:03:57" },
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
    </VStack>
  );
}
