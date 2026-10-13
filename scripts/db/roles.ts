/**
 * npm run db:roles
 *
 * Create (or refresh the password of) the restricted runtime role `climvia_app` and do nothing else: no schema, no data. A restore needs it:
 * a backup holds the privileges and policies granted to that role but not the role itself (roles belong to the server, not to one database), so
 * the role must exist before the dump is restored into a clean server.
 */
import { adminDb, adminUrl, loadEnv, provisionRuntimeRole, requireEnv, waitForDatabase } from "./lib";

async function main() {
  loadEnv();
  await waitForDatabase(adminUrl("postgres"));
  const { pool } = adminDb(adminUrl("postgres"));
  try {
    await provisionRuntimeRole(pool, requireEnv("POSTGRES_APP_PASSWORD"));
    console.log("The runtime role is in place.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
