/**
 * npm run platform-admin:list
 *
 * Who is a platform administrator now (name, email, since when, how it was granted). Read-only. Prints no password, session or token.
 */
import { adminDb, adminUrl, loadEnv, waitForDatabase } from "../db/lib";

async function main() {
  loadEnv();
  await waitForDatabase(adminUrl(), Number(process.env.DB_WAIT_SECONDS ?? 30));
  const { pool } = adminDb();
  try {
    const rows = await pool.query<{ email: string; name: string; created_at: Date; granted_by: string }>(
      "select u.email, u.name, a.created_at, a.granted_by from platform_admins a join auth_user u on u.id = a.user_id where a.revoked_at is null order by a.created_at, u.email",
    );
    if (rows.rowCount === 0) {
      console.log("There is no platform administrator.");
      return;
    }
    for (const row of rows.rows) console.log(`${row.email}\t${row.name}\tsince ${row.created_at.toISOString()}\t${row.granted_by}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unexpected failure.");
  process.exit(2);
});
