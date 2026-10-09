import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env by itself. Node can, with no extra package.
if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * drizzle-kit always uses the ADMIN (owner) connection: it creates and alters tables. The running app uses the
 * restricted runtime role from DATABASE_URL and never sees this value.
 *
 * Migrations live in ./drizzle. `drizzle-kit generate` writes the table DDL from the schema; the Row Level Security
 * functions, policies and grants are hand-written SQL in the migration named `*_rls_*` (see docs/saas-architecture.md)
 * and are applied by `npm run db:migrate`, which also provisions the runtime role first.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? "postgres://localhost/climvia" },
  strict: true,
  verbose: true,
});
