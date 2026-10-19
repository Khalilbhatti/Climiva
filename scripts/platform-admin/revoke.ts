/**
 * npm run platform-admin:revoke -- --email <address>
 *
 * Take platform authority away from a person. The account itself is NOT deleted and the person's businesses are untouched. The assignment row
 * is kept (marked revoked) so the history stays; the authority ends at once, because every platform request asks the database again.
 *
 * Running it for someone who is not an administrator changes nothing and says so.
 *
 * Exit codes: 0 revoked (or was not an administrator), 1 refused (unknown person, bad arguments), 2 something went wrong.
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
      console.error("No account has that email address.");
      process.exitCode = 1;
      return;
    }
    const userId = found.rows[0].id;
    const revoked = await client.query("update platform_admins set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null returning id", [userId, by]);
    if (revoked.rowCount === 0) {
      await client.query("rollback");
      console.log("That person is not a platform administrator. Nothing changed.");
      return;
    }
    await client.query(
      "insert into platform_audit_events (action, actor_kind, actor_user_id, actor_label, target_kind, target_id, metadata) values ('platform_admin.revoked', 'cli', null, $1, 'user', $2, $3::jsonb)",
      [by, userId, JSON.stringify({ email, role: "super_admin" })],
    );
    const remaining = await client.query<{ n: string }>("select count(*)::text as n from platform_admins where revoked_at is null");
    await client.query("commit");
    console.log("Revoked: that person is no longer a platform administrator. Their account and businesses are unchanged.");
    if (remaining.rows[0].n === "0") console.log("Note: there is no platform administrator now. Grant one with npm run platform-admin:grant.");
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
    console.error("Usage: npm run platform-admin:revoke -- --email <address>");
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : "Unexpected failure.");
  process.exit(2);
});
