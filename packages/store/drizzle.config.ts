import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` reads this to turn `src/schema.ts` into the SQL under
 * `drizzle/`, and `drizzle-kit migrate` reads it to apply them.
 *
 * The generated SQL is committed. That is the point of generating it rather
 * than pushing the schema directly: a migration someone can read in a diff is
 * reviewable, and `drizzle-kit push` would silently reshape a table during the
 * demo rehearsal that section 8 depends on.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
  strict: true,
  verbose: true,
});
