/**
 * npm run db:fingerprint -- [database]
 * npm run db:fingerprint -- --compare <database> <database>
 *
 * A digest of what a database HOLDS: for every table in the public schema, how many rows and an md5 of all of them (each row as text, in a
 * fixed order). Two databases with the same fingerprint hold the same data. A backup is only a backup once it has been restored somewhere and
 * shown to hold what the original held, and this is how that is shown: fingerprint the source, restore the dump into a clean database,
 * fingerprint that, compare.
 *
 * It also digests what protects the data, because a restore that brings every row back but loses a policy, a grant or a function's settings is not a
 * restore: for each kind of catalog object (columns, constraints, indexes, triggers, Row Level Security switches and policies, functions with their
 * SECURITY DEFINER flag, search_path, owner, privileges and a digest of their body, table and column privileges, sequences, enum types, extensions and
 * the applied migrations) a count and a digest, and, when two databases are compared, the lines that differ. Those lines describe the schema, never a row.
 *
 * Two things PostgreSQL prints differently for the same meaning are made the same first, or every restore would look like a difference: a privilege list that
 * was never set is the owner's defaults (`acldefault`), and a CHECK's expression is compared by what it says, not how deeply its ANDs are nested (constraint-text).
 *
 * Reads with the admin (owner) connection, which sees every row of every business (Row Level Security does not apply to it). It prints no row, no
 * value and no secret: table names, counts and digests.
 *
 *   one database    prints one JSON document (tables, counts at a glance, the sample businesses found, the number of migrations). Defaults to the
 *                   database DATABASE_ADMIN_URL names.
 *   --compare a b   prints what differs and exits 1 if anything does (a table missing on one side, or a different count or digest), 0 if the two match.
 */
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { canonicalConstraint } from "./constraint-text";
import { adminUrl, databaseName, loadEnv, waitForDatabase, withDatabase } from "./lib";

type TableDigest = { rows: number; digest: string };
type CatalogDigest = { items: number; digest: string };
type Fingerprint = {
  database: string;
  migrations: number | null;
  demoOrganizations: string[];
  glance: Record<string, number | null>;
  tables: Record<string, TableDigest>;
  catalog: Record<string, CatalogDigest>;
  /** The lines each catalog digest is made of (kept for a comparison; never printed for a single database). */
  catalogLines: Record<string, string[]>;
};

/** Each kind of catalog object, as one line per object. Every statement reads only the system catalogs of the public schema (and the migration journal). */
const CATALOG: Record<string, string> = {
  columns: `select format('%s.%s %s %s default=%s%s', c.table_name, c.column_name, c.udt_name || coalesce('(' || c.character_maximum_length || ')', ''), case c.is_nullable when 'YES' then 'null' else 'not null' end, coalesce(c.column_default, ''), case when c.is_generated = 'ALWAYS' then ' generated=' || coalesce(c.generation_expression, '') else '' end) from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE' where c.table_schema = 'public'`,
  constraints: `select format('%s %s %s', conrelid::regclass, conname, contype) || E'\t' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace`,
  indexes: `select format('%s %s', tablename, indexdef) from pg_indexes where schemaname = 'public'`,
  triggers: `select format('%s %s', tgrelid::regclass, pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`,
  rowSecurity: `select format('%s rls=%s forced=%s', relname, relrowsecurity, relforcerowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')`,
  policies: `select format('%s %s %s %s roles=%s using=%s check=%s', tablename, policyname, permissive, cmd, roles, coalesce(qual, ''), coalesce(with_check, '')) from pg_policies where schemaname = 'public'`,
  functions: `select format('%s secdef=%s volatility=%s kind=%s settings=%s acl=%s owner=%s body=%s', p.oid::regprocedure, p.prosecdef, p.provolatile, p.prokind, coalesce(p.proconfig::text, ''), coalesce(coalesce(p.proacl, acldefault('f', p.proowner))::text, ''), pg_get_userbyid(p.proowner), md5(p.prosrc)) from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  tablePrivileges: `select format('%s acl=%s', relname, coalesce(relacl, acldefault(case when relkind = 'S' then 's'::"char" else 'r'::"char" end, relowner))::text) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm', 'S')`,
  columnPrivileges: `select format('%s.%s %s', c.relname, a.attname, a.attacl::text) from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped`,
  schemaPrivileges: `select format('%s %s', nspname, coalesce(nspacl, acldefault('n', nspowner))::text) from pg_namespace where nspname in ('public', 'drizzle')`,
  defaultPrivileges: `select format('%s %s %s', defaclrole::regrole, defaclobjtype, defaclacl::text) from pg_default_acl`,
  sequences: `select format('%s %s start=%s increment=%s min=%s max=%s cycle=%s', sequencename, data_type, start_value, increment_by, min_value, max_value, cycle) from pg_sequences where schemaname = 'public'`,
  enums: `select format('%s %s', t.typname, coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'`,
  views: `select format('%s %s', viewname, definition) from pg_views where schemaname = 'public'`,
  extensions: `select format('%s %s', extname, extversion) from pg_extension`,
  migrations: `select format('%s %s', created_at, hash) from drizzle.__drizzle_migrations`,
};

