/**
 * Apply the coordination store's migrations.
 *
 * Run: pnpm --filter @nymspace/store migrate
 *
 * Goes through the same `migrate` the tests and the server call, rather than
 * shelling out to `drizzle-kit migrate`. One code path means the migration that
 * runs on a developer's machine is the migration that runs everywhere else, and
 * `drizzle-kit` stays a devDependency used only to *generate* the SQL.
 *
 * Idempotent — Drizzle records what it has applied — so this is what follows
 * `docker compose up -d` on a fresh machine.
 */

import { closeDatabase, database, migrate } from "../src/index";

async function main(): Promise<void> {
  await migrate(database());
  console.log("store: migrations applied");
  await closeDatabase();
}

main().catch((error: unknown) => {
  console.error(
    `store: migration failed — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
