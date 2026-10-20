/**
 * Docker side, part 8: a backup of the CURRENT schema (every migration, including the Phase 19 tables) is taken from the running stack, restored into a clean
 * isolated database, and PROVED to be the same database. A successful `pg_restore` is not that proof, so:
 *
 *   - the dump is made by the operator's own script, is checksummed, holds no review secret and no password, and holds the hash that stands in for a secret;
 *   - the restore is made by the operator's own script, into a database that did not exist;
 *   - every table (rows and digest) AND every object that protects the data (functions with their SECURITY DEFINER flag, search_path and privileges, Row Level
 *     Security switches and policies, table and column privileges, constraints, indexes, triggers, the migration journal) compares equal to the source's;
 *   - and the restored database BEHAVES like the source, asked as the application's own restricted role from inside the real application container: a person
 *     with no context sees nothing, a business sees only its own rows and another business's id sees none, a write into another business is refused, the
 *     platform's tables and functions refuse an ordinary account and a revoked administrator, the public functions answer with the public projection
 *     only, a review link made before the backup still opens (the hash survived) and a used one is still used, and the next booking number continues.
 *
 * It needs what 02, 05 and 07 left: a business with a published listing, bookings with Marketplace attribution, reviews (one public, one private), review
 * requests (two used, one open), a hidden-then-restored review, a suspension that was answered, and an administrator who was granted and revoked.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { expect, test } from "playwright/test";
import { PASSWORD } from "../e2e/saas";
import { compose, composeResult, one, sql, stack } from "./stack";

test.describe.configure({ mode: "serial", timeout: 600_000 });

const DRILL = "climvia_release_drill";
const BACKUPS = ".data/release-backups";
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const secretOf = (link: string) => link.split("/").pop() ?? "";

let release: { listingId: string; listingSlug: string; adminEmail: string; usedLinks: string[]; activeLink: string };
let state: { email: string; business: string; slug: string };
let dumpFile = "";

function script(name: string, ...args: string[]) {
  const result = spawnSync("bash", [`deploy/scripts/${name}`, ...args], { encoding: "utf8", env: { ...process.env, ENV_FILE: stack.envFile }, maxBuffer: 64 * 1024 * 1024, timeout: 570_000 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const dropDrill = () => compose("exec", "-T", "db", "psql", "-U", stack.env.POSTGRES_OWNER_USER ?? "climvia_owner", "-d", "postgres", "-c", `drop database if exists "${DRILL}" with (force)`);

test.beforeAll(() => {
  release = JSON.parse(readFileSync(".data/docker-release.json", "utf8"));
  state = JSON.parse(readFileSync(".data/docker-state.json", "utf8"));
  mkdirSync(BACKUPS, { recursive: true });
  dropDrill();
});
test.afterAll(() => {
  dropDrill();
  rmSync(BACKUPS, { recursive: true, force: true });
});

test("the data to protect is representative: every Phase 19 table holds something, from a business that did what a business does", async () => {
  const count = (table: string) => Number(one(`select count(*) from ${table}`));
  for (const table of ["organizations", "organization_memberships", "sites", "services", "customers", "bookings", "marketplace_listings", "marketplace_service_areas", "marketplace_listing_services", "reviews", "review_requests", "platform_admins", "platform_audit_events", "platform_listing_moderation", "platform_review_moderation", "assets", "site_domains"]) {
    expect(count(table), table).toBeGreaterThan(0);
  }
  expect(sql("select visibility from reviews order by visibility")).toEqual([["private"], ["public"]]);
  expect(sql("select status from review_requests order by status")).toEqual([["completed"], ["completed"], ["recorded"]]);
  expect(Number(one("select count(*) from review_requests where token_hash ~ '^[0-9a-f]{64}$'"))).toBe(3);
  expect(Number(one("select count(*) from bookings where source = 'Marketplace' and marketplace_listing_id is not null and discovery_service is not null"))).toBeGreaterThan(0);
  expect(sql("select state from platform_review_moderation")).toEqual([["visible"]]);
  expect(sql("select state, review_state, review_outcome from platform_listing_moderation")).toEqual([["allowed", "resolved", "lifted"]]);
  // Two people were granted and revoked on this stack (05's and 07's): both rows are kept, and both are revoked.
  expect(Number(one("select count(*) from platform_admins where revoked_at is null"))).toBe(0);
  expect(Number(one("select count(*) from platform_admins where revoked_at is not null"))).toBeGreaterThanOrEqual(1);
  expect(Number(one("select count(*) from drizzle.__drizzle_migrations"))).toBe(journal.entries.length);
});

test("the operator's backup script writes a checksummed dump of the current schema, and the dump holds no review secret and no password", async () => {
  const made = script("backup.sh", BACKUPS);
  expect(made.code, made.out).toBe(0);
  // The script prints the path as its own shell writes it (/c/dev/... on Windows); the file is in the directory it was asked to write to.
  const printed = made.out.match(/^ {3}file {5}(.+)$/m)?.[1]?.trim() ?? "";
  expect(printed).toMatch(/\.dump$/);
  dumpFile = `${BACKUPS}/${basename(printed)}`;
  const meta = readFileSync(`${dumpFile}.meta`, "utf8");
  expect(meta).toContain(`migrations_applied=${journal.entries.length}`);
  expect(meta).toContain(`database=${stack.env.POSTGRES_DB ?? "climvia"}`);
  expect(readFileSync(`${dumpFile}.sha256`, "utf8").split(" ")[0]).toBe(createHash("sha256").update(readFileSync(dumpFile)).digest("hex"));

  // The same database in plain SQL: every secret a person was ever shown is absent, and what stands in for it is present.
  const plain = execFileSync("docker", ["compose", "-f", stack.composeFile, "--env-file", stack.envFile, "exec", "-T", "db", "pg_dump", "-U", stack.env.POSTGRES_OWNER_USER ?? "climvia_owner", "-d", stack.env.POSTGRES_DB ?? "climvia", "--format=plain"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  for (const link of [...release.usedLinks, release.activeLink]) {
    expect(plain, "a review link's secret").not.toContain(secretOf(link));
    expect(plain, "its SHA-256").toContain(sha256(secretOf(link)));
  }
  expect(plain, "a password in the clear").not.toContain(PASSWORD);
  for (const name of ["BETTER_AUTH_SECRET", "TLS_ASK_TOKEN", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD"]) {
    const value = stack.env[name];
    if (value) expect(plain, name).not.toContain(value);
  }
});

test("the operator's restore script brings the dump back into a database that did not exist, and refuses to restore over one that holds data", async () => {
  const restored = script("restore.sh", dumpFile, "--into", DRILL);
  expect(restored.code, restored.out).toBe(0);
  expect(restored.out).toContain(`database ${DRILL}`);
  // A second restore into the same name is refused: a restore never overwrites.
  const again = script("restore.sh", dumpFile, "--into", DRILL);
  expect(again.code).not.toBe(0);
  expect(again.out).toMatch(/already holds \d+ tables; a restore never overwrites/);
});

test("every table and every protecting object of the restored database compares equal to the source", async () => {
  const compared = composeResult("run", "--rm", "migrate", "npm", "run", "--silent", "db:fingerprint", "--", "--compare", stack.env.POSTGRES_DB ?? "climvia", DRILL);
  expect(compared.code, compared.out).toBe(0);
  expect(compared.out).toMatch(/\d+ tables and 16 kinds of catalog object compared, 0 differences\./);
  const tables = Number(compared.out.match(/(\d+) tables/)?.[1]);
  expect(tables).toBeGreaterThanOrEqual(55);
  // The comparison can tell: change one thing in the restored copy and it says so (then change it back).
  const owner = stack.env.POSTGRES_OWNER_USER ?? "climvia_owner";
  const psql = (statement: string) => compose("exec", "-T", "db", "psql", "-U", owner, "-d", DRILL, "-v", "ON_ERROR_STOP=1", "-c", statement);
  psql("revoke execute on function app_public_review_request(text) from climvia_app");
  const broken = composeResult("run", "--rm", "migrate", "npm", "run", "--silent", "db:fingerprint", "--", "--compare", stack.env.POSTGRES_DB ?? "climvia", DRILL);
  expect(broken.code).toBe(1);
  expect(broken.out).toMatch(/catalog:functions[\s\S]*app_public_review_request/);
  psql("grant execute on function app_public_review_request(text) to climvia_app");
  const healed = composeResult("run", "--rm", "migrate", "npm", "run", "--silent", "db:fingerprint", "--", "--compare", stack.env.POSTGRES_DB ?? "climvia", DRILL);
  expect(healed.code, healed.out).toBe(0);
});

/** What the application's own restricted role sees in a database, from inside the real application container. */
function probe(database: string, input: Record<string, unknown>): Record<string, unknown> {
  const code = `
    const { Pool } = require('pg');
    const input = JSON.parse(process.argv[1]);
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = '/' + input.database;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    async function q(ctx, statement, params) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [ctx.user || '', ctx.org || '']);
        const result = await client.query(statement, params || []);
        await client.query('rollback');
        return result.rows;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        return { error: error.code || 'error', message: String(error.message).slice(0, 80) };
      } finally {
        client.release();
      }
    }
    const n = (rows) => (Array.isArray(rows) ? Number(rows[0].n) : rows);
    (async () => {
      const none = {}, owner = { user: input.user, org: input.org }, stranger = { user: input.user, org: input.other };
      const out = {};
      for (const table of ['customers', 'bookings', 'reviews', 'review_requests', 'marketplace_listings', 'marketplace_service_areas', 'sites', 'services']) {
        out['none ' + table] = n(await q(none, 'select count(*)::int as n from ' + table));
        out['owner ' + table] = n(await q(owner, 'select count(*)::int as n from ' + table));
        out['stranger ' + table] = n(await q(stranger, 'select count(*)::int as n from ' + table));
      }
      const hours = async (ctx, org) => { const rows = await q(ctx, "update organization_business_hours set is_open = is_open where organization_id = $1 returning id", [org]); return Array.isArray(rows) ? rows.length : rows.error; };
      out['write to its own rows'] = await hours(owner, input.org);
      out['write across businesses'] = await hours(owner, input.other);
      const refused = await q(owner, "insert into organization_business_hours (organization_id, day_of_week, is_open) values ($1, 3, false) returning id", [input.other]);
      out['insert into another business'] = Array.isArray(refused) ? 'allowed' : refused.error;
      for (const table of ['platform_admins', 'platform_audit_events', 'platform_listing_moderation', 'platform_review_moderation']) out['table ' + table] = (await q(owner, 'select count(*)::int as n from ' + table)).error || 'readable';
      out['platform overview, ordinary account'] = (await q(owner, 'select app_platform_overview() as n')).error || 'answered';
      out['platform overview, revoked administrator'] = (await q({ user: input.revokedAdmin, org: '' }, 'select app_platform_overview() as n')).error || 'answered';
      out['platform listings, ordinary account'] = (await q(owner, "select app_platform_listings('', 10, 0) as n")).error || 'answered';
      out['public profile'] = (await q(none, 'select app_public_listing($1) as n', [input.slug]))[0].n;
      out['public sitemap'] = (await q(none, 'select app_public_marketplace_sitemap() as n'))[0].n;
      for (const [name, token] of Object.entries(input.tokens)) out['review link ' + name] = (await q(none, 'select app_public_review_request($1) as n', [token]))[0].n;
      out['review link, not a link'] = (await q(none, 'select app_public_review_request($1) as n', ['x'.repeat(43)]))[0].n;
      out['suspended'] = (await q(owner, 'select app_listing_suspended() as n'))[0].n;
      const numbers = await q(owner, "select app_next_number('booking') as n");
      out['next booking number'] = Array.isArray(numbers) ? Number(numbers[0].n) : numbers;
      console.log(JSON.stringify(out));
      await pool.end();
    })();`;
  const stdout = compose("exec", "-T", "app", "node", "-e", code, JSON.stringify({ ...input, database }));
  return JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "{}");
}

