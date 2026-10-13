/**
 * npm run db:migrate
 *
 * Creates the database if it does not exist, provisions the restricted runtime role, and applies every pending
 * migration, all with the admin (owner) connection. Safe to run any number of times, including on every deploy.
 *
 * It waits (with retries, bounded by DB_WAIT_SECONDS) for the server to accept connections first, and it NEVER seeds: the sample businesses
 * come from `db:seed`, which refuses to run in production. A migration that fails stops here with a non-zero exit, and nothing is started on top.
 */
import { adminUrl, databaseName, ensureDatabase, loadEnv, migrateDatabase, requireEnv, waitForDatabase } from "./lib";

async function main() {
  loadEnv();
  const url = adminUrl();
  const name = databaseName(url);

  await waitForDatabase(adminUrl("postgres"));
  await ensureDatabase(name);
  await migrateDatabase(url, requireEnv("POSTGRES_APP_PASSWORD"));
  console.log(`Database "${name}" is up to date.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
