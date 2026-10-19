/**
 * npm run platform-admin:grant -- --email <address>
 *
 * Make an EXISTING person a platform super administrator.
 *
 *   - The person must already have an account (they signed up like anyone else). This command never creates an account.
 *   - The address is matched exactly after trimming and lower-casing; an unknown address is refused.
 *   - Running it again for the same person changes nothing and says so.
 *   - It is not reachable from a browser or an API. It connects as the database owner and writes the grant and its audit event in one transaction.
 *
 * Exit codes: 0 granted (or already was), 1 refused (unknown person, bad arguments), 2 something went wrong.
 */
import { adminDb, adminUrl, loadEnv, waitForDatabase } from "../db/lib";
import { emailFromArguments, operatorLabel, UsageError } from "./lib";

async function main() {
  const email = emailFromArguments(process.argv);
  loadEnv();
  await waitForDatabase(adminUrl(), Number(process.env.DB_WAIT_SECONDS ?? 30));
  const { pool } = adminDb();
  const by = operatorLabel();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ id: string }>("select id from auth_user where lower(email) = $1", [email]);
    if (found.rowCount !== 1) {
      await client.query("rollback");
      console.error("No account has that email address. The person must sign up first; this command does not create accounts.");
      process.exitCode = 1;
      return;
    }
    const userId = found.rows[0].id;
    const inserted = await client.query("insert into platform_admins (user_id, role, granted_via, granted_by) values ($1, 'super_admin', 'cli', $2) on conflict do nothing returning id", [userId, by]);
    if (inserted.rowCount === 0) {
      await client.query("rollback");
      console.log("That person is already a platform super administrator. Nothing changed.");
      return;
    }
    await client.query(
      "insert into platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, metadata) values ('platform_admin.granted', 'cli', null, $1, 'user', $2, $3::jsonb)",
      [by, userId, JSON.stringify({ email, role: "super_admin" })],
    );
    await client.query("commit");
    console.log("Granted: that person is now a platform super administrator.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(error.message);
    console.error("Usage: npm run platform-admin:grant -- --email <address>");
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : "Unexpected failure.");
  process.exit(2);
});