test("the restored database behaves as the source does, asked as the application's own restricted role: isolation, closed platform tables, public projections, review links", async () => {
  const ids = {
    user: one(`select id from auth_user where email = '${state.email}'`),
    org: one("select id from organizations limit 1"),
    other: "0e6c3a52-7a1b-4d5f-9d77-2a4b1c0c9e11",
    revokedAdmin: one(`select id from auth_user where email = '${release.adminEmail}'`),
    slug: release.listingSlug,
    tokens: { used: secretOf(release.usedLinks[0]), kept_private: secretOf(release.usedLinks[1]), open: secretOf(release.activeLink) },
  };
  const source = probe(stack.env.POSTGRES_DB ?? "climvia", ids);
  const restored = probe(DRILL, ids);
  // The restored database answers every question exactly as the source does.
  expect(restored).toEqual(source);

  // And what it answers is right, not merely the same.
  const expectCount = (name: string, expected: number) => expect(restored[name], name).toBe(expected);
  for (const table of ["customers", "bookings", "reviews", "review_requests", "marketplace_listings", "marketplace_service_areas", "sites", "services"]) {
    expect(restored[`none ${table}`], `no context: ${table}`).toBe(0);
    expect(restored[`stranger ${table}`], `another business's id: ${table}`).toBe(0);
    expect(Number(restored[`owner ${table}`]), `the business's own: ${table}`).toBeGreaterThan(0);
  }
  expectCount("owner reviews", 2);
  expectCount("owner review_requests", 3);
  expectCount("owner marketplace_listings", 1);
  expectCount("write to its own rows", 7);
  expectCount("write across businesses", 0);
  expect(restored["insert into another business"]).toBe("42501");
  for (const table of ["platform_admins", "platform_audit_events", "platform_listing_moderation", "platform_review_moderation"]) expect(restored[`table ${table}`], table).toBe("42501");
  for (const name of ["platform overview, ordinary account", "platform overview, revoked administrator", "platform listings, ordinary account"]) expect(restored[name], name).not.toBe("answered");
  expect(restored["suspended"]).toBe(false);

  const profile = JSON.stringify(restored["public profile"]);
  expect(profile).toContain("Showed up on time and tuned the furnace.");
  expect(profile).not.toContain("It took two visits.");
  expect(profile).not.toMatch(/organization_id|organizationId|token|INTERNAL/);
  expect(JSON.stringify(restored["public sitemap"])).toContain(release.listingSlug);
  const used = JSON.stringify(restored["review link used"]);
  const open = JSON.stringify(restored["review link open"]);
  expect(used).not.toEqual(open);
  expect(open).toContain(state.business);
  expect(JSON.stringify(restored["review link, not a link"])).not.toContain(state.business);
  expect(Number(restored["next booking number"])).toBeGreaterThan(0);
});