async function catalogOf(pool: Pool): Promise<{ catalog: Record<string, CatalogDigest>; catalogLines: Record<string, string[]> }> {
  const catalog: Record<string, CatalogDigest> = {};
  const catalogLines: Record<string, string[]> = {};
  for (const [kind, statement] of Object.entries(CATALOG)) {
    // The journal does not exist in a database that was never migrated: that is an empty list, and the comparison says so.
    const found = await pool.query(statement).then((result) => result.rows.map((row) => String(Object.values(row)[0])), () => [] as string[]);
    // A CHECK constraint is compared by what it says (the line is `table name kind<TAB>definition`).
    const lines = (kind === "constraints" ? found.map((line) => line.replace(/^([^\t]*)\t([\s\S]*)$/, (_all, head: string, definition: string) => `${head} ${canonicalConstraint(definition)}`)) : found).sort();
    catalogLines[kind] = lines;
    catalog[kind] = { items: lines.length, digest: createHash("md5").update(lines.join("\n")).digest("hex") };
  }
  return { catalog, catalogLines };
}

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
      ...(await catalogOf(pool)),
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
  for (const kind of Object.keys(CATALOG)) {
    if (a.catalog[kind].digest === b.catalog[kind].digest) continue;
    lines.push(`DIFFERS  catalog:${kind}  ${a.catalog[kind].items} vs ${b.catalog[kind].items} items`);
    const inA = new Set(a.catalogLines[kind]);
    const inB = new Set(b.catalogLines[kind]);
    for (const line of a.catalogLines[kind].filter((item) => !inB.has(item)).slice(0, 6)) lines.push(`         only in ${a.database}: ${line.slice(0, 200)}`);
    for (const line of b.catalogLines[kind].filter((item) => !inA.has(item)).slice(0, 6)) lines.push(`         only in ${b.database}: ${line.slice(0, 200)}`);
  }
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
    const kinds = Object.keys(CATALOG).length;
    const differing = lines.filter((line) => line.startsWith("DIFFERS") || line.startsWith("MISSING")).length;
    console.log(`${Object.keys(a.tables).length} tables and ${kinds} kinds of catalog object compared, ${differing} difference${differing === 1 ? "" : "s"}.`);
    console.log(`at a glance  ${a.database}: ${JSON.stringify(a.glance)}`);
    console.log(`at a glance  ${b.database}: ${JSON.stringify(b.glance)}`);
    process.exit(differing === 0 ? 0 : 1);
  }
  const fingerprint = await fingerprintOf(base, process.argv[2] ?? databaseName(base));
  // The lines a catalog digest is made of are for a comparison; one database prints only its counts and digests.
  console.log(JSON.stringify(fingerprint, (key, value) => (key === "catalogLines" ? undefined : value), 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
