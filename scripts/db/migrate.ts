/**
 * npm run db:migrate
 *
 * Creates the database if it does not exist, provisions the restricted runtime role, and applies every pending
 * migration, all with the admin (owner) connection. Safe to run any number of times, including on every deploy.
 */
import { adminUrl, databaseName, ensureDatabase, loadEnv, migrateDatabase, requireEnv } from "./lib";

async function main() {
  loadEnv();
  const url = adminUrl();
  const name = databaseName(url);

  await ensureDatabase(name);
  await migrateDatabase(url, requireEnv("POSTGRES_APP_PASSWORD"));
  console.log(`Database "${name}" is up to date.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
