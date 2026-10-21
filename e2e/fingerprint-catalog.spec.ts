/**
 * Phase 19D, the restore drill's comparison can FAIL: `db:fingerprint --compare` digests the rows of every table AND the objects that protect them (functions
 * with their SECURITY DEFINER flag, search_path and privileges, Row Level Security switches and policies, table and column privileges, constraints, indexes,
 * triggers, columns, the migration journal). Here one database is copied from a migrated one, so the two compare equal, and then one thing at a time is
 * changed in the copy; each change must be named by the comparison. A drill that could not tell would prove nothing.
 *
 * The copies are made from a template, so they are exact and quick; they are dropped at the end.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Pool } from "pg";
import { expect, test } from "playwright/test";
import { canonicalConstraint } from "../scripts/db/constraint-text";
import { adminUrl, migrateDatabase, recreateDatabase, requireEnv, withDatabase } from "../scripts/db/lib";

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.describe("a CHECK constraint is compared by what it says", () => {
  // The two spellings of one constraint that a restore produced in practice: nested ANDs in the original, one flat list in the copy.
  const nested = "CHECK ((((char_length(btrim(actor_label)) >= 1) AND (char_length(btrim(actor_label)) <= 200)) AND ((char_length(target_id) >= 1) AND (char_length(target_id) <= 200))))";
  const flat = "CHECK (((char_length(btrim(actor_label)) >= 1) AND (char_length(btrim(actor_label)) <= 200) AND ((char_length(target_id) >= 1) AND (char_length(target_id) <= 200))))";

  test("nesting and grouping that change nothing are not a difference", () => {
    expect(canonicalConstraint(nested)).toBe(canonicalConstraint(flat));
    expect(canonicalConstraint("CHECK ((a > 1))")).toBe(canonicalConstraint("CHECK (a > 1)"));
    expect(canonicalConstraint("CHECK  ((a > 1)\n AND  (b < 2))")).toBe(canonicalConstraint("CHECK (((a > 1) AND (b < 2)))"));
    expect(canonicalConstraint("CHECK (((a OR b) OR c))")).toBe(canonicalConstraint("CHECK ((a OR (b OR c)))"));
  });

  test("anything that changes the meaning is a difference: a constant, an operator, a column, AND for OR, the grouping of AND with OR, a NOT VALID", () => {
    const base = canonicalConstraint("CHECK (((a >= 1) AND (a <= 200)))");
    for (const changed of [
      "CHECK (((a >= 1) AND (a <= 201)))",
      "CHECK (((a >= 1) AND (a < 200)))",
      "CHECK (((b >= 1) AND (a <= 200)))",
      "CHECK (((a >= 1) OR (a <= 200)))",
      "CHECK (((a >= 1) AND (a <= 200))) NOT VALID",
      "CHECK ((a >= 1))",
    ]) expect(canonicalConstraint(changed), changed).not.toBe(base);
    expect(canonicalConstraint("CHECK (((a AND b) OR c))")).not.toBe(canonicalConstraint("CHECK ((a AND (b OR c)))"));
    // Text inside quotes is text: an AND in it is not a split.
    expect(canonicalConstraint("CHECK ((name <> 'this AND that'))")).toContain("'this AND that'");
    expect(canonicalConstraint("CHECK ((name <> 'this AND that'))")).not.toContain("AND[");
  });

  test("other kinds of constraint are only tidied", () => {
    expect(canonicalConstraint("FOREIGN KEY (organization_id, customer_id)   REFERENCES customers(organization_id, id)")).toBe("FOREIGN KEY (organization_id, customer_id) REFERENCES customers(organization_id, id)");
    expect(canonicalConstraint("UNIQUE (token_hash)")).toBe("UNIQUE (token_hash)");
  });
});

// The databases are this worker's own. Two repetitions of this file (or two workers) run at the same time, and a name they shared meant one dropping and re-creating
// the database the other was in the middle of comparing; a worker's index is the one thing that is different between those that run together.
let SOURCE = "";
let COPY = "";

let maintenance: Pool;
const asOwner = async <T>(database: string, work: (pool: Pool) => Promise<T>): Promise<T> => {
  const pool = new Pool({ connectionString: withDatabase(adminUrl(), database), max: 1 });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
};

function compare(): { code: number; out: string } {
  const result = spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("scripts", "db", "fingerprint.ts"), "--compare", SOURCE, COPY], { encoding: "utf8", env: { ...process.env, DB_WAIT_SECONDS: "10" }, timeout: 120_000 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function freshCopy() {
  await maintenance.query(`DROP DATABASE IF EXISTS "${COPY}" WITH (FORCE)`);
  await maintenance.query(`CREATE DATABASE "${COPY}" TEMPLATE "${SOURCE}"`);
}

test.beforeAll(async ({}, testInfo) => {
  SOURCE = `climvia_fp_w${testInfo.parallelIndex}_source`;
  COPY = `climvia_fp_w${testInfo.parallelIndex}_copy`;
  maintenance = new Pool({ connectionString: adminUrl("postgres"), max: 1 });
  await recreateDatabase(SOURCE);
  await migrateDatabase(withDatabase(adminUrl(), SOURCE), requireEnv("POSTGRES_APP_PASSWORD"));
  // Something to digest: an organization row, so a data change has a table to show up in.
  await asOwner(SOURCE, (pool) => pool.query("insert into organizations (name, slug, timezone) values ('Fingerprint Co', 'fingerprint-co', 'America/Chicago')").then(() => undefined, () => undefined));
  // A table whose privileges were set to exactly the owner's defaults: the way a restore may bring back a list that was spelled out.
  await asOwner(SOURCE, async (pool) => {
    await pool.query("create table acl_probe (id integer)");
    await pool.query("grant all on acl_probe to climvia_owner");
  });
});
test.afterAll(async () => {
  await maintenance.query(`DROP DATABASE IF EXISTS "${COPY}" WITH (FORCE)`);
  await maintenance.query(`DROP DATABASE IF EXISTS "${SOURCE}" WITH (FORCE)`);
  await maintenance.end();
});

test("an exact copy compares equal, and says how much it compared", async () => {
  await freshCopy();
  const same = compare();
  expect(same.code, same.out).toBe(0);
  expect(same.out).toMatch(/\d+ tables and 16 kinds of catalog object compared, 0 differences\./);
});

test("a privilege list that was spelled out as the owner's defaults and one that was never set are the same", async () => {
  await freshCopy();
  await asOwner(COPY, async (pool) => {
    await pool.query("drop table acl_probe");
    await pool.query("create table acl_probe (id integer)");
  });
  const spelled = await asOwner(SOURCE, (pool) => pool.query("select relacl is not null as set from pg_class where relname = 'acl_probe'"));
  const never = await asOwner(COPY, (pool) => pool.query("select relacl is null as unset from pg_class where relname = 'acl_probe'"));
  expect(spelled.rows[0].set).toBe(true);
  expect(never.rows[0].unset).toBe(true);
  const same = compare();
  expect(same.code, same.out).toBe(0);
});

/** One change to the copy, and what the comparison must call it. */
const CHANGES: { name: string; sql: string[]; names: RegExp }[] = [
  { name: "a function's privilege to the runtime role is revoked", sql: ["revoke execute on function app_public_review_request(text) from climvia_app"], names: /catalog:functions[\s\S]*app_public_review_request/ },
  { name: "a SECURITY DEFINER function becomes SECURITY INVOKER", sql: ["alter function app_public_review_request(text) security invoker"], names: /catalog:functions[\s\S]*secdef=f/ },
  { name: "a function's fixed search_path is dropped", sql: ["alter function app_public_review_request(text) reset search_path"], names: /catalog:functions/ },
  { name: "a function's body is changed", sql: ["create or replace function app_listing_suspended() returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select false $$"], names: /catalog:functions[\s\S]*app_listing_suspended/ },
  { name: "Row Level Security is switched off on a business table", sql: ["alter table customers disable row level security"], names: /catalog:rowSecurity[\s\S]*customers/ },
  { name: "Row Level Security is forced on a business table that does not force it", sql: ["alter table customers force row level security"], names: /catalog:rowSecurity[\s\S]*customers/ },
  { name: "a policy is dropped", sql: ["do $$ declare p text; begin select policyname into p from pg_policies where schemaname = 'public' and tablename = 'customers' and cmd = 'SELECT' limit 1; execute format('drop policy %I on customers', p); end $$"], names: /catalog:policies/ },
  { name: "a policy is widened to everyone", sql: ["do $$ declare p text; begin select policyname into p from pg_policies where schemaname = 'public' and tablename = 'customers' and cmd = 'SELECT' limit 1; execute format('alter policy %I on customers using (true)', p); end $$"], names: /catalog:policies/ },
  { name: "a table privilege of the runtime role is granted more widely", sql: ["grant delete on organizations to climvia_app"], names: /catalog:tablePrivileges[\s\S]*organizations/ },
  { name: "a column privilege of the runtime role is taken away", sql: ["do $$ declare r record; begin select c.relname, a.attname into r from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped limit 1; execute format('revoke all (%I) on %I from climvia_app', r.attname, r.relname); end $$"], names: /catalog:columnPrivileges/ },
  { name: "a column is added", sql: ["alter table customers add column fingerprint_probe integer"], names: /catalog:columns[\s\S]*fingerprint_probe/ },
  { name: "a CHECK constraint's meaning changes", sql: ["alter table sites drop constraint sites_platform_slug_format", "alter table sites add constraint sites_platform_slug_format check (char_length(platform_slug) <= 64)"], names: /catalog:constraints[\s\S]*sites_platform_slug_format/ },
  { name: "a function that was closed to everyone but the runtime role is opened to PUBLIC", sql: ["grant execute on function app_platform_overview() to public"], names: /catalog:functions[\s\S]*app_platform_overview/ },
  { name: "a constraint is dropped", sql: ["do $$ declare c text; begin select conname into c from pg_constraint where connamespace = 'public'::regnamespace and contype = 'c' limit 1; execute format('alter table %s drop constraint %I', (select conrelid::regclass from pg_constraint where conname = c limit 1), c); end $$"], names: /catalog:constraints/ },
  { name: "an index is dropped", sql: ["do $$ declare i text; begin select indexname into i from pg_indexes where schemaname = 'public' and indexname not like '%_pkey' and indexname not like '%_unique' limit 1; execute format('drop index %I', i); end $$"], names: /catalog:indexes/ },
  { name: "the migration journal differs", sql: ["update drizzle.__drizzle_migrations set hash = 'changed' where id = (select max(id) from drizzle.__drizzle_migrations)"], names: /catalog:migrations/ },
  { name: "a row differs", sql: ["update organizations set name = name || ' (changed)' where slug = 'fingerprint-co'"], names: /DIFFERS\s+organizations/ },
];

for (const change of CHANGES) {
  test(`${change.name}: the comparison fails and names it`, async () => {
    await freshCopy();
    await asOwner(COPY, async (pool) => {
      for (const statement of change.sql) await pool.query(statement);
    });
    const result = compare();
    expect(result.code, result.out).toBe(1);
    expect(result.out).toMatch(change.names);
    expect(result.out).toMatch(/[1-9]\d* differences?\./);
  });
}
