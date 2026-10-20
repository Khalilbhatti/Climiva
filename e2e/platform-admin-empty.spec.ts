/**
 * Phase 19A, a platform with nothing on it: a database that was only migrated (no seed), served by a second application server. This is what
 * production looks like on its first day. Nothing creates an administrator by itself; the first account is an ordinary one; and once an
 * administrator is granted by the command-line tool, every console page shows a valid, plain zero state with no fabricated figure.
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { expect, request, test, type APIRequestContext } from "playwright/test";
import { adminDb, adminUrl, appUrl, migrateDatabase, recreateDatabase, requireEnv } from "../scripts/db/lib";
import { ensureMembership } from "../scripts/db/seed-lib";
import { startServer } from "./assets-helpers";
import { CONSOLE_PATHS, runTool } from "./platform-admin-helpers";

const PASSWORD = "Correct-horse-9-battery";
/** Each worker has a database and a server port of its own, so repeated or parallel runs of this file never share either. */
let DATABASE = "climvia_p19_empty";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let server: { origin: string; stop: () => void };
let owner: ReturnType<typeof adminDb>;
let admin: { email: string; userId: string };
let api: APIRequestContext;

/** What a person reads on the page: the markup and the framework's data script taken away. */
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const toolEnv = () => ({ DATABASE_ADMIN_URL: adminUrl(DATABASE), DATABASE_URL: appUrl(DATABASE) });
const rows = async (sql: string) => (await owner.pool.query(sql)).rows;

test.beforeAll(async ({}, testInfo) => {
  DATABASE = `climvia_p19_empty_w${testInfo.workerIndex}`;
  await recreateDatabase(DATABASE);
  await migrateDatabase(adminUrl(DATABASE), requireEnv("POSTGRES_APP_PASSWORD"));
  owner = adminDb(adminUrl(DATABASE));
  server = await startServer(3560 + (testInfo.workerIndex % 30), { DATABASE_URL: appUrl(DATABASE), DATABASE_ADMIN_URL: adminUrl(DATABASE) }, "/platform-admin/login");
});

test.afterAll(async () => {
  await api?.dispose();
  server?.stop();
  await owner?.pool.end();
  const maintenance = new Pool({ connectionString: adminUrl("postgres"), max: 1 });
  try {
    await maintenance.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
  } finally {
    await maintenance.end();
  }
});

test("a migrated database has no administrator, no audit entry and no data of any kind", async () => {
  for (const table of ["platform_admins", "platform_listing_moderation", "platform_audit_events", "organizations", "auth_user", "marketplace_listings", "reviews", "bookings"]) {
    expect((await rows(`select count(*)::int as n from ${table}`))[0].n, table).toBe(0);
  }
  // Nothing in the migrations named a person: no address in the only place an administrator could have been written.
  expect((await rows("select count(*)::int as n from platform_admins"))[0].n).toBe(0);
  const listed = runTool("list", [], toolEnv());
  expect(listed.code, listed.stderr).toBe(0);
  expect(listed.stdout).toContain("There is no platform administrator.");
});

