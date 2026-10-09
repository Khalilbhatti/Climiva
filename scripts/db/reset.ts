/**
 * npm run db:reset
 *
 * DEVELOPMENT ONLY. Drops the database named by DATABASE_ADMIN_URL, recreates it, applies every migration and seeds it.
 * Use it to get back to a known state. Refuses to run when NODE_ENV=production.
 */
import { adminUrl, databaseName, loadEnv, migrateDatabase, recreateDatabase, requireEnv } from "./lib";
import { seedDevelopmentData } from "./seed-lib";

async function main() {
  loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("db:reset must never run in production.");
  const name = databaseName(adminUrl());
  await recreateDatabase(name);
  await migrateDatabase(adminUrl(), requireEnv("POSTGRES_APP_PASSWORD"));
  await seedDevelopmentData();
  console.log(`Database "${name}" was reset and seeded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
