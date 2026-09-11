import "server-only";

/**
 * The coordination store.
 *
 * Guarded, because `db.ts` reads `DATABASE_URL` and a connection string carries
 * a password. The pure types a client component might want — the activity
 * shapes, the provisioning enums — are re-exported here rather than moved to
 * `@nymspace/core` on purpose: nothing in the console constructs one, it
 * renders what the API returns, and moving them would put the store's
 * vocabulary one careless import away from the browser.
 *
 * What this package is not: the authority for identity, permissions, trust, or
 * policy. No method on `Store` answers any of those, and `schema.test.ts`
 * enumerates the live columns against an allowlist so that stays true as the
 * schema grows.
 */

export * from "./bots";
export * from "./types";
export * from "./store";
export {
  createDatabase,
  database,
  closeDatabase,
  migrate,
  MIGRATIONS_FOLDER,
  type Database,
  type DatabaseOptions,
} from "./db";
export {
  tables,
  organizations,
  agents,
  agentProvisioning,
  identitySnapshots,
  graphSnapshots,
  financialAuthority,
  activityEvents,
  ALLOWED_COLUMNS,
  SNAPSHOT_TABLES,
  FORBIDDEN_COLUMN_SUBSTRINGS,
} from "./schema";