test("a platform administrator granted in the restored copy can use the platform functions: they are there, with their guard", async () => {
  const owner = stack.env.POSTGRES_OWNER_USER ?? "climvia_owner";
  const admin = one(`select id from auth_user where email = '${release.adminEmail}'`);
  compose("exec", "-T", "db", "psql", "-U", owner, "-d", DRILL, "-v", "ON_ERROR_STOP=1", "-c", `insert into platform_admins (user_id, role, granted_via, granted_by) values ('${admin}', 'super_admin', 'cli', 'cli:drill')`);
  const code = `
    const { Pool } = require('pg');
    const input = JSON.parse(process.argv[1]);
    const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + input.database;
    const pool = new Pool({ connectionString: url.toString(), max: 1 });
    (async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', '', true)", [input.admin]);
        const overview = (await client.query('select app_platform_overview() as n')).rows[0].n;
        const listings = (await client.query("select app_platform_listings('', 10, 0) as n")).rows[0].n;
        const reviews = (await client.query("select app_platform_reviews('', null, 10, 0, null) as n")).rows[0].n;
        await client.query('rollback');
        console.log(JSON.stringify({ overview, listings: JSON.stringify(listings).length > 2, reviews: JSON.stringify(reviews).length > 2 }));
      } finally { client.release(); await pool.end(); }
    })();`;
  const answer = JSON.parse(compose("exec", "-T", "app", "node", "-e", code, JSON.stringify({ database: DRILL, admin })).trim().split(/\r?\n/).pop() ?? "{}") as { overview: Record<string, number>; listings: boolean; reviews: boolean };
  expect(answer.listings).toBe(true);
  expect(answer.reviews).toBe(true);
  expect(Number(answer.overview.publicReviews)).toBe(1);
  expect(Number(answer.overview.hiddenReviews)).toBe(0);
});

test("the operator's one-command drill passes end to end, and leaves nothing behind", async () => {
  dropDrill();
  const drill = script("restore-drill.sh");
  expect(drill.code, drill.out).toBe(0);
  expect(drill.out).toContain("restore drill PASSED");
  expect(drill.out).toMatch(/0 differences\./);
  const left = sql("select datname from pg_database where datname like '%_drill'");
  expect(left).toEqual([]);
});
