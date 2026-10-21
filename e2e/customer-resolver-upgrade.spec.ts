/**
 * Phase 19E correction, migration 0031 (harden customer resolution): it applies from zero, it upgrades a database that is at the migration before it
 * with its data untouched, a second migrate changes nothing, and the upgraded database is catalog-for-catalog the one built from zero.
 *
 * "The migration before it" is made from the migrations in this repository: the same folder with the journal cut off before 0031, so the database really is at
 * the state Phase 19E first shipped (31 migrations), with a resolver that still treated a household's shared phone as one person.
 *
 * Each worker has databases of its own (named by its index), so repetitions and workers that run together never touch one another's.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { expect, test } from "playwright/test";
import { adminUrl, migrateDatabase, provisionRuntimeRole, recreateDatabase, requireEnv, withDatabase } from "../scripts/db/lib";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const TARGET = "0031_harden_customer_resolution";
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
const BEFORE = journal.entries.findIndex((entry) => entry.tag === TARGET);

let OLD = "";
let FRESH = "";
let previous = "";
let maintenance: Pool;

const as = async <T>(database: string, work: (pool: Pool) => Promise<T>): Promise<T> => {
  const pool = new Pool({ connectionString: withDatabase(adminUrl(), database), max: 1 });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
};
const one = async (database: string, statement: string, values: unknown[] = []) => (await as(database, (pool) => pool.query(statement, values))).rows[0] as Record<string, string>;

/** Apply the migrations of `folder` that the database has not had (provisioning the runtime role first, as the real migrate does). */
async function migrateWith(database: string, folder: string) {
  const pool = new Pool({ connectionString: withDatabase(adminUrl(), database), max: 1 });
  try {
    await provisionRuntimeRole(pool, requireEnv("POSTGRES_APP_PASSWORD"));
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

const RESOLVER = "app_resolve_public_customer(uuid, text, text, text)";
const resolverState = async (database: string) =>
  one(database, `select md5(pg_get_functiondef('${RESOLVER}'::regprocedure)) as body, coalesce(proacl::text, '') as acl, prosecdef::text as secdef, coalesce(proconfig::text, '') as config from pg_proc where oid = '${RESOLVER}'::regprocedure`);
const journalState = async (database: string) => one(database, "select count(*)::text as n, md5(string_agg(created_at::text || hash, ',' order by created_at)) as digest from drizzle.__drizzle_migrations");

/** Ask the resolver as the owner, in a transaction that is rolled back, and say whether it made a customer. */
async function resolve(database: string, org: string, who: { name: string; phone: string; email: string }) {
  return as(database, async (pool) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const before = Number((await client.query("select count(*)::int as n from customers where organization_id = $1", [org])).rows[0].n);
      const answer = (await client.query<{ id: string | null }>("select app_resolve_public_customer($1, $2, $3, $4) as id", [org, who.name, who.phone, who.email])).rows[0].id;
      const after = Number((await client.query("select count(*)::int as n from customers where organization_id = $1", [org])).rows[0].n);
      return { id: answer, made: after - before };
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
}

function compare(): { code: number; out: string } {
  const result = spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("scripts", "db", "fingerprint.ts"), "--compare", OLD, FRESH], { encoding: "utf8", env: { ...process.env, DB_WAIT_SECONDS: "10" } });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test.beforeAll(async ({}, testInfo) => {
  OLD = `climvia_up_w${testInfo.parallelIndex}_old`;
  FRESH = `climvia_up_w${testInfo.parallelIndex}_new`;
  expect(BEFORE, "the journal names 0031").toBeGreaterThan(0);
  maintenance = new Pool({ connectionString: adminUrl("postgres"), max: 1 });
  // The folder as it was before 0031: every file, and a journal that stops short of it.
  previous = mkdtempSync(join(tmpdir(), "climvia-migrations-before-0031-"));
  cpSync("drizzle", previous, { recursive: true });
  writeFileSync(join(previous, "meta", "_journal.json"), JSON.stringify({ ...JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")), entries: journal.entries.slice(0, BEFORE) }, null, 2));
});
test.afterAll(async () => {
  await maintenance.query(`DROP DATABASE IF EXISTS "${OLD}" WITH (FORCE)`);
  await maintenance.query(`DROP DATABASE IF EXISTS "${FRESH}" WITH (FORCE)`);
  await maintenance.end();
  rmSync(previous, { recursive: true, force: true });
});

const ORG = "0e6c3a52-7a1b-4d5f-9d77-2a4b1c0c9e77";
const HOUSEHOLD = { name: "John Home", phone: "(555) 010-5000", email: "john@example.test" };

test("from zero: every migration applies, and a second migrate changes nothing", async () => {
  await recreateDatabase(FRESH);
  await migrateDatabase(withDatabase(adminUrl(), FRESH), requireEnv("POSTGRES_APP_PASSWORD"));
  const first = await journalState(FRESH);
  expect(Number(first.n)).toBe(journal.entries.length);
  const body = await resolverState(FRESH);
  await migrateDatabase(withDatabase(adminUrl(), FRESH), requireEnv("POSTGRES_APP_PASSWORD"));
  expect(await journalState(FRESH)).toEqual(first);
  expect(await resolverState(FRESH)).toEqual(body);
});

test("a database at the migration before 0031 has a business with customers, and the old resolver treats a household's phone as one person", async () => {
  await recreateDatabase(OLD);
  await migrateWith(OLD, previous);
  expect(Number((await journalState(OLD)).n)).toBe(BEFORE);
  await as(OLD, async (pool) => {
    await pool.query("insert into organizations (id, name, slug, timezone, created_at, updated_at) values ($1, 'Upgrade Co', 'upgrade-co', 'America/Chicago', '2030-01-01', '2030-01-01')", [ORG]);
    await pool.query(
      `insert into customers (organization_id, slug, name, phone, email, created_at, updated_at) values
         ($1, 'mary-home', 'Mary Home', '(555) 010-5000', 'mary@example.test', '2030-01-02', '2030-01-02'),
         ($1, 'alice-adams', 'Alice Adams', '(555) 010-0001', 'alice@example.test', '2030-01-03', '2030-01-03'),
         ($1, 'bob-brown', 'Bob Brown', '(555) 010-0002', 'bob@example.test', '2030-01-04', '2030-01-04')`,
      [ORG],
    );
  });
  const mary = (await one(OLD, "select id from customers where slug = 'mary-home'")).id;
  // The behaviour 0031 replaces: John's email is nobody's, the phone is Mary's alone, so he was taken for her.
  expect(await resolve(OLD, ORG, HOUSEHOLD)).toEqual({ id: mary, made: 0 });
});

test("0031 upgrades it: the data is untouched, the resolver's privileges are what they were, and the household is now two people", async () => {
  const customersBefore = (await one(OLD, "select md5(string_agg(id::text || slug || name || coalesce(phone, '') || coalesce(email, '') || coalesce(email_key, '') || coalesce(phone_key, ''), ',' order by position)) as digest, count(*)::text as n from customers"));
  const before = await resolverState(OLD);
  expect(before.acl).not.toMatch(/climvia_app|^=/);

  await migrateDatabase(withDatabase(adminUrl(), OLD), requireEnv("POSTGRES_APP_PASSWORD"));

  expect(Number((await journalState(OLD)).n)).toBe(journal.entries.length);
  expect(await one(OLD, "select md5(string_agg(id::text || slug || name || coalesce(phone, '') || coalesce(email, '') || coalesce(email_key, '') || coalesce(phone_key, ''), ',' order by position)) as digest, count(*)::text as n from customers")).toEqual(customersBefore);
  const after = await resolverState(OLD);
  expect(after.body).not.toBe(before.body);
  expect({ acl: after.acl, secdef: after.secdef, config: after.config }).toEqual({ acl: before.acl, secdef: before.secdef, config: before.config });

  const mary = (await one(OLD, "select id from customers where slug = 'mary-home'")).id;
  const alice = (await one(OLD, "select id from customers where slug = 'alice-adams'")).id;
  // John, on Mary's phone with an email nobody has: a customer of his own.
  const john = await resolve(OLD, ORG, HOUSEHOLD);
  expect(john.made).toBe(1);
  expect(john.id).not.toBe(mary);
  // Mary herself, a changed phone on her email, and a conflict (Alice's email, Bob's phone) behave as the rule says.
  expect(await resolve(OLD, ORG, { name: "Mary Home", phone: "(555) 010-5000", email: "MARY@example.test" })).toEqual({ id: mary, made: 0 });
  expect(await resolve(OLD, ORG, { name: "Mary Home", phone: "(555) 010-9999", email: "mary@example.test" })).toEqual({ id: mary, made: 0 });
  const conflict = await resolve(OLD, ORG, { name: "Alice Adams", phone: "(555) 010-0002", email: "alice@example.test" });
  expect(conflict.made).toBe(1);
  expect(conflict.id).not.toBe(alice);
});

test("a second migrate changes nothing, and the upgraded database is the one built from zero, object for object", async () => {
  const state = { journal: await journalState(OLD), resolver: await resolverState(OLD) };
  await migrateDatabase(withDatabase(adminUrl(), OLD), requireEnv("POSTGRES_APP_PASSWORD"));
  expect({ journal: await journalState(OLD), resolver: await resolverState(OLD) }).toEqual(state);

  // Take the fixture away (its customers go with the organization) and the two databases compare equal on every table and every protecting object.
  await as(OLD, (pool) => pool.query("delete from organizations where id = $1", [ORG]));
  // The one thing two databases migrated separately never share: the product's own Website Templates are written with a random id and the migration's clock.
  // Both are given the same ones (the key is what identifies a Template), so what is compared is what the migrations made.
  for (const database of [OLD, FRESH]) {
    await as(database, async (pool) => {
      // (A trigger keeps updated_at current, so it is switched off for the one statement and back on.)
      await pool.query("alter table site_templates disable trigger site_templates_set_updated_at");
      await pool.query("update site_templates set id = md5(key)::uuid, created_at = '2030-01-01', updated_at = '2030-01-01'");
      await pool.query("alter table site_templates enable trigger site_templates_set_updated_at");
    });
  }
  const result = compare();
  expect(result.code, result.out).toBe(0);
  expect(result.out).toMatch(/\d+ tables and 16 kinds of catalog object compared, 0 differences\./);
});
