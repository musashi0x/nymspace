import { getTableConfig } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWED_COLUMNS,
  FORBIDDEN_COLUMN_SUBSTRINGS,
  SNAPSHOT_TABLES,
  assertNoSecrets,
  closeDatabase,
  database,
  migrate,
  tables,
  type Database,
} from "./index";

/**
 * Task 2.5 — assert that no entity holds a permission decision, a trust score,
 * or key material as an authoritative value.
 *
 * Asserted against the columns Postgres actually has rather than against the
 * Drizzle definition, because the Drizzle definition is what generated the
 * migration and comparing it to itself would catch nothing. The live database
 * is the only place where a hand-applied column, a half-run migration, or a
 * schema someone edited without regenerating shows up.
 *
 * Requires the store's Postgres: `docker compose up -d && pnpm --filter
 * @nymspace/store db:migrate`.
 */

let db: Database;

beforeAll(async () => {
  db = database();
  await migrate(db);
});

afterAll(async () => {
  await closeDatabase();
});

/**
 * Drizzle's `execute` types its row parameter as `Record<string, unknown>`, so
 * this carries an index signature rather than being a plain interface.
 */
type ColumnRow = {
  table_name: string;
  column_name: string;
  is_nullable: "YES" | "NO";
} & Record<string, unknown>;

/**
 * Scoped to `public`. Drizzle keeps its own bookkeeping in
 * `drizzle.__drizzle_migrations`, which is not the store's schema and must not
 * be held to the store's boundary.
 */
async function liveColumns(): Promise<ColumnRow[]> {
  const { rows } = await db.execute<ColumnRow>(sql`
    select table_name, column_name, is_nullable
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, column_name
  `);
  return rows;
}

describe("the store holds coordination data and nothing else", () => {
  it("has exactly the tables the boundary declares", async () => {
    const rows = await liveColumns();
    const live = [...new Set(rows.map((r) => r.table_name))].sort();
    expect(live).toEqual(Object.keys(ALLOWED_COLUMNS).sort());
  });

  it("has no column outside the allowlist", async () => {
    const rows = await liveColumns();

    const unexpected = rows.filter(
      (row) => !ALLOWED_COLUMNS[row.table_name]?.includes(row.column_name),
    );

    expect(
      unexpected.map((row) => `${row.table_name}.${row.column_name}`),
      "A column the store is not allowed to hold. If it is genuinely " +
        "coordination data, add it to ALLOWED_COLUMNS; if it is a permission, " +
        "a trust score, or key material, it belongs in the system that owns it.",
    ).toEqual([]);
  });

  it("has no column whose name names a forbidden concept", async () => {
    const rows = await liveColumns();

    const offenders = rows.filter((row) =>
      FORBIDDEN_COLUMN_SUBSTRINGS.some((needle) =>
        row.column_name.toLowerCase().includes(needle),
      ),
    );

    expect(
      offenders.map((row) => `${row.table_name}.${row.column_name}`),
      "The store must not be able to answer a permission or trust question, " +
        "and must never hold key material.",
    ).toEqual([]);
  });

  /**
   * The complement of the allowlist. Every declared column must exist — a
   * migration that failed halfway would otherwise pass all three checks above,
   * since each only looks for columns that should not be there.
   */
  it("has every column the boundary declares", async () => {
    const rows = await liveColumns();
    const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));

    const missing = Object.entries(ALLOWED_COLUMNS).flatMap(
      ([table, columns]) =>
        columns
          .filter((column) => !live.has(`${table}.${column}`))
          .map((column) => `${table}.${column}`),
    );

    expect(missing).toEqual([]);
  });

  /**
   * The drift check, and a different assertion from the three above: that the
   * migrations under `drizzle/` were regenerated after `schema.ts` changed.
   * Editing the schema and forgetting `db:generate` produces code that
   * typechecks against columns the database does not have, and the failure
   * surfaces as a runtime error during a demo rather than here.
   */
  it("matches the Drizzle definition the migrations were generated from", async () => {
    const rows = await liveColumns();
    const live = new Map<string, Set<string>>();
    for (const row of rows) {
      const columns = live.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      live.set(row.table_name, columns);
    }

    for (const table of Object.values(tables)) {
      const config = getTableConfig(table);
      const declared = config.columns.map((column) => column.name).sort();
      const actual = [...(live.get(config.name) ?? [])].sort();
      expect(
        actual,
        `${config.name} differs from src/schema.ts — run \`pnpm --filter @nymspace/store db:generate\` and apply the migration`,
      ).toEqual(declared);
    }
  });
});

describe("cached external state carries its read time", () => {
  it("requires fetched_at on every snapshot table", async () => {
    const rows = await liveColumns();

    for (const table of SNAPSHOT_TABLES) {
      const column = rows.find(
        (row) => row.table_name === table && row.column_name === "fetched_at",
      );
      expect(column, `${table} has no fetched_at column`).toBeDefined();
      expect(
        column?.is_nullable,
        `${table}.fetched_at is nullable, so a snapshot can be written with no ` +
          "read time — which reaches the interface indistinguishable from a live read",
      ).toBe("NO");
    }
  });

  /**
   * The one place invented reputation could be written to disk. A `NOT NULL
   * DEFAULT 0` would turn "no ValidationRegistry is deployed on this network"
   * into "this agent scored zero", which `docs/04` forbids.
   */
  it("keeps validation_count nullable so an absent dimension is not a zero", async () => {
    const rows = await liveColumns();
    const column = rows.find(
      (row) =>
        row.table_name === "graph_snapshots" &&
        row.column_name === "validation_count",
    );
    expect(column?.is_nullable).toBe("YES");
  });
});

describe("metadata cannot smuggle key material in", () => {
  it("refuses a secret-shaped key", () => {
    expect(() => assertNoSecrets({ privateKey: "anything" })).toThrow(
      /secret-shaped key/,
    );
    expect(() => assertNoSecrets({ request: { appSecret: "x" } })).toThrow(
      /metadata\.request\.appSecret/,
    );
    expect(() =>
      assertNoSecrets({ calls: [{ authorization_key_id: "x" }] }),
    ).toThrow(/metadata\.calls\.0\.authorization_key_id/);
  });

  it("permits ordinary coordination metadata", () => {
    expect(() =>
      assertNoSecrets({
        label: "research",
        nested: { chainId: 11155111, endpoints: ["mcp"] },
      }),
    ).not.toThrow();
  });

  /**
   * The limit of this guard, asserted so it is a known limit rather than an
   * assumed absence. A private key, a transaction hash, a namehash, and an EAC
   * resource are all 32 bytes of hex, so no value-shaped check can separate key
   * material from the evidence this store exists to record. Rejecting the shape
   * would reject the store's most common legitimate content — which is why the
   * guard reads names, and why the typed entity fields are the part that
   * actually makes a credential unspellable.
   */
  it("passes 32-byte hex under an innocent name, because evidence looks identical", () => {
    const thirtyTwoBytes = `0x${"1".repeat(64)}`;

    expect(() => assertNoSecrets({ txHash: thirtyTwoBytes })).not.toThrow();
    expect(() => assertNoSecrets({ node: thirtyTwoBytes })).not.toThrow();
    // The same bytes under a name that declares what they are is still caught.
    expect(() => assertNoSecrets({ privateKey: thirtyTwoBytes })).toThrow(
      /secret-shaped key/,
    );
  });
});
