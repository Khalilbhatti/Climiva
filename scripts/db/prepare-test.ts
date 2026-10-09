/**
 * npm run db:test:prepare
 *
 * Gives the end-to-end tests a pristine database: drops and recreates `climvia_test` (a separate database, so the
 * development data is never touched), applies every migration from scratch and seeds it. This is also the
 * "migrate and seed from a clean database" check. Runs automatically before `npm run test:e2e`.
 */
import { adminUrl, loadEnv, migrateDatabase, recreateDatabase, requireEnv } from "./lib";
import { seedDevelopmentData } from "./seed-lib";

export const TEST_DATABASE = process.env.TEST_DATABASE_NAME ?? "climvia_test";

async function main() {
  loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("db:test:prepare must never run in production.");
  await recreateDatabase(TEST_DATABASE);
  await migrateDatabase(adminUrl(TEST_DATABASE), requireEnv("POSTGRES_APP_PASSWORD"));
  await seedDevelopmentData(TEST_DATABASE);
  console.log(`Test database "${TEST_DATABASE}" was recreated, migrated and seeded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
