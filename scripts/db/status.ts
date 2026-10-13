/**
 * npm run db:status
 *
 * Are the database's migrations current? Compares the migrations this build ships (drizzle/meta/_journal.json) with the ones the database
 * says it has applied, using the admin connection. A deployment runs it before traffic is switched to a new version.
 *
 *   exit 0   every shipped migration is applied and nothing else is
 *   exit 1   the database is behind (or ahead of) this build
 *   exit 2   the migration table is not there (never migrated) or the database can not be asked
 *
 * It prints one line of JSON and nothing secret.
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { adminUrl, loadEnv, waitForDatabase } from "./lib";

async function main() {
  loadEnv();
  const url = adminUrl();
  await waitForDatabase(url, Number(process.env.DB_WAIT_SECONDS ?? 30));
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number; tag: string }[] };
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const exists = await pool.query("select to_regclass('drizzle.__drizzle_migrations') as table_name");
    if (!exists.rows[0].table_name) {
      console.log(JSON.stringify({ expected: journal.entries.length, applied: 0, current: false, reason: "never migrated" }));
      process.exit(2);
    }
    const applied = await pool.query<{ created_at: string }>("select created_at from drizzle.__drizzle_migrations order by created_at");
    const last = applied.rows.length ? Number(applied.rows[applied.rows.length - 1].created_at) : null;
    const expectedLast = journal.entries[journal.entries.length - 1]?.when ?? null;
    const current = applied.rows.length === journal.entries.length && last === expectedLast;
    console.log(JSON.stringify({ expected: journal.entries.length, applied: applied.rows.length, current, latest: journal.entries[journal.entries.length - 1]?.tag }));
    process.exit(current ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