test("the console is closed to everyone on a platform that has no administrator, and the first account to sign up is an ordinary one", async () => {
  api = await request.newContext({ baseURL: server.origin, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { origin: server.origin, "x-forwarded-for": `fd00:${randomBytes(2).toString("hex")}:1::1` } });
  // Anonymous.
  for (const path of CONSOLE_PATHS) {
    const response = await api.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location).toContain("/platform-admin/login");
  }
  // The first person ever to sign up.
  admin = { email: `first-${randomBytes(4).toString("hex")}@example.test`, userId: "" };
  const signup = await api.post("/api/auth/sign-up/email", { data: { email: admin.email, password: PASSWORD, name: "First Person", role: "super_admin", platformAdmin: true } });
  expect(signup.ok(), await signup.text()).toBe(true);
  admin.userId = (await rows(`select id from auth_user where email = '${admin.email}'`))[0].id;
  expect((await rows("select count(*)::int as n from platform_admins"))[0].n).toBe(0);
  for (const path of CONSOLE_PATHS) expect((await api.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
});

test("the tool grants that existing person; the new authority works on their next request", async () => {
  const unknown = runTool("grant", ["--email", "nobody@example.test"], toolEnv());
  expect(unknown.code).toBe(1);
  expect((await rows("select count(*)::int as n from auth_user"))[0].n).toBe(1);

  const granted = runTool("grant", ["--email", admin.email], toolEnv());
  expect(granted.code, granted.stderr).toBe(0);
  const listed = runTool("list", [], toolEnv());
  expect(listed.stdout).toContain(admin.email);
  expect((await rows("select action, actor_kind from platform_audit_events"))).toEqual([{ action: "platform_admin.granted", actor_kind: "cli" }]);
  for (const path of CONSOLE_PATHS) expect((await api.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
});

test("every page is a valid zero state: no business, no listing, no review, and no invented figure", async () => {
  const text = async (path: string) => {
    const response = await api.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    return visibleText(await response.text());
  };
  const overview = await text("/platform-admin");
  expect(overview).toContain("No business has signed up yet");
  // Eleven counts: one user (the administrator), nothing else.
  const figures = [...(await (await api.get("/platform-admin")).text()).matchAll(/text-3xl[^>]*>(\d[\d,]*)</g)].map((match) => Number(match[1].replace(/,/g, "")));
  expect(figures).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(overview).not.toMatch(/NaN|undefined|null|Infinity|\+\d+%/);

  expect(await text("/platform-admin/organizations")).toContain("No organizations yet");
  expect(await text("/platform-admin/marketplace")).toContain("No Marketplace listings yet");
  expect(await text("/platform-admin/reviews")).toContain("No reviews yet");
  const users = await text("/platform-admin/users");
  expect(users).toContain(admin.email);
  expect(users).toContain("Super administrator");
  expect(users).toContain("No business");
  const system = await text("/platform-admin/system");
  expect(system).toMatch(/PostgreSQL \d/);
  expect(system).toMatch(/Migrations applied \d+/);
  expect(system).toContain("Platform administrator granted");
  expect(system).not.toMatch(/NaN|undefined|null/);
  // Searches that find nothing are empty states too, never errors.
  for (const path of ["/platform-admin/organizations?q=x", "/platform-admin/users?q=nobody-at-all", "/platform-admin/marketplace?q=x", "/platform-admin/reviews?q=x&rating=5", "/platform-admin/organizations?page=7"]) {
    expect((await api.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  // An organization that does not exist.
  expect((await api.get("/platform-admin/organizations/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 })).status()).toBe(404);
});

test("the figures are exactly the data: three businesses, one membership, two listings, one published", async () => {
  const ids: string[] = [];
  for (const [index, name] of ["Alpha Heating", "Bravo Cooling", "Charlie Air"].entries()) {
    const inserted = await owner.pool.query("insert into organizations (name, slug, timezone) values ($1, $2, 'America/Denver') returning id", [name, `p19-empty-${index}`]);
    ids.push(inserted.rows[0].id);
  }
  await ensureMembership(owner.db, { organizationId: ids[0], userId: admin.userId, role: "owner" });
  await owner.pool.query("insert into marketplace_listings (organization_id, public_slug, status, description, published_at) values ($1, 'alpha-heating', 'published', 'Alpha', now()), ($2, 'bravo-cooling', 'hidden', 'Bravo', now())", [ids[0], ids[1]]);

  const html = await (await api.get("/platform-admin")).text();
  const figures = [...html.matchAll(/text-3xl[^>]*>(\d[\d,]*)</g)].map((match) => Number(match[1].replace(/,/g, "")));
  // Organizations, Users, Active memberships, Sites, Published sites, Marketplace listings, Published listings, Suspended listings, Review requests waiting, Bookings, Reviews.
  expect(figures).toEqual([3, 1, 1, 0, 0, 2, 1, 0, 0, 0, 0]);
  expect(html).not.toContain("No business has signed up yet");

  const organizations = visibleText(await (await api.get("/platform-admin/organizations")).text());
  for (const name of ["Alpha Heating", "Bravo Cooling", "Charlie Air"]) expect(organizations).toContain(name);
  expect(organizations).toContain("Showing 1–3 of 3");
  const marketplace = visibleText(await (await api.get("/platform-admin/marketplace")).text());
  expect(marketplace).toContain("Showing 1–2 of 2");
  expect(marketplace).toContain("alpha-heating");
});

test("revoking the last administrator closes the console again, keeps the account, and the tool says there is none", async () => {
  const revoked = runTool("revoke", ["--email", admin.email], toolEnv());
  expect(revoked.code, revoked.stderr).toBe(0);
  expect(revoked.stdout).toContain("there is no platform administrator now");
  expect((await rows(`select count(*)::int as n from auth_user where id = '${admin.userId}'`))[0].n).toBe(1);
  expect((await rows(`select count(*)::int as n from organization_memberships where user_id = '${admin.userId}'`))[0].n).toBe(1);
  for (const path of CONSOLE_PATHS) expect((await api.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  expect((await rows("select action from platform_audit_events order by occurred_at, id")).map((row) => row.action)).toEqual(["platform_admin.granted", "platform_admin.revoked"]);
});
