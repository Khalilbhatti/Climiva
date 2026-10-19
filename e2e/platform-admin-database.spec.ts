/**
 * Phase 19A, the database: who is a platform administrator, what the application's role can and cannot reach, what each platform function returns
 * and to whom, the moderation decision and its audit event, and the rule that the audit trail can never be edited.
 *
 * Everything here is SQL as the restricted runtime role (`climvia_app`, the one the application connects as) with a verified user id in
 * `app.user_id`, exactly as the server sets it, or as the owner where a test needs to look underneath. No browser.
 */
import { randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { makeBusiness } from "./assets-helpers";
import { insertActiveClaim } from "./domain-helpers";
import { grantPlatformAdmin, makeAccount, makeListing, makePlatformAdmin, revokePlatformAdmin } from "./platform-admin-helpers";

let owner: ReturnType<typeof adminDb>;
let app: Pool;
test.beforeAll(() => {
  owner = adminDb();
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
});
test.afterAll(async () => {
  await app.end();
  await owner.pool.end();
});

const TABLES = ["platform_admins", "platform_listing_moderation", "platform_audit_events"] as const;
const READERS = ["app_platform_overview()", "app_platform_organizations(null, 25, 0)", "app_platform_organization('00000000-0000-4000-8000-000000000000')", "app_platform_users(null, 25, 0)", "app_platform_listings(null, 25, 0)", "app_platform_reviews(null, null, 25, 0)", "app_platform_system()", "app_platform_audit_recent(20)"];

/** Run `work` as the runtime role with `userId` as the verified identity (or none), in one transaction that is rolled back unless `commit`. */
async function asUser<T>(userId: string | null, work: (client: PoolClient) => Promise<T>, options: { commit?: boolean; organizationId?: string } = {}): Promise<T> {
  const client = await app.connect();
  try {
    await client.query("begin");
    if (userId !== null) await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId, options.organizationId ?? ""]);
    const result = await work(client);
    await client.query(options.commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const one = async <T = unknown>(client: PoolClient, statement: string, values: unknown[] = []): Promise<T> => (await client.query(statement, values)).rows[0].data as T;
const refused = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: "42501" });

/* ───────────────────────────────── the tables ───────────────────────────────── */

