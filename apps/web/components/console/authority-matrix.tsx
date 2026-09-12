"use client";

import {
  Table,
  proportional,
  type TableColumn,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "./primitives";

/**
 * The authority matrix as an Astryx table.
 *
 * Every cell is a `hasRoles` read against the resolver's own fallback chain.
 * `docs/01`'s first success metric is that 100 percent of displayed permission
 * state is contract derived, so nothing here is a constant, an inference from
 * another cell, or the spec's own policy table retyped.
 *
 * A client component only because the decision cell renders a Badge, and a
 * `renderCell` function cannot cross the server boundary. The reads stay on the
 * server; this receives their answers.
 */

export interface AuthorityRow extends Record<string, unknown> {
  capability: string;
  allowed: boolean;
}

/**
 * Built per call rather than defined once, because the decision column's header
 * names whose authority was read.
 *
 * `VisitorAuthority` renders this same table for a wallet the reader connected,
 * and a column still headed "agent controller" over the reader's own answers
 * would attribute the denials to the wrong account — on the one table whose
 * argument is that the account is what changes the answer.
 */
function columns(header: string): TableColumn<AuthorityRow>[] {
  return [
    { key: "capability", header: "capability", width: proportional(3) },
    {
      key: "allowed",
      header,
      width: proportional(1),
      renderCell: (row) => (
        <Badge tone={row.allowed ? "good" : "bad"}>
          {row.allowed ? "Allowed" : "Denied"}
        </Badge>
      ),
    },
  ];
}

/**
 * The two permission maps arrive as plain data and are flattened here.
 *
 * They used to be flattened by an `authorityRows` helper exported from this
 * file, which a server component called directly — and every export of a
 * `"use client"` module is a client reference, not a function the server can
 * invoke. It failed at runtime with "Attempted to call authorityRows() from the
 * server". Passing the records through as props keeps the boundary where React
 * actually draws it.
 */
export function AuthorityMatrix(
  props:
    | {
        recordPermissions: Record<string, boolean>;
        registryPermissions: Record<string, boolean>;
        header?: string;
      }
    /*
      Already-flattened rows, for the client-side read against a connected
      wallet. That caller holds the same two records but has flattened them to
      build its own loading and failure states around, and re-splitting them
      here to re-join them would be two shapes of one list.
    */
    | { rows: AuthorityRow[]; header?: string },
) {
  const rows: AuthorityRow[] =
    "rows" in props
      ? props.rows
      : [
          ...Object.entries(props.recordPermissions).map(
            ([capability, allowed]) => ({ capability, allowed }),
          ),
          ...Object.entries(props.registryPermissions).map(
            ([capability, allowed]) => ({
              capability: `${capability} (registry)`,
              allowed,
            }),
          ),
        ];

  return (
    <Table
      data={rows}
      columns={columns(props.header ?? "agent controller")}
      idKey="capability"
      density="compact"
      dividers="none"
      textOverflow="truncate"
    />
  );
}
