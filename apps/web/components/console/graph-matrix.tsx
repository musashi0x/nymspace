import { Table, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { LensMatrix } from "@nymspace/core";
import { Frame } from "./frame";

/**
 * The register's `graph-matrix`, implemented in Astryx.
 *
 * Exact numbers on both axes: columns across, row labels down the left, counts
 * right-aligned in tabular figures. `mdx-graphs.kshv.me/docs/graph-matrix` is
 * the specification; nothing from that registry is installed, per
 * `openspec/changes/adopt-console-design-register/` design.md D1 — the
 * alternative of installing the shadcn source for read-only surfaces was
 * considered there and rejected because the seam would fall inside a single
 * screen, which is exactly what the chat is: figures and a textarea on one
 * page, two resets fighting over it.
 *
 * Composing it is most of the work already done. `Frame` is the dashed edge
 * and the `[ TITLE ]` notch, and `theme.ts` already gives every `table-cell`
 * the mono family, `tabular-nums` and the +0.02em tracking the register asks
 * for — so a plain Astryx `Table` inside a `Frame` *is* the register's grid,
 * rather than something styled to look like it.
 *
 * The one trait carried here is recession. The reference dims rows that are
 * not the accent to ~0.4 so the eye lands on the row being argued about. In a
 * confusion matrix that is a chosen class; here it is a row with nothing in it,
 * because a source that recorded no events is the row a reader should skip.
 */

/** What a cell is once the matrix is flattened for the table. */
type MatrixRow = Record<string, string> & { id: string; label: string };

function toRows(matrix: LensMatrix): MatrixRow[] {
  return matrix.rows.map((row) => {
    const cells: Record<string, string> = {};
    matrix.columns.forEach((column, i) => {
      cells[`c${i}`] = String(row.values[i] ?? 0);
    });
    return { id: row.label, label: row.label, ...cells };
  });
}

/**
 * A number, right-aligned, receding when the row holds nothing.
 *
 * Zero is printed rather than blanked. An empty cell in a counted grid reads as
 * "not measured", and the whole point of counting every event is that zero
 * denials is a finding — one this product would be wrong to render as absence.
 */
function Cell({ value, muted }: { value: string; muted: boolean }) {
  return (
    <HStack justify="end" width="100%">
      <Text type="code" color={muted ? "secondary" : undefined}>
        {value}
      </Text>
    </HStack>
  );
}

export function GraphMatrix({
  matrix,
  surface = "body",
}: {
  matrix: LensMatrix;
  surface?: "body" | "card";
}) {
  const rows = toRows(matrix);

  const columns: TableColumn<MatrixRow>[] = [
    {
      key: "label",
      header: matrix.rowHeader ?? "",
      // Wider than the count columns: these are source names and event types,
      // and the numbers beside them are rarely more than three digits.
      width: proportional(2),
      renderCell: (row) => <Text type="code">{row.label}</Text>,
    },
    ...matrix.columns.map((column, i): TableColumn<MatrixRow> => ({
      key: `c${i}`,
      // Right-aligned over right-aligned numbers. Left-aligned headings put
      // the word at one edge of the column and its digits at the other, so the
      // reader re-finds which column they are in on every row — the precise
      // illegibility tabular figures exist to remove.
      header: (
        <HStack justify="end" width="100%">
          <Text type="label">{column}</Text>
        </HStack>
      ),
      width: proportional(1),
      renderCell: (row) => (
        <Cell value={row[`c${i}`] ?? "0"} muted={isEmptyRow(row, matrix)} />
      ),
    })),
  ];

  return (
    <Frame title={matrix.title} subtitle={matrix.caption} surface={surface}>
      <VStack gap={0} width="100%" className="min-w-0">
        <Table
          data={rows}
          columns={columns}
          idKey="id"
          density="compact"
          dividers="none"
          verticalAlign="top"
        />
      </VStack>
    </Frame>
  );
}

/** Every count zero — the row the reference would recede. */
function isEmptyRow(row: MatrixRow, matrix: LensMatrix): boolean {
  return matrix.columns.every((_, i) => (row[`c${i}`] ?? "0") === "0");
}