test.describe("the platform tables belong to the platform, not to a business", () => {
  test("they hold no organization, have Row Level Security on and no policy, and the application's role has no privilege on them", async () => {
    const columns = await owner.pool.query("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1) and column_name = 'organization_id'", [TABLES]);
    expect(columns.rows).toEqual([]);
    const flags = await owner.pool.query<{ relname: string; relrowsecurity: boolean; relacl: string[] | null }>("select relname, relrowsecurity, relacl::text[] as relacl from pg_class where relname = any($1) order by relname", [TABLES]);
    expect(flags.rows.map((row) => row.relname)).toEqual([...TABLES].sort());
    for (const row of flags.rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      // No entry for PUBLIC (an ACL entry with an empty grantee reads "=r/owner") and none for the runtime role.
      expect((row.relacl ?? []).filter((entry) => entry.startsWith("=") || entry.startsWith("climvia_app=")), row.relname).toEqual([]);
    }
    expect((await owner.pool.query("select count(*)::int as n from pg_policies where tablename = any($1)", [TABLES])).rows[0].n).toBe(0);
    for (const table of TABLES) {
      for (const privilege of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
        expect((await owner.pool.query("select has_table_privilege('climvia_app', $1, $2) as allowed", [table, privilege])).rows[0].allowed, `${table} ${privilege}`).toBe(false);
      }
    }
  });

  test("the runtime role is refused when it tries the tables directly, even as a real administrator", async () => {
    const admin = await makePlatformAdmin("p19direct", owner.db, owner.pool);
    for (const user of [null, admin.userId]) {
      for (const statement of ["select * from platform_admins", "select * from platform_listing_moderation", "select * from platform_audit_events", "insert into platform_admins (user_id, granted_via, granted_by) values ('x', 'cli', 'x')", "update platform_admins set revoked_at = now()", "delete from platform_audit_events", "truncate platform_audit_events"]) {
        await refused(asUser(user, (client) => client.query(statement)));
      }
    }
  });

  test("a mistaken GRANT would still read nothing: with no policy, Row Level Security returns no row to any role but the owner", async () => {
    const admin = await makePlatformAdmin("p19grant", owner.db, owner.pool);
    const client = await owner.pool.connect();
    try {
      await client.query("begin");
      await client.query("create role climvia_p19_probe nologin");
      await client.query("grant select on platform_admins, platform_audit_events, platform_listing_moderation to climvia_p19_probe");
      await client.query("set local role climvia_p19_probe");
      for (const table of TABLES) expect((await client.query(`select count(*)::int as n from ${table}`)).rows[0].n, table).toBe(0);
      await client.query("reset role");
      expect((await client.query("select count(*)::int as n from platform_admins where user_id = $1", [admin.userId])).rows[0].n).toBe(1);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  test("at most one active assignment per person; a revoked one is history and a new grant is allowed; the other rules hold", async () => {
    const person = await makeAccount("p19rules", owner.db);
    await grantPlatformAdmin(owner.pool, person.userId);
    await expect(grantPlatformAdmin(owner.pool, person.userId)).rejects.toMatchObject({ code: "23505" });
    await revokePlatformAdmin(owner.pool, person.userId);
    await grantPlatformAdmin(owner.pool, person.userId);
    expect((await owner.pool.query("select count(*)::int as n from platform_admins where user_id = $1", [person.userId])).rows[0].n).toBe(2);
    expect((await owner.pool.query("select count(*)::int as n from platform_admins where user_id = $1 and revoked_at is null", [person.userId])).rows[0].n).toBe(1);

    const failing = async (statement: string, values: unknown[], code: string) => {
      const client = await owner.pool.connect();
      try {
        await client.query("begin");
        await expect(client.query(statement, values), statement).rejects.toMatchObject({ code });
      } finally {
        await client.query("rollback");
        client.release();
      }
    };
    await failing("insert into platform_admins (user_id, granted_via, granted_by) values ('no-such-user', 'cli', 'x')", [], "23503");
    await failing("insert into platform_admins (user_id, role, granted_via, granted_by) values ($1, 'owner', 'cli', 'x')", [(await makeAccount("p19role", owner.db)).userId], "23514");
    await failing("insert into platform_admins (user_id, granted_via, granted_by) values ($1, 'signup', 'x')", [(await makeAccount("p19via", owner.db)).userId], "23514");
    await failing("insert into platform_admins (user_id, granted_via, granted_by) values ($1, 'cli', '   ')", [(await makeAccount("p19by", owner.db)).userId], "23514");
    await failing("insert into platform_admins (user_id, granted_via, granted_by, revoked_at) values ($1, 'cli', 'x', now())", [(await makeAccount("p19pair", owner.db)).userId], "23514");
  });

  test("deleting an account ends its authority, and the audit trail keeps what happened", async () => {
    const person = await makeAccount("p19delete", owner.db);
    await grantPlatformAdmin(owner.pool, person.userId);
    await owner.pool.query("insert into platform_audit_events (action, actor_kind, actor_label, target_kind, target_id) values ('platform_admin.granted', 'cli', 'cli:specs', 'user', $1)", [person.userId]);
    await owner.pool.query("delete from auth_user where id = $1", [person.userId]);
    expect((await owner.pool.query("select count(*)::int as n from platform_admins where user_id = $1", [person.userId])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select count(*)::int as n from platform_audit_events where target_id = $1", [person.userId])).rows[0].n).toBe(1);
  });
});

/* ───────────────────────────────── the functions ───────────────────────────────── */

test.describe("the platform functions", () => {
  test("are SECURITY DEFINER with a fixed search path, executable by the application's role and by nobody else; the internal ones are not executable at all", async () => {
    const rows = (await owner.pool.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[] | null; acl: string[] | null; args: string }>(
      "select proname, prosecdef, provolatile, proconfig, proacl::text[] as acl, pg_get_function_identity_arguments(oid) as args from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'app\\_platform\\_%' or proname = 'app_is_platform_admin') order by proname",
    )).rows;
    expect(rows.map((row) => row.proname)).toEqual([
      "app_is_platform_admin",
      "app_platform_audit_recent",
      "app_platform_guard",
      "app_platform_like",
      "app_platform_listings",
      "app_platform_organization",
      "app_platform_organizations",
      "app_platform_overview",
      "app_platform_reviews",
      "app_platform_set_listing_moderation",
      "app_platform_system",
      "app_platform_users",
    ]);
    const internal = new Set(["app_platform_guard", "app_platform_like"]);
    for (const row of rows) {
      const grants = (row.acl ?? []).join(" ");
      expect(grants, row.proname).not.toMatch(/(^|[ ,{])=X\//);
      expect(row.proconfig, row.proname).toContain("search_path=public, pg_temp");
      if (row.proname !== "app_platform_like") expect(row.prosecdef, row.proname).toBe(true);
      if (internal.has(row.proname)) expect(grants, row.proname).not.toMatch(/climvia_app=X\//);
      else expect(grants, row.proname).toMatch(/climvia_app=X\//);
      // The readers can not write; the one writer is not marked STABLE.
      if (row.proname === "app_platform_set_listing_moderation") expect(row.provolatile).toBe("v");
      else if (row.proname.startsWith("app_platform_") && !internal.has(row.proname)) expect(row.provolatile, row.proname).toBe("s");
    }
    // No function with a free-form "run this" argument, and none that writes the assignments.
    expect(rows.map((row) => row.args).join(" ")).not.toMatch(/query|sql|statement/i);
    const source = (await owner.pool.query<{ src: string }>("select prosrc as src from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'app\\_platform\\_%' or proname = 'app_is_platform_admin')")).rows.map((row) => row.src).join("\n");
    expect(source).not.toMatch(/(insert\s+into|update|delete\s+from)\s+(public\.)?platform_admins/i);
  });

  test("refuse everyone who is not a platform administrator: no identity, a stranger, and every kind of tenant member, even naming their own business", async () => {
    const business = await makeBusiness("p19tenant", owner.db);
    const people = [null, "no-such-user", business.owner.userId, business.admin.userId, business.member.userId, (await makeAccount("p19plain", owner.db)).userId];
    for (const person of people) {
      expect(await asUser(person, (client) => one(client, "select app_is_platform_admin() as data")), String(person)).toBe(false);
      for (const reader of READERS) await refused(asUser(person, (client) => client.query(`select ${reader}`)));
      await refused(asUser(person, (client) => client.query("select app_platform_set_listing_moderation('00000000-0000-4000-8000-000000000000', 'suspended', 'x')")));
    }
    // The business named in the context changes nothing: authority is the person's, not the workspace's.
    for (const member of [business.owner, business.admin, business.member]) {
      expect(await asUser(member.userId, (client) => one(client, "select app_is_platform_admin() as data"), { organizationId: business.organizationId })).toBe(false);
      await refused(asUser(member.userId, (client) => client.query("select app_platform_overview()"), { organizationId: business.organizationId }));
    }
  });

  test("an administrator is recognised, needs no business, and revoking ends it at once", async () => {
    const admin = await makePlatformAdmin("p19admin", owner.db, owner.pool);
    expect(await asUser(admin.userId, (client) => one(client, "select app_is_platform_admin() as data"))).toBe(true);
    const overview = await asUser(admin.userId, (client) => one<Record<string, number>>(client, "select app_platform_overview() as data"));
    expect(Object.keys(overview).sort()).toEqual(["activeMemberships", "bookings", "listings", "organizations", "publishedListings", "publishedSites", "reviews", "sites", "suspendedListings", "users"]);
    expect((await owner.pool.query("select count(*)::int as n from organization_memberships where user_id = $1", [admin.userId])).rows[0].n).toBe(0);
    await revokePlatformAdmin(owner.pool, admin.userId);
    expect(await asUser(admin.userId, (client) => one(client, "select app_is_platform_admin() as data"))).toBe(false);
    await refused(asUser(admin.userId, (client) => client.query("select app_platform_overview()")));
  });

  test("platform authority and business authority are independent: an administrator who owns a business, and an owner of every business who is not an administrator", async () => {
    const business = await makeBusiness("p19both", owner.db);
    await grantPlatformAdmin(owner.pool, business.owner.userId);
    // Both at once: each answers on its own.
    expect(await asUser(business.owner.userId, (client) => one(client, "select app_is_platform_admin() as data"), { organizationId: business.organizationId })).toBe(true);
    expect(await asUser(business.owner.userId, (client) => one(client, "select count(*)::int as data from organizations"), { organizationId: business.organizationId })).toBe(1);
    // Revoked: still the business's owner, no longer an administrator.
    await revokePlatformAdmin(owner.pool, business.owner.userId);
    expect(await asUser(business.owner.userId, (client) => one(client, "select app_is_platform_admin() as data"), { organizationId: business.organizationId })).toBe(false);
    expect(await asUser(business.owner.userId, (client) => one(client, "select count(*)::int as data from organizations"), { organizationId: business.organizationId })).toBe(1);
    // An administrator who belongs to no business sees no business's rows through the tenant policies: authority over the platform is not access to a workspace.
    const admin = await makePlatformAdmin("p19alone", owner.db, owner.pool);
    for (const table of ["organizations", "customers", "bookings", "invoices", "payments", "reviews", "sites", "marketplace_listings"]) {
      expect(await asUser(admin.userId, (client) => one(client, `select count(*)::int as data from ${table}`), { organizationId: business.organizationId }), table).toBe(0);
    }
  });
});

/* ───────────────────────────────── what they return ───────────────────────────────── */

test.describe("what the platform reads return", () => {
  test("the overview agrees with the tables", async () => {
    const admin = await makePlatformAdmin("p19overview", owner.db, owner.pool);
    const overview = await asUser(admin.userId, (client) => one<Record<string, number>>(client, "select app_platform_overview() as data"));
    const expected = await owner.pool.query(
      `select (select count(*) from organizations)::int as organizations, (select count(*) from auth_user)::int as users,
              (select count(*) from organization_memberships where status = 'active')::int as "activeMemberships", (select count(*) from sites)::int as sites,
              (select count(*) from sites where status = 'published' and published_version_id is not null)::int as "publishedSites",
              (select count(*) from marketplace_listings)::int as listings, (select count(*) from marketplace_listings where status = 'published')::int as "publishedListings",
              (select count(*) from bookings)::int as bookings, (select count(*) from reviews)::int as reviews`,
    );
    for (const [name, value] of Object.entries(expected.rows[0])) {
      // Other specs create people and businesses in parallel: the figure can only have grown between the two reads.
      expect(overview[name], name).toBeGreaterThanOrEqual(0);
      expect(Math.abs(Number(overview[name]) - Number(value)), name).toBeLessThanOrEqual(60);
    }
    expect(overview.users).toBeGreaterThan(0);
  });

  test("the organization list pages, clamps its limits, finds a business by name, and takes % _ and \\ in a search literally", async () => {
    const admin = await makePlatformAdmin("p19orgs", owner.db, owner.pool);
    const marker = randomBytes(3).toString("hex");
    const names = [`P19 ${marker} 100% Heat_Co`, `P19 ${marker} Plain Air`, `P19 ${marker} Back\\Slash`];
    for (const [index, name] of names.entries()) {
      await owner.pool.query("insert into organizations (name, slug, timezone) values ($1, $2, 'America/Denver')", [name, `p19-${marker}-${index}`]);
    }
    const search = (text: string | null, limit = 25, offset = 0) => asUser(admin.userId, (client) => one<{ total: number; rows: { name: string }[] }>(client, "select app_platform_organizations($1, $2, $3) as data", [text, limit, offset]));

    expect((await search(marker)).rows.map((row) => row.name).sort()).toEqual([...names].sort());
    expect((await search(`${marker} plain`)).rows.map((row) => row.name)).toEqual([names[1]]);
    expect((await search(`${marker} PLAIN air`)).total).toBe(1);
    // Wildcards in the text are just characters.
    const withPercent = await owner.pool.query("select count(*)::int as n from organizations where position('%' in name) > 0");
    const percent = await search("%");
    expect(percent.total).toBe(withPercent.rows[0].n);
    expect(percent.rows.every((row) => row.name.includes("%"))).toBe(true);
    const underscore = await search("_");
    expect(underscore.total).toBe((await owner.pool.query("select count(*)::int as n from organizations where position('_' in name) > 0")).rows[0].n);
    expect((await search("\\")).rows.every((row) => row.name.includes("\\"))).toBe(true);
    expect((await search(`${marker} 100% heat_co`)).rows.map((row) => row.name)).toEqual([names[0]]);
    // Nothing in a search is run as SQL.
    expect((await search("'; drop table organizations; --")).total).toBe(0);
    expect((await owner.pool.query("select count(*)::int as n from organizations")).rows[0].n).toBeGreaterThan(0);
    // Limits and offsets are clamped, not trusted.
    expect((await search(null, 1000)).rows.length).toBeLessThanOrEqual(100);
    expect((await search(null, 0)).rows.length).toBe(1);
    expect((await search(null, -5)).rows.length).toBe(1);
    expect((await search(null, 25, -10)).rows.length).toBeGreaterThan(0);
    expect((await search(null, 25, 100_000)).rows).toEqual([]);
    expect((await search(marker, 1, 1)).rows).toHaveLength(1);
    expect((await search(marker, 1, 1)).total).toBe(3);
    expect((await search("x".repeat(500))).total).toBe(0);
  });

  test("an organization's detail names its people, Services, Sites and listing, and carries no token, hash or credential", async () => {
    const admin = await makePlatformAdmin("p19detail", owner.db, owner.pool);
    const business = await makeBusiness("p19detail", owner.db);
    const claimToken = await insertActiveClaim(owner.pool, business.organizationId, `p19-${randomBytes(3).toString("hex")}.example.test`);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    const detail = await asUser(admin.userId, (client) => one<Record<string, unknown>>(client, "select app_platform_organization($1) as data", [business.organizationId]));

    expect(Object.keys(detail).sort()).toEqual(["counts", "listing", "memberships", "profile", "services", "sites"]);
    const memberships = detail.memberships as { email: string; role: string }[];
    expect(memberships.map((member) => member.role)).toEqual(["owner", "admin", "member"]);
    expect(memberships.map((member) => member.email).sort()).toEqual([business.owner.email, business.admin.email, business.member.email].sort());
    expect((detail.listing as { publicSlug: string; moderation: { state: string } }).publicSlug).toBe(listing.slug);
    expect((detail.listing as { moderation: { state: string } }).moderation.state).toBe("allowed");
    expect((detail.counts as Record<string, number>).domains).toBe(1);

    // No secret anywhere in what came back: not the claim's ownership token, not any password hash or session token of the people in it.
    const text = JSON.stringify(detail);
    expect(text).not.toContain(claimToken);
    const secrets = await owner.pool.query<{ secret: string }>(
      "select a.password as secret from auth_account a where a.user_id = any($1) and a.password is not null union all select s.token from auth_session s where s.user_id = any($1)",
      [[business.owner.userId, business.admin.userId, business.member.userId]],
    );
    expect(secrets.rowCount).toBeGreaterThan(0);
    for (const row of secrets.rows) expect(text).not.toContain(row.secret);
    expect(Object.keys(detail.profile as object).sort()).toEqual(["addressLine1", "addressLine2", "city", "country", "createdAt", "currency", "email", "id", "name", "onboardingCompletedAt", "phone", "postalCode", "slug", "stateRegion", "timezone"]);

    // An id that is not a business is nothing; a null is nothing.
    expect(await asUser(admin.userId, (client) => one(client, "select app_platform_organization('00000000-0000-4000-8000-000000000000') as data"))).toBeNull();
    expect(await asUser(admin.userId, (client) => one(client, "select app_platform_organization(null) as data"))).toBeNull();
  });

  test("the user list shows identity and memberships and nothing that could sign in as someone", async () => {
    const admin = await makePlatformAdmin("p19users", owner.db, owner.pool);
    const business = await makeBusiness("p19users", owner.db);
    const result = await asUser(admin.userId, (client) => one<{ total: number; rows: { id: string; email: string; memberships: { role: string }[]; isPlatformAdmin: boolean }[] }>(client, "select app_platform_users($1, 25, 0) as data", [business.owner.email]));
    expect(result.rows.map((row) => row.email)).toEqual([business.owner.email]);
    expect(result.rows[0].memberships.map((membership) => membership.role)).toEqual(["owner"]);
    expect(result.rows[0].isPlatformAdmin).toBe(false);
    expect(Object.keys(result.rows[0]).sort()).toEqual(["createdAt", "email", "emailVerified", "id", "isPlatformAdmin", "memberships", "name"]);
    const self = await asUser(admin.userId, (client) => one<{ rows: { isPlatformAdmin: boolean }[] }>(client, "select app_platform_users($1, 25, 0) as data", [admin.email]));
    expect(self.rows[0].isPlatformAdmin).toBe(true);
    // Everyone's secrets, searched for in the whole first page.
    const page = JSON.stringify(await asUser(admin.userId, (client) => one(client, "select app_platform_users(null, 100, 0) as data")));
    const secrets = await owner.pool.query<{ secret: string }>("select password as secret from auth_account where password is not null union all select token from auth_session union all select value from auth_verification");
    for (const row of secrets.rows) expect(page).not.toContain(row.secret);
    expect(page).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/i);
  });

  test("the listings, reviews, system and recent-activity reads have the documented shapes", async () => {
    const admin = await makePlatformAdmin("p19reads", owner.db, owner.pool);
    const business = await makeBusiness("p19reads", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "hidden");
    const listings = await asUser(admin.userId, (client) => one<{ rows: Record<string, unknown>[] }>(client, "select app_platform_listings($1, 25, 0) as data", [listing.slug]));
    expect(listings.rows).toHaveLength(1);
    expect(listings.rows[0]).toMatchObject({ id: listing.id, organizationId: business.organizationId, status: "hidden", publiclyAvailable: false, moderation: { state: "allowed" } });
    expect(Object.keys(listings.rows[0]).sort()).toEqual(["discoverable", "id", "moderation", "organizationId", "organizationName", "publicSlug", "publiclyAvailable", "publishedAt", "selectedServices", "serviceAreas", "serviceNames", "site", "status"]);

    const reviews = await asUser(admin.userId, (client) => one<{ total: number; rows: { rating: number; text: string; organizationName: string }[] }>(client, "select app_platform_reviews(null, 5, 25, 0) as data"));
    expect(reviews.total).toBeGreaterThan(0);
    expect(reviews.rows.every((row) => row.rating === 5 && row.text.length > 0 && row.organizationName.length > 0)).toBe(true);
    expect(Object.keys(reviews.rows[0]).sort()).toEqual(["id", "organizationId", "organizationName", "rating", "replied", "reviewer", "source", "submittedOn", "text", "visibility"]);
    expect((await asUser(admin.userId, (client) => one<{ total: number }>(client, "select app_platform_reviews(null, 9, 25, 0) as data"))).total).toBe(0);

    const system = await asUser(admin.userId, (client) => one<{ databaseVersion: string; migrationsApplied: number; counts: Record<string, number> }>(client, "select app_platform_system() as data"));
    expect(system.databaseVersion).toMatch(/^\d+/);
    expect(system.migrationsApplied).toBeGreaterThanOrEqual(24);
    expect(Object.keys(system.counts).sort()).toEqual(["activeDomains", "auditEvents", "bookings", "listings", "liveSessions", "memberships", "organizations", "platformAdministrators", "publishedSites", "readyAssets", "reviews", "sites", "suspendedListings", "users"]);
    expect(JSON.stringify(system)).not.toMatch(/postgres:\/\/|password|secret/i);
    expect(Array.isArray(await asUser(admin.userId, (client) => one(client, "select app_platform_audit_recent(5) as data")))).toBe(true);
  });
});

/* ───────────────────────────────── moderation ───────────────────────────────── */

test.describe("moderating a Marketplace listing", () => {
  const publicListing = (slug: string) => app.query<{ listing: unknown }>("select app_public_listing($1) as listing", [slug]).then((result) => result.rows[0].listing);
  const decide = (userId: string, listing: string, state: string, reason: string | null = null) =>
    asUser(userId, (client) => one<{ found: boolean; changed: boolean; state?: string }>(client, "select app_platform_set_listing_moderation($1, $2, $3) as data", [listing, state, reason]), { commit: true });

  test("a suspended listing is not public whatever the business chose, unsuspending restores it only if the business still has it published, and nothing the business wrote is touched", async () => {
    const admin = await makePlatformAdmin("p19mod", owner.db, owner.pool);
    const business = await makeBusiness("p19mod", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    const before = (await owner.pool.query("select status, description, cover, updated_at, published_at, public_slug from marketplace_listings where id = $1", [listing.id])).rows[0];
    // The business's Service and its choice to show it on the listing: the configuration a suspension must leave alone.
    const service = await owner.pool.query<{ id: string }>(
      "insert into services (organization_id, slug, name, category, description, duration_minutes, pricing_model, booking_method, display_order) values ($1, 'p19-tune-up', 'Tune-up', 'Maintenance', 'A yearly tune-up.', 60, 'free-assessment', 'instant', 1) returning id",
      [business.organizationId],
    );
    await owner.pool.query("insert into marketplace_listing_services (organization_id, listing_id, service_id, sort_order) values ($1, $2, $3, 0)", [business.organizationId, listing.id, service.rows[0].id]);
    const configuration = async () => ({
      services: (await owner.pool.query("select * from services where organization_id = $1 order by id", [business.organizationId])).rows,
      selected: (await owner.pool.query("select * from marketplace_listing_services where listing_id = $1 order by service_id", [listing.id])).rows,
    });
    const configured = await configuration();
    expect(configured.services).toHaveLength(1);
    expect(configured.selected).toHaveLength(1);

    // Published and allowed: public.
    expect(await publicListing(listing.slug)).not.toBeNull();
    // Suspended: the same nothing as an address that does not exist.
    expect(await decide(admin.userId, listing.id, "suspended", "Complaints about the business's claims")).toEqual({ found: true, changed: true, state: "suspended" });
    expect(await publicListing(listing.slug)).toBeNull();
    expect(await publicListing("no-such-listing-p19")).toBeNull();
    // The business's own row is exactly as it was.
    expect((await owner.pool.query("select status, description, cover, updated_at, published_at, public_slug from marketplace_listings where id = $1", [listing.id])).rows[0]).toEqual(before);
    // ... and so are its Service and the Service's place on the listing: nothing was deleted or edited.
    expect(await configuration()).toEqual(configured);
    // The business hides it while it is suspended, then the platform allows it: still not public, because the business does not have it published.
    await owner.pool.query("update marketplace_listings set status = 'hidden' where id = $1", [listing.id]);
    expect(await decide(admin.userId, listing.id, "allowed")).toEqual({ found: true, changed: true, state: "allowed" });
    expect(await publicListing(listing.slug)).toBeNull();
    // The business publishes it again: public.
    await owner.pool.query("update marketplace_listings set status = 'published' where id = $1", [listing.id]);
    expect(await publicListing(listing.slug)).not.toBeNull();
    // Unpublished and allowed, or never published: never public.
    for (const status of ["hidden", "draft"] as const) {
      const other = await makeListing(owner.pool, (await makeBusiness(`p19mod${status}`, owner.db)).organizationId, status);
      expect(await publicListing(other.slug), status).toBeNull();
    }
  });

  test("the public answer carries nothing of the platform's decision: not the reason, not the state", async () => {
    const admin = await makePlatformAdmin("p19leak", owner.db, owner.pool);
    const business = await makeBusiness("p19leak", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    const reason = `internal-reason-${randomBytes(4).toString("hex")}`;
    await decide(admin.userId, listing.id, "suspended", reason);
    expect(JSON.stringify(await publicListing(listing.slug))).not.toContain(reason);
    await decide(admin.userId, listing.id, "allowed");
    const text = JSON.stringify(await publicListing(listing.slug));
    expect(text).not.toContain(reason);
    expect(text).not.toMatch(/moderation|suspended|decidedBy/i);
  });

  test("every decision is audited in the same transaction, with who, what, which listing and why; deciding what is already true records nothing", async () => {
    const admin = await makePlatformAdmin("p19audit", owner.db, owner.pool);
    const business = await makeBusiness("p19audit", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    const events = async () => (await owner.pool.query("select action, actor_kind, actor_user_id, actor_label, target_kind, target_id, reason, metadata from platform_audit_events where target_id = $1 order by occurred_at, id", [listing.id])).rows;

    expect(await decide(admin.userId, listing.id, "allowed")).toEqual({ found: true, changed: false, state: "allowed" });
    expect(await events()).toEqual([]);
    expect((await decide(admin.userId, listing.id, "suspended", "  first reason  ")).changed).toBe(true);
    expect((await decide(admin.userId, listing.id, "suspended", "another reason")).changed).toBe(false);
    expect((await decide(admin.userId, listing.id, "allowed", "a reason that is ignored when allowing")).changed).toBe(true);
    expect((await decide(admin.userId, listing.id, "suspended")).changed).toBe(true);
    const trail = await events();
    expect(trail.map((event) => event.action)).toEqual(["marketplace_listing.suspended", "marketplace_listing.unsuspended", "marketplace_listing.suspended"]);
    expect(trail[0]).toMatchObject({ actor_kind: "platform_admin", actor_user_id: admin.userId, actor_label: admin.email, target_kind: "marketplace_listing", reason: "first reason" });
    expect(trail[0].metadata).toEqual({ organizationId: business.organizationId, publicSlug: listing.slug, tenantStatus: "published", previous: "allowed" });
    expect(trail[1].reason).toBeNull();
    expect(trail[2].reason).toBeNull();
    const state = (await owner.pool.query("select state, reason, decided_by, revision from platform_listing_moderation where listing_id = $1", [listing.id])).rows[0];
    expect(state).toEqual({ state: "suspended", reason: null, decided_by: admin.userId, revision: 3 });
  });

  test("refusals change nothing: a non-administrator, a listing that does not exist, an unknown state, an over-long reason", async () => {
    const admin = await makePlatformAdmin("p19refuse", owner.db, owner.pool);
    const business = await makeBusiness("p19refuse", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    // A tenant owner and admin, and the business's own member, cannot moderate their own (or any) listing.
    for (const person of [business.owner, business.admin, business.member]) await refused(decide(person.userId, listing.id, "suspended", "I am allowed"));
    await refused(asUser(null, (client) => client.query("select app_platform_set_listing_moderation($1, 'suspended', null)", [listing.id]), { commit: true }));
    expect(await decide(admin.userId, "00000000-0000-4000-8000-000000000000", "suspended")).toEqual({ found: false, changed: false });
    await expect(decide(admin.userId, listing.id, "deleted")).rejects.toMatchObject({ code: "22023" });
    await expect(decide(admin.userId, listing.id, "suspended", "x".repeat(501))).rejects.toMatchObject({ code: "22023" });
    expect((await decide(admin.userId, listing.id, "suspended", "x".repeat(500))).changed).toBe(true);
    await decide(admin.userId, listing.id, "allowed");
    expect((await owner.pool.query("select count(*)::int as n from platform_audit_events where target_id = $1 and actor_user_id <> $2", [listing.id, admin.userId])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select count(*)::int as n from platform_audit_events where target_id = $1", [listing.id])).rows[0].n).toBe(2);
  });

  test("two administrators deciding at once leave one decision and one audit entry", async () => {
    const first = await makePlatformAdmin("p19race1", owner.db, owner.pool);
    const second = await makePlatformAdmin("p19race2", owner.db, owner.pool);
    const business = await makeBusiness("p19race", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, index) => decide(index % 2 === 0 ? first.userId : second.userId, listing.id, "suspended", `attempt ${index}`)));
    expect(outcomes.filter((outcome) => outcome.changed)).toHaveLength(1);
    expect((await owner.pool.query("select count(*)::int as n from platform_audit_events where target_id = $1", [listing.id])).rows[0].n).toBe(1);
    expect((await owner.pool.query("select state, revision from platform_listing_moderation where listing_id = $1", [listing.id])).rows[0]).toEqual({ state: "suspended", revision: 1 });
    expect(await publicListing(listing.slug)).toBeNull();
  });

  test("deleting a listing removes the decision with it, and the trail stays", async () => {
    const admin = await makePlatformAdmin("p19gone", owner.db, owner.pool);
    const business = await makeBusiness("p19gone", owner.db);
    const listing = await makeListing(owner.pool, business.organizationId, "published");
    await decide(admin.userId, listing.id, "suspended", "gone");
    await owner.pool.query("delete from marketplace_listings where id = $1", [listing.id]);
    expect((await owner.pool.query("select count(*)::int as n from platform_listing_moderation where listing_id = $1", [listing.id])).rows[0].n).toBe(0);
    expect((await owner.pool.query("select count(*)::int as n from platform_audit_events where target_id = $1", [listing.id])).rows[0].n).toBe(1);
  });
});

/* ───────────────────────────────── the audit trail ───────────────────────────────── */

test.describe("the audit trail", () => {
  test("can be appended to by the owner and by nobody else, and can never be changed, deleted or emptied, by any role", async () => {
    const marker = randomBytes(4).toString("hex");
    await owner.pool.query("insert into platform_audit_events (action, actor_kind, actor_label, target_kind, target_id, reason) values ('platform_admin.revoked', 'cli', 'cli:specs', 'user', $1, 'before')", [marker]);
    for (const statement of [
      `update platform_audit_events set reason = 'after' where target_id = '${marker}'`,
      `update platform_audit_events set occurred_at = now() - interval '1 year' where target_id = '${marker}'`,
      `delete from platform_audit_events where target_id = '${marker}'`,
      "truncate platform_audit_events",
    ]) {
      await expect(owner.pool.query(statement), statement).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("append-only") });
    }
    expect((await owner.pool.query("select reason from platform_audit_events where target_id = $1", [marker])).rows).toEqual([{ reason: "before" }]);
    // The runtime role can not touch it at all, signed in or not, administrator or not.
    const admin = await makePlatformAdmin("p19trail", owner.db, owner.pool);
    for (const person of [null, admin.userId]) {
      await refused(asUser(person, (client) => client.query("insert into platform_audit_events (action, actor_kind, actor_label, target_kind, target_id) values ('platform_admin.granted', 'cli', 'x', 'user', 'x')")));
      await refused(asUser(person, (client) => client.query("update platform_audit_events set reason = 'x'")));
      await refused(asUser(person, (client) => client.query("delete from platform_audit_events")));
    }
  });

  test("only the documented actions and shapes can be written", async () => {
    const attempt = async (columns: string, values: unknown[]) => {
      const client = await owner.pool.connect();
      try {
        await client.query("begin");
        await expect(client.query(`insert into platform_audit_events (${columns}) values (${values.map((_, index) => `$${index + 1}`).join(", ")})`, values)).rejects.toMatchObject({ code: "23514" });
      } finally {
        await client.query("rollback");
        client.release();
      }
    };
    await attempt("action, actor_kind, actor_label, target_kind, target_id", ["platform_admin.deleted", "cli", "x", "user", "x"]);
    await attempt("action, actor_kind, actor_label, target_kind, target_id", ["platform_admin.granted", "browser", "x", "user", "x"]);
    await attempt("action, actor_kind, actor_label, target_kind, target_id", ["platform_admin.granted", "platform_admin", "x", "user", "x"]);
    await attempt("action, actor_kind, actor_user_id, actor_label, target_kind, target_id", ["platform_admin.granted", "cli", "someone", "x", "user", "x"]);
    await attempt("action, actor_kind, actor_label, target_kind, target_id", ["platform_admin.granted", "cli", "x", "organization", "x"]);
    await attempt("action, actor_kind, actor_label, target_kind, target_id, metadata", ["platform_admin.granted", "cli", "x", "user", "x", JSON.stringify([1])]);
  });
});
