import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import * as schema from "./schema";

/**
 * The connection pool and the Drizzle instance.
 *
 * Guarded, because `DATABASE_URL` carries a password and this is the only
 * module that reads it. Nothing above this file sees a credential: the store
 * takes a database handle, and route handlers take a store.
 *
 * `pg` is imported as a default and destructured rather than named-imported.
 * It is CommonJS, and a named import resolves under a bundler and fails under
 * plain Node — the two runtimes this package has to work in.
 */
const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseOptions {
  connectionString?: string;
  /** Bounded low on purpose: three agents, one demo, no reason for more. */
  max?: number;
}

interface Handle {
  db: Database;
  pool: pg.Pool;
}

let cached: Handle | undefined;

/**
 * Build a pool and a Drizzle instance over it.
 *
 * Fails naming the variable rather than connecting to a default, per the
 * startup-validation rule in `docs/19_ENV_AND_CONFIG.md`: a store that silently
 * connects somewhere else is worse than one that refuses to start.
 */
export function createDatabase(options: DatabaseOptions = {}): Handle {
  const connectionString =
    options.connectionString ?? process.env["DATABASE_URL"];

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required for the coordination store. " +
        "`docker compose up -d` serves the value in .env.example.",
    );
  }

  const pool = new Pool({ connectionString, max: options.max ?? 5 });
  return { db: drizzle({ client: pool, schema }), pool };
}

/** The process-wide handle. One per process; {@link closeDatabase} ends it. */
export function database(): Database {
  cached ??= createDatabase();
  return cached.db;
}

export async function closeDatabase(): Promise<void> {
  if (!cached) return;
  const ending = cached;
  cached = undefined;
  await ending.pool.end();
}

/**
 * Where `drizzle-kit generate` writes, resolved from this file rather than from
 * the working directory — the migrator is called from the package script, from
 * test setup, and potentially from a server process, and only one of those runs
 * with the package as its cwd.
 */
export const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

/**
 * Apply pending migrations.
 *
 * Drizzle records what it has applied in `drizzle.__drizzle_migrations`, so
 * this is idempotent and safe at startup and in test setup. The bookkeeping
 * table lives in its own schema, which is why the boundary tests scope
 * themselves to `public`.
 */
export async function migrate(db: Database = database()): Promise<void> {
  await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
