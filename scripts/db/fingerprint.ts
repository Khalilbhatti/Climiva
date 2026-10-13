/**
 * npm run db:fingerprint -- [database]
 * npm run db:fingerprint -- --compare <database> <database>
 *
 * A digest of what a database HOLDS: for every table in the public schema, how many rows and an md5 of all of them (each row as text, in a
 * fixed order). Two databases with the same fingerprint hold the same data. A backup is only a backup once it has been restored somewhere and
 * shown to hold what the original held, and this is how that is shown: fingerprint the source, restore the dump into a clean database,
 * fingerprint that, compare.
 *
 * Reads with the admin (owner) connection, which sees every row of every business (Row Level Security does not apply to it). It prints no row, no
 * value and no secret: table names, counts and digests.
 *
 *   one database    prints one JSON document (tables, counts at a glance, the sample businesses found, the number of migrations). Defaults to the
 *                   database DATABASE_ADMIN_URL names.
 *   --compare a b   prints what differs and exits 1 if anything does (a table missing on one side, or a different count or digest), 0 if the two match.
 */
import { Pool } from "pg";
import { adminUrl, databaseName, loadEnv, waitForDatabase, withDatabase } from "./lib";

type TableDigest = { rows: number; digest: string };
type Fingerprint = {
  database: string;
  migrations: number | null;
  demoOrganizations: string[];
  glance: Record<string, number | null>;
  tables: Record<string, TableDigest>;
};

const AT_A_GLANCE = ["organizations", "customers", "bookings", "jobs", "invoices", "payments", "sites", "site_domains", "assets", "organization_branding"];

async function fingerprintOf(base: string, database: string): Promise<Fingerprint> {
  const url = withDatabase(base, database);
  await waitForDatabase(url, Number(process.env.DB_WAIT_SECONDS ?? 30));
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const names = (await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name")).rows.map((row) => row.table_name);
    const tables: Record<string, TableDigest> = {};
    for (const name of names) {
      // The table name comes from the catalogue, not from a person; quote it all the same.
      const quoted = `"${name.replace(/"/g, '""')}"`;
      const result = await pool.query<{ rows: string; digest: string }>(`select count(*)::text as rows, md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) as digest from ${quoted} t`);
      tables[name] = { rows: Number(result.rows[0].rows), digest: result.rows[0].digest };
    }
    const demo = await pool.query<{ slug: string }>("select slug from organizations where slug in ('apex-climate-heating-air', 'northstar-heating-cooling') or name ilike 'apex climate%' or name ilike 'northstar heating%'");
    const migrations = await pool.query<{ n: string }>("select count(*)::text as n from drizzle.__drizzle_migrations").then((result) => Number(result.rows[0].n), () => null);
    return {
      database,
      migrations,
      demoOrganizations: demo.rows.map((row) => row.slug),
      glance: Object.fromEntries(AT_A_GLANCE.map((table) => [table, tables[table]?.rows ?? null])),
      tables,
    };
  } finally {
    await pool.end();
  }
}

function differences(a: Fingerprint, b: Fingerprint): string[] {
  const lines: string[] = [];
  for (const name of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
    const x = a.tables[name];
    const y = b.tables[name];
    if (!x || !y) lines.push(`MISSING  ${name} (${x ? `not in ${b.database}` : `not in ${a.database}`})`);
    else if (x.rows !== y.rows || x.digest !== y.digest) lines.push(`DIFFERS  ${name}  rows ${x.rows} vs ${y.rows}`);
  }
  if (a.migrations !== b.migrations) lines.push(`DIFFERS  migrations applied  ${a.migrations} vs ${b.migrations}`);
  return lines;
}

async function main() {
  loadEnv();
  const base = adminUrl();
  if (process.argv[2] === "--compare") {
    const [first, second] = [process.argv[3], process.argv[4]];
    if (!first || !second) throw new Error("Usage: npm run db:fingerprint -- --compare <database> <database>");
    const [a, b] = [await fingerprintOf(base, first), await fingerprintOf(base, second)];
    const lines = differences(a, b);
    for (const line of lines) console.log(line);
    console.log(`${Object.keys(a.tables).length} tables compared, ${lines.length} difference${lines.length === 1 ? "" : "s"}.`);
    console.log(`at a glance  ${a.database}: ${JSON.stringify(a.glance)}`);
    console.log(`at a glance  ${b.database}: ${JSON.stringify(b.glance)}`);
    process.exit(lines.length === 0 ? 0 : 1);
  }
  console.log(JSON.stringify(await fingerprintOf(base, process.argv[2] ?? databaseName(base)), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
