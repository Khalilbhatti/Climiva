/**
 * Phase 15: tenant isolation and integrity of the Website and Marketplace tables, and the narrow PUBLIC paths, at the DATABASE, independent
 * of the application code.
 *
 * Like marketing-database.spec.ts, this connects to the freshly migrated and seeded test database as the restricted runtime role the app
 * uses (`climvia_app`, DATABASE_URL), sets the transaction-local context the way src/db/tenant.ts does, and checks that PostgreSQL itself
 * keeps businesses apart: Row Level Security for who may read and write, column grants for what may change, composite foreign keys for
 * what may point at what, and triggers for what a published version may become. Every test runs in a transaction that is rolled back.
 *
 * The visitor paths (`app_public_site`, `app_public_listing`, `app_public_create_booking`) are called with NO context at all: that is what a
 * request without a session looks like.
 */
import { test, expect } from "playwright/test";
import { Pool, type PoolClient } from "pg";
import { DEFAULT_TEMPLATE } from "../src/db/default-template";
import { TEMPLATE_KEYS, findTemplateRecord } from "../src/db/site-templates";

const SEED = {
  alex: "alex.morgan@apex.test", // Apex owner
  jamie: "jamie.rivera@apex.test", // Apex member
  taylor: "taylor.brooks@northstar.test", // Northstar owner
  casey: "casey.nguyen@climvia.test", // admin in both
};

let app: Pool;
let admin: Pool;
const user: Record<string, string> = {};
let apex = "";
let northstar = "";
/** Database ids of the records the tests point at, per business. */
const a: Record<string, string> = {};
const n: Record<string, string> = {};

const idOf = async (sql: string, params: unknown[]) => (await admin.query<{ id: string }>(sql, params)).rows[0].id;

test.beforeAll(async () => {
  app = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  for (const [key, email] of Object.entries(SEED)) user[key] = (await admin.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0].id;
  apex = await idOf("select id from organizations where slug = 'apex-climate-heating-air'", []);
  northstar = await idOf("select id from organizations where slug = 'northstar-heating-cooling'", []);

  for (const [bag, org] of [[a, apex], [n, northstar]] as const) {
    bag.main = await idOf("select id from sites where organization_id = $1 and slug = 'main'", [org]);
    bag.draft = await idOf("select id from site_versions where site_id = $1 and status = 'draft'", [bag.main]);
    bag.live = await idOf("select id from site_versions where site_id = $1 and status = 'published' order by version_number desc limit 1", [bag.main]);
    bag.draftHome = await idOf("select id from site_pages where site_version_id = $1 and page_key = 'home'", [bag.draft]);
    bag.liveHome = await idOf("select id from site_pages where site_version_id = $1 and page_key = 'home'", [bag.live]);
    bag.draftHero = await idOf("select id from site_sections where page_id = $1 and section_key = 'hero'", [bag.draftHome]);
    bag.liveHero = await idOf("select id from site_sections where page_id = $1 and section_key = 'hero'", [bag.liveHome]);
    bag.listing = await idOf("select id from marketplace_listings where organization_id = $1", [org]);
    bag.service = await idOf("select id from services where organization_id = $1 and is_active and visibility = 'public-booking' order by display_order limit 1", [org]);
  }
  a.commercial = await idOf("select id from sites where organization_id = $1 and slug = 'commercial'", [apex]);
  a.commercialDraft = await idOf("select id from site_versions where site_id = $1 and status = 'draft'", [a.commercial]);
  n.service = await idOf("select id from services where organization_id = $1 and slug = 'furnace-tune-up'", [northstar]);
  a.emergency = await idOf("select id from services where organization_id = $1 and slug = 'emergency-no-heat-no-cool'", [apex]);
});

test.afterAll(async () => {
  await app.end();
  await admin.end();
});

type Outcome<T> = { value: T; error?: undefined; code?: undefined; constraint?: undefined } | { value?: undefined; error: string; code?: string; constraint?: string };

const failure = (error: unknown): { error: string; code?: string; constraint?: string } => ({
  error: error instanceof Error ? error.message : String(error),
  code: (error as { code?: string }).code,
  constraint: (error as { constraint?: string }).constraint,
});

/** Run `fn` as `userId` inside `org` (either may be absent), in a transaction that is always rolled back. */
async function as<T>(userId: string | null, org: string | null, fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [userId ?? "", org ?? ""]);
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** The same, through the owner role (no Row Level Security): for what only the seed may write, and to check constraints on their own. */
async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<Outcome<T>> {
  const client = await admin.connect();
  try {
    await client.query("begin");
    return { value: await fn(client) };
  } catch (error) {
    return failure(error);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

const count = async (client: PoolClient, sql: string, params: unknown[] = []) => (await client.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n;
const PERMISSION = "42501";
const FOREIGN_KEY = "23503";
const CHECK = "23514";

async function insertRow(client: PoolClient, table: string, row: Record<string, unknown>, returning = "id"): Promise<string> {
  const columns = Object.keys(row);
  const result = await client.query<Record<string, string>>(
    `insert into ${table} (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning ${returning}`,
    columns.map((column) => row[column]),
  );
  return result.rows[0][returning];
}

let sequence = 0;
const nextKey = () => `t${(sequence += 1)}`;
const site = (org: string, overrides: Record<string, unknown> = {}) => ({ organization_id: org, name: "Test site", slug: `test-${nextKey()}`, ...overrides });
const page = (org: string, siteId: string, versionId: string, overrides: Record<string, unknown> = {}) => {
  const key = nextKey();
  return { organization_id: org, site_id: siteId, site_version_id: versionId, page_key: key, title: "Extra", slug: key, page_type: "content", sort_order: 9, ...overrides };
};
const section = (org: string, siteId: string, versionId: string, pageId: string, overrides: Record<string, unknown> = {}) => ({
  organization_id: org,
  site_id: siteId,
  site_version_id: versionId,
  page_id: pageId,
  section_key: nextKey(),
  label: "Extra",
  type: "rich_text",
  variant: "default",
  props: JSON.stringify({}),
  sort_order: 9,
  ...overrides,
});

/** The public projections, read field by field in the checks below. */
type PublicSiteJson = {
  site: { name: string; platformSlug: string };
  organization: Record<string, unknown>;
  hours: unknown[];
  fixedClock: boolean;
  version: { number: number };
  pages: { key: string }[];
  page: { key: string; sections: { key: string }[] } | null;
  services: { slug: string; priceAmount: number | string }[];
};
type PublicListingJson = {
  listing: { actions: Record<string, boolean> };
  organization: Record<string, unknown>;
  hours: unknown[];
  siteSlug: string | null;
  sitePages: { key: string }[];
  services: { slug: string }[];
};

const TABLES = ["sites", "site_versions", "site_pages", "site_sections", "marketplace_listings", "marketplace_listing_services"] as const;

test.describe("the application's templates", () => {
  test("the runtime role reads the active templates, which are the application's four Templates, and can change nothing", async () => {
    const read = await as(user.alex, apex, (client) => client.query<{ key: string; schema_version: number; definition: unknown; is_active: boolean }>("select key, schema_version, definition, is_active from site_templates"));
    expect(read.value?.rows.map((row) => row.key).sort()).toEqual([...TEMPLATE_KEYS].sort());
    for (const row of read.value?.rows ?? []) {
      expect(row.schema_version).toBe(1);
      expect(row.definition).toEqual(JSON.parse(JSON.stringify(findTemplateRecord(row.key)?.definition)));
    }
    expect(read.value?.rows.find((row) => row.key === "climvia-starter")?.definition).toEqual(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));

    const insert = await as(user.alex, apex, (client) => insertRow(client, "site_templates", { key: "mine", name: "Mine", category: "hvac", schema_version: 1, definition: JSON.stringify({ schema: 1 }) }));
    expect(insert.code).toBe(PERMISSION);
    const update = await as(user.alex, apex, (client) => client.query("update site_templates set name = 'Changed'"));
    expect(update.code).toBe(PERMISSION);
    const remove = await as(user.alex, apex, (client) => client.query("delete from site_templates"));
    expect(remove.code).toBe(PERMISSION);
    // The template is application data, not tenant data: the same template is read in every business.
    const northstarRead = await as(user.taylor, northstar, (client) => count(client, "select 1 from site_templates"));
    expect(northstarRead.value).toBe(TEMPLATE_KEYS.length);
  });

  test("a template carries no executable code: its definition is validated JSON of the registered shape, and a malformed one cannot be stored", async () => {
    const bad = await asOwner((client) => insertRow(client, "site_templates", { key: "bad-shape", name: "Bad", category: "hvac", schema_version: 1, definition: JSON.stringify({ schema: 2 }) }));
    expect(bad.constraint).toBe("site_templates_definition_shape");
    const noSchema = await asOwner((client) => insertRow(client, "site_templates", { key: "bad-empty", name: "Bad", category: "hvac", schema_version: 1, definition: JSON.stringify({}) }));
    expect(noSchema.constraint).toBe("site_templates_definition_shape");
    const notAnObject = await asOwner((client) => insertRow(client, "site_templates", { key: "bad-array", name: "Bad", category: "hvac", schema_version: 1, definition: JSON.stringify([1]) }));
    expect(notAnObject.code).toBe(CHECK);
    const badKey = await asOwner((client) => insertRow(client, "site_templates", { key: "Bad Key", name: "Bad", category: "hvac", schema_version: 1, definition: JSON.stringify({ schema: 1 }) }));
    expect(badKey.constraint).toBe("site_templates_key_format");
    const row = await admin.query<{ definition: unknown }>("select definition from site_templates where key = 'climvia-starter'");
    expect(JSON.stringify(row.rows[0].definition)).not.toMatch(/<script|<iframe|javascript:|function\s*\(/i);
  });

  test("only active templates are readable by the runtime role (the policy says so)", async () => {
    const policy = await admin.query<{ qual: string }>("select qual from pg_policies where tablename = 'site_templates' and policyname = 'site_templates_select'");
    expect(policy.rows[0].qual).toContain("is_active");
  });
});

test.describe("what each business can see", () => {
  test("a member of Apex reads Apex's Sites, Versions, Pages, Sections and Listing, and none of Northstar's", async () => {
    for (const table of TABLES) {
      const own = await as(user.alex, apex, (client) => client.query<{ organization_id: string }>(`select distinct organization_id from ${table}`));
      expect(own.value?.rows.map((row) => row.organization_id), table).toEqual([apex]);
    }
  });

  test("the seeded content is exactly this much per business", async () => {
    const totals = async (org: string) =>
      (
        await admin.query(
          `select (select count(*)::int from sites where organization_id = $1) as sites,
                  (select count(*)::int from site_versions where organization_id = $1) as versions,
                  (select count(*)::int from site_pages where organization_id = $1) as pages,
                  (select count(*)::int from site_sections where organization_id = $1) as sections,
                  (select count(*)::int from marketplace_listings where organization_id = $1) as listings,
                  (select count(*)::int from marketplace_listing_services where organization_id = $1) as selections`,
          [org],
        )
      ).rows[0];
    expect(await totals(apex)).toEqual({ sites: 2, versions: 3, pages: 15, sections: 66, listings: 1, selections: 5 });
    expect(await totals(northstar)).toEqual({ sites: 1, versions: 2, pages: 10, sections: 44, listings: 1, selections: 2 });
  });

  test("Northstar's owner sees only Northstar's; the same person with Apex's id sees nothing, because they are not a member", async () => {
    for (const table of TABLES) {
      const own = await as(user.taylor, northstar, (client) => client.query<{ organization_id: string }>(`select distinct organization_id from ${table}`));
      expect(own.value?.rows.map((row) => row.organization_id), table).toEqual([northstar]);
      const forged = await as(user.taylor, apex, (client) => count(client, `select 1 from ${table}`));
      expect(forged.value, table).toBe(0);
    }
  });

  test("with no signed-in person or no active business, no table shows anything", async () => {
    for (const table of TABLES) {
      expect((await as(null, null, (client) => count(client, `select 1 from ${table}`))).value, table).toBe(0);
      expect((await as(user.alex, null, (client) => count(client, `select 1 from ${table}`))).value, table).toBe(0);
      expect((await as(null, apex, (client) => count(client, `select 1 from ${table}`))).value, table).toBe(0);
    }
  });

  test("a person who is in both businesses sees one at a time", async () => {
    for (const [org, other] of [[apex, northstar], [northstar, apex]] as const) {
      const seen = await as(user.casey, org, (client) => client.query<{ organization_id: string }>("select distinct organization_id from site_pages"));
      expect(seen.value?.rows.map((row) => row.organization_id)).toEqual([org]);
      expect(seen.value?.rows.map((row) => row.organization_id)).not.toContain(other);
    }
  });

  test("looking a Site, Page or Section up by another business's id reveals nothing", async () => {
    const lookups = await as(user.alex, apex, async (client) => ({
      site: await count(client, "select 1 from sites where id = $1", [n.main]),
      version: await count(client, "select 1 from site_versions where id = $1", [n.live]),
      page: await count(client, "select 1 from site_pages where id = $1", [n.liveHome]),
      section: await count(client, "select 1 from site_sections where id = $1", [n.liveHero]),
      listing: await count(client, "select 1 from marketplace_listings where id = $1", [n.listing]),
    }));
    expect(lookups.value).toEqual({ site: 0, version: 0, page: 0, section: 0, listing: 0 });
  });
});

test.describe("who can change what", () => {
  test("an owner edits the Draft's text; a member can read it but change nothing", async () => {
    const owner = await as(user.alex, apex, (client) => client.query("update site_sections set props = $2::jsonb where id = $1", [a.draftHero, JSON.stringify({ headline: "Edited" })]));
    expect(owner.value?.rowCount).toBe(1);
    const member = await as(user.jamie, apex, async (client) => {
      const readable = await count(client, "select 1 from site_sections");
      const edit = await client.query("update site_sections set props = $2::jsonb where id = $1", [a.draftHero, JSON.stringify({ headline: "Edited" })]);
      return { readable, changed: edit.rowCount };
    });
    expect(member.value?.readable).toBeGreaterThan(0);
    expect(member.value?.changed).toBe(0);
  });

  test("a member cannot create a Site, a Version, a Page or a Listing", async () => {
    expect((await as(user.jamie, apex, (client) => insertRow(client, "sites", site(apex)))).code).toBe(PERMISSION);
    expect((await as(user.jamie, apex, (client) => insertRow(client, "site_pages", page(apex, a.main, a.draft)))).code).toBe(PERMISSION);
    expect((await as(user.jamie, apex, (client) => insertRow(client, "site_versions", { organization_id: apex, site_id: a.commercial, status: "draft", theme: JSON.stringify({ schema: 1 }) }))).code).toBe(PERMISSION);
    const rename = await as(user.jamie, apex, (client) => client.query("update sites set name = 'Hijacked' where id = $1", [a.main]));
    expect(rename.value?.rowCount).toBe(0);
    const listing = await as(user.jamie, apex, (client) => client.query("update marketplace_listings set description = 'Hijacked' where id = $1", [a.listing]));
    expect(listing.value?.rowCount).toBe(0);
  });

  test("an owner of one business cannot write into another's Site, even by naming it", async () => {
    const edit = await as(user.taylor, northstar, async (client) => {
      const section = await client.query("update site_sections set props = '{}'::jsonb where id = $1", [a.draftHero]);
      const rename = await client.query("update sites set name = 'Hijacked' where id = $1", [a.main]);
      const listing = await client.query("update marketplace_listings set description = 'Hijacked' where id = $1", [a.listing]);
      return [section.rowCount, rename.rowCount, listing.rowCount];
    });
    expect(edit.value).toEqual([0, 0, 0]);
    const insertIntoApex = await as(user.taylor, northstar, (client) => insertRow(client, "site_pages", page(apex, a.main, a.draft)));
    expect(insertIntoApex.code).toBe(PERMISSION);
    const insertSite = await as(user.taylor, northstar, (client) => insertRow(client, "sites", site(apex)));
    expect(insertSite.code).toBe(PERMISSION);
  });

  test("a Site's identity cannot be changed by anyone through the application: its slug, public address, primary flag and business are fixed", async () => {
    for (const column of ["slug", "platform_slug", "is_primary", "organization_id", "created_at"]) {
      const result = await as(user.alex, apex, (client) => client.query(`update sites set ${column} = ${column} where id = $1`, [a.main]));
      expect(result.code, column).toBe(PERMISSION);
    }
    for (const column of ["status", "version_number", "site_id", "organization_id", "published_at", "published_by_user_id"]) {
      const result = await as(user.alex, apex, (client) => client.query(`update site_versions set ${column} = ${column} where id = $1`, [a.draft]));
      expect(result.code, column).toBe(PERMISSION);
    }
    for (const column of ["page_key", "page_type", "site_version_id", "organization_id"]) {
      const result = await as(user.alex, apex, (client) => client.query(`update site_pages set ${column} = ${column} where id = $1`, [a.draftHome]));
      expect(result.code, column).toBe(PERMISSION);
    }
    for (const column of ["section_key", "type", "page_id", "site_version_id", "organization_id"]) {
      const result = await as(user.alex, apex, (client) => client.query(`update site_sections set ${column} = ${column} where id = $1`, [a.draftHero]));
      expect(result.code, column).toBe(PERMISSION);
    }
    for (const column of ["public_slug", "organization_id", "id"]) {
      const result = await as(user.alex, apex, (client) => client.query(`update marketplace_listings set ${column} = ${column} where id = $1`, [a.listing]));
      expect(result.code, column).toBe(PERMISSION);
    }
  });

  test("nothing in the Website or the Marketplace can be deleted by the runtime role except a Draft's own pages and sections and a listing's Service selections", async () => {
    const privileges = await admin.query<{ table_name: string; privilege_type: string }>(
      "select table_name, privilege_type from information_schema.role_table_grants where grantee = 'climvia_app' and table_name = any($1) order by 1, 2",
      [["site_templates", "sites", "site_versions", "site_pages", "site_sections", "marketplace_listings", "marketplace_listing_services"]],
    );
    const by = (table: string) => privileges.rows.filter((row) => row.table_name === table).map((row) => row.privilege_type);
    expect(by("site_templates")).toEqual(["SELECT"]);
    // Updates are granted by column, so they are not table-level privileges.
    expect(by("sites")).toEqual(["INSERT", "SELECT"]);
    expect(by("site_versions")).toEqual(["INSERT", "SELECT"]);
    expect(by("site_pages")).toEqual(["DELETE", "INSERT", "SELECT"]);
    expect(by("site_sections")).toEqual(["DELETE", "INSERT", "SELECT"]);
    expect(by("marketplace_listings")).toEqual(["INSERT", "SELECT"]);
    expect(by("marketplace_listing_services")).toEqual(["DELETE", "INSERT", "SELECT"]);
    const updatable = async (table: string) =>
      (
        await admin.query<{ column_name: string }>(
          "select column_name from information_schema.column_privileges where grantee = 'climvia_app' and table_name = $1 and privilege_type = 'UPDATE' order by column_name",
          [table],
        )
      ).rows.map((row) => row.column_name);
    expect(await updatable("sites")).toEqual(["name", "published_version_id", "selected_template_id", "status"]);
    expect(await updatable("site_versions")).toEqual(["settings", "template_id", "theme"]);
    expect(await updatable("site_pages")).toEqual(["is_visible", "slug", "sort_order", "title"]);
    expect(await updatable("site_sections")).toEqual(["is_visible", "label", "props", "sort_order", "variant"]);
    expect(await updatable("marketplace_listing_services")).toEqual(["sort_order"]);
    expect((await as(user.alex, apex, (client) => client.query("delete from sites where id = $1", [a.commercial]))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => client.query("delete from site_versions where id = $1", [a.draft]))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => client.query("delete from marketplace_listings where id = $1", [a.listing]))).code).toBe(PERMISSION);
  });
});

test.describe("a Published version is a snapshot", () => {
  test("no one, the owner role included, can change a published Version, Page or Section", async () => {
    const version = await asOwner((client) => client.query("update site_versions set theme = $2::jsonb where id = $1", [a.live, JSON.stringify({ schema: 1, accent: "#112233" })]));
    expect(version.constraint).toBe("site_published_final");
    const pageEdit = await asOwner((client) => client.query("update site_pages set title = 'Changed' where id = $1", [a.liveHome]));
    expect(pageEdit.constraint).toBe("site_published_final");
    const sectionEdit = await asOwner((client) => client.query("update site_sections set props = '{}'::jsonb where id = $1", [a.liveHero]));
    expect(sectionEdit.constraint).toBe("site_published_final");
    const touched = await asOwner((client) => client.query("update site_versions set updated_at = now() where id = $1", [a.live]));
    expect(touched.constraint).toBe("site_published_final");
  });

  test("the runtime role's own edit of a published Page or Section changes no row at all", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const sectionEdit = await client.query("update site_sections set props = $2::jsonb where id = $1", [a.liveHero, JSON.stringify({ headline: "Edited" })]);
      const pageEdit = await client.query("update site_pages set title = 'Changed' where id = $1", [a.liveHome]);
      const versionEdit = await client.query("update site_versions set theme = $2::jsonb where id = $1", [a.live, JSON.stringify({ schema: 1 })]);
      const sectionDelete = await client.query("delete from site_sections where id = $1", [a.liveHero]);
      const pageDelete = await client.query("delete from site_pages where id = $1", [a.liveHome]);
      const hero = await client.query<{ props: { headline?: string } }>("select props from site_sections where id = $1", [a.liveHero]);
      return { changed: [sectionEdit.rowCount, pageEdit.rowCount, versionEdit.rowCount, sectionDelete.rowCount, pageDelete.rowCount], headline: hero.rows[0].props.headline };
    });
    expect(result.value?.changed).toEqual([0, 0, 0, 0, 0]);
    expect(result.value?.headline).toBe("Heating & cooling service when you need it.");
  });

  test("a Draft keeps its identity: it never becomes a published version by update, and its number and site never change", async () => {
    const status = await asOwner((client) => client.query("update site_versions set status = 'published', version_number = 9, published_at = now() where id = $1", [a.draft]));
    expect(status.constraint).toBe("site_versions_identity");
    const number = await asOwner((client) => client.query("update site_versions set version_number = 9 where id = $1", [a.draft]));
    expect([number.constraint, number.code]).toContain("site_versions_identity");
  });

  test("a Published version can be written only in the transaction that publishes its Site, by an owner or admin", async () => {
    const version = (org: string, siteId: string, number: number, by: string | null) => ({
      organization_id: org,
      site_id: siteId,
      version_number: number,
      status: "published",
      theme: JSON.stringify({ schema: 1, accent: null, radius: "medium", density: "comfortable", headingFont: "inter", bodyFont: "inter" }),
      published_at: new Date().toISOString(),
      published_by_user_id: by,
    });
    // Without touching the Site first: refused.
    const bare = await as(user.alex, apex, (client) => insertRow(client, "site_versions", version(apex, a.commercial, 1, user.alex)));
    expect(bare.code).toBe(PERMISSION);
    // A Page or Section of a published version, outside Publish: refused.
    expect((await as(user.alex, apex, (client) => insertRow(client, "site_pages", page(apex, a.main, a.live)))).code).toBe(PERMISSION);
    expect((await as(user.alex, apex, (client) => insertRow(client, "site_sections", section(apex, a.main, a.live, a.liveHome)))).code).toBe(PERMISSION);

    // In the transaction that has just changed the Site: allowed, as the person publishing.
    const publishing = await as(user.alex, apex, async (client) => {
      await client.query("update sites set status = status where id = $1", [a.commercial]);
      const id = await insertRow(client, "site_versions", version(apex, a.commercial, 1, user.alex));
      const pageId = await insertRow(client, "site_pages", { ...page(apex, a.commercial, id), page_type: "home", slug: "", page_key: "home" });
      await insertRow(client, "site_sections", section(apex, a.commercial, id, pageId));
      await client.query("update sites set status = 'published', published_version_id = $2 where id = $1", [a.commercial, id]);
      return client.query("select status from sites where id = $1", [a.commercial]);
    });
    expect(publishing.value?.rows[0].status).toBe("published");

    // Not as someone else: the version must be stamped with the caller.
    const stamped = await as(user.alex, apex, async (client) => {
      await client.query("update sites set status = status where id = $1", [a.commercial]);
      return insertRow(client, "site_versions", version(apex, a.commercial, 1, user.jamie));
    });
    expect(stamped.code).toBe(PERMISSION);
    // Not by a member who happens to touch the Site (they cannot: the update changes nothing for them).
    const member = await as(user.jamie, apex, async (client) => {
      await client.query("update sites set status = status where id = $1", [a.commercial]);
      return insertRow(client, "site_versions", version(apex, a.commercial, 1, user.jamie));
    });
    expect(member.code).toBe(PERMISSION);
    // Touching one Site does not open another: a version for a different Site of the same business is refused.
    const other = await as(user.alex, apex, async (client) => {
      await client.query("update sites set status = status where id = $1", [a.main]);
      return insertRow(client, "site_versions", version(apex, a.commercial, 1, user.alex));
    });
    expect(other.code).toBe(PERMISSION);
  });

  test("a Site can point only at a published Version of itself", async () => {
    // A draft of its own, a published version of another Site, and a published version of another business's Site.
    for (const target of [a.commercialDraft, a.live, n.live]) {
      const result = await as(user.alex, apex, (client) => client.query("update sites set status = 'published', published_version_id = $2 where id = $1", [a.commercial, target]));
      expect(result.constraint, target).toBe("sites_publish_target");
    }
    // With the guard out of the way, the composite foreign key says the same.
    for (const target of [a.live, n.live]) {
      const result = await asOwner(async (client) => {
        await client.query("alter table sites disable trigger sites_guard_update");
        return client.query("update sites set status = 'published', published_version_id = $2 where id = $1", [a.commercial, target]);
      });
      expect(result.code, target).toBe(FOREIGN_KEY);
      expect(result.constraint, target).toBe("sites_published_version_fk");
    }
    // A site is published exactly when it has a pointer.
    const noPointer = await asOwner((client) => client.query("update sites set status = 'published' where id = $1", [a.commercial]));
    expect(noPointer.constraint).toBe("sites_published_pointer");
    const strayPointer = await asOwner((client) => client.query("update sites set published_version_id = $2 where id = $1", [a.commercial, a.live]));
    expect(strayPointer.code).toBe(CHECK);
  });
});

test.describe("a reference cannot cross a Site, a Version or a business", () => {
  test("a Page cannot belong to another business's Version, or to another Site's", async () => {
    const otherBusiness = await asOwner((client) => insertRow(client, "site_pages", page(apex, a.main, n.draft)));
    expect(otherBusiness.constraint).toBe("site_pages_version_fk");
    const otherBusinessSite = await asOwner((client) => insertRow(client, "site_pages", page(northstar, a.main, a.draft)));
    expect(otherBusinessSite.constraint).toBe("site_pages_version_fk");
    const otherSite = await asOwner((client) => insertRow(client, "site_pages", page(apex, a.main, a.commercialDraft)));
    expect(otherSite.constraint).toBe("site_pages_version_fk");
    // The same attempt as the person who is signed in: the policy cannot even see the other business's Version, so it refuses first.
    const asOwnerOfApex = await as(user.alex, apex, (client) => insertRow(client, "site_pages", page(apex, a.main, n.draft)));
    expect(asOwnerOfApex.code).toBe(PERMISSION);
    const control = await as(user.alex, apex, (client) => insertRow(client, "site_pages", page(apex, a.main, a.draft)));
    expect(control.error).toBeUndefined();
  });

  test("a Section cannot sit on another business's Page, another Version's Page or another Site's Page", async () => {
    const otherBusiness = await asOwner((client) => insertRow(client, "site_sections", section(apex, a.main, a.draft, n.draftHome)));
    expect(otherBusiness.constraint).toBe("site_sections_page_fk");
    const otherVersion = await asOwner((client) => insertRow(client, "site_sections", section(apex, a.main, a.draft, a.liveHome)));
    expect(otherVersion.constraint).toBe("site_sections_page_fk");
    const otherBusinessOwn = await asOwner((client) => insertRow(client, "site_sections", section(northstar, a.main, a.draft, a.draftHome)));
    expect(otherBusinessOwn.constraint).toBe("site_sections_page_fk");
    const control = await as(user.alex, apex, (client) => insertRow(client, "site_sections", section(apex, a.main, a.draft, a.draftHome)));
    expect(control.error).toBeUndefined();
  });

  test("a Version cannot belong to another business's Site", async () => {
    const shaped = {
      status: "published",
      version_number: 5,
      theme: JSON.stringify({ schema: 1 }),
      published_at: new Date().toISOString(),
      published_by_user_id: user.taylor,
    };
    const result = await asOwner((client) => insertRow(client, "site_versions", { organization_id: northstar, site_id: a.commercial, ...shaped }));
    expect(result.constraint).toBe("site_versions_site_fk");
    const control = await asOwner((client) => insertRow(client, "site_versions", { organization_id: apex, site_id: a.commercial, ...shaped }));
    expect(control.error).toBeUndefined();
  });

  test("a listing's Service selection cannot name another business's Service or Listing", async () => {
    const service = (org: string, listing: string, serviceId: string) => ({ organization_id: org, listing_id: listing, service_id: serviceId, sort_order: 9 });
    // Another business's Service: refused by the guard first, then by the composite key once the guard is out of the way.
    const guarded = await asOwner((client) => insertRow(client, "marketplace_listing_services", service(apex, a.listing, n.service), "service_id"));
    expect(guarded.constraint).toBe("marketplace_listing_services_public");
    const keyed = await asOwner(async (client) => {
      await client.query("alter table marketplace_listing_services disable trigger marketplace_listing_services_guard");
      return insertRow(client, "marketplace_listing_services", service(apex, a.listing, n.service), "service_id");
    });
    expect(keyed.constraint).toBe("marketplace_listing_services_service_fk");
    // Another business's Listing.
    const listing = await asOwner((client) => insertRow(client, "marketplace_listing_services", service(apex, n.listing, a.emergency), "service_id"));
    expect(listing.constraint).toBe("marketplace_listing_services_listing_fk");
    const listingAsApex = await as(user.alex, apex, (client) => insertRow(client, "marketplace_listing_services", service(apex, n.listing, a.emergency), "service_id"));
    expect([listingAsApex.code, listingAsApex.constraint]).toEqual([FOREIGN_KEY, "marketplace_listing_services_listing_fk"]);
  });

  test("a listing can show only an active, public Service of its own business", async () => {
    const emergency = { organization_id: apex, listing_id: a.listing, service_id: a.emergency, sort_order: 9 };
    // The standing Apex listing leaves Emergency off; a business can add it back, because it is public and active.
    const added = await as(user.alex, apex, (client) => insertRow(client, "marketplace_listing_services", emergency, "service_id"));
    expect(added.error).toBeUndefined();
    const internal = await as(user.alex, apex, async (client) => {
      await client.query("update services set visibility = 'internal' where id = $1", [a.emergency]);
      return insertRow(client, "marketplace_listing_services", emergency, "service_id");
    });
    expect(internal.constraint).toBe("marketplace_listing_services_public");
    const inactive = await asOwner(async (client) => {
      await client.query("update services set is_active = false where id = $1", [a.emergency]);
      return insertRow(client, "marketplace_listing_services", emergency, "service_id");
    });
    expect(inactive.constraint).toBe("marketplace_listing_services_public");
  });
});

test.describe("Sites: identity, addresses and domains", () => {
  test("a Site starts private, and the runtime role can never create one already published", async () => {
    const published = await as(user.alex, apex, (client) => insertRow(client, "sites", site(apex, { status: "published" })));
    expect(published.constraint).toBe("sites_new_private");
    const ok = await as(user.alex, apex, (client) => insertRow(client, "sites", site(apex)));
    expect(ok.error).toBeUndefined();
  });

  test("a Site made without a public address gets a valid, collision-safe one derived from the business and the Site, not from either name", async () => {
    const made = await as(user.alex, apex, async (client) => {
      const first = await insertRow(client, "sites", site(apex, { slug: "extra" }), "platform_slug");
      const second = await insertRow(client, "sites", site(apex, { slug: "extra-two" }), "platform_slug");
      return [first, second];
    });
    const [first, second] = made.value ?? [];
    expect(first).toMatch(/^apex-climate-heating-air-extra-[0-9a-f]{6}$/);
    expect(second).toMatch(/^apex-climate-heating-air-extra-two-[0-9a-f]{6}$/);
    expect(first).not.toBe(second);
  });

  test("a public address is globally unique, lower-case words, and never one the platform keeps for itself", async () => {
    const duplicate = await as(user.taylor, northstar, (client) => insertRow(client, "sites", site(northstar, { platform_slug: "apexclimate" })));
    expect(duplicate.constraint).toBe("sites_platform_slug_unique");
    for (const reserved of ["admin", "www", "api", "login", "sites", "listings", "climvia"]) {
      const result = await asOwner((client) => insertRow(client, "sites", site(apex, { platform_slug: reserved })));
      expect(result.constraint, reserved).toBe("sites_platform_slug_format");
    }
    for (const malformed of ["Has-Caps", "has space", "-leading", "trailing-", "double--hyphen", "x".repeat(64)]) {
      const result = await asOwner((client) => insertRow(client, "sites", site(apex, { platform_slug: malformed })));
      expect(result.constraint, malformed).toBe("sites_platform_slug_format");
    }
  });

  test("a business has one primary Site and as many other Sites as it likes, each with its own address", async () => {
    const second = await asOwner((client) => insertRow(client, "sites", site(apex, { is_primary: true, platform_slug: "apexclimate-two-primaries" })));
    expect(second.constraint).toBe("sites_primary_unique");
    const many = await as(user.alex, apex, async (client) => {
      await insertRow(client, "sites", site(apex, { slug: "third" }));
      await insertRow(client, "sites", site(apex, { slug: "fourth" }));
      return count(client, "select 1 from sites");
    });
    expect(many.value).toBe(4);
    const duplicateSlug = await as(user.alex, apex, (client) => insertRow(client, "sites", site(apex, { slug: "main" })));
    expect(duplicateSlug.constraint).toBe("sites_org_slug_unique");
  });

  test("a Site no longer carries a domain of its own: its custom domains are claims in site_domains (domains-database.spec.ts)", async () => {
    const columns = (await admin.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'sites'")).rows.map((row) => row.column_name);
    for (const gone of ["custom_domain", "custom_domain_status", "primary_domain"]) expect(columns).not.toContain(gone);
    // The seed claims nothing: a business starts with its platform address and no custom domain.
    expect((await admin.query("select count(*)::int as n from site_domains where organization_id in ($1, $2)", [apex, northstar])).rows[0].n).toBe(0);
  });
});

test.describe("Versions, Pages and Sections: structure", () => {
  const theme = JSON.stringify({ schema: 1, accent: null, radius: "medium", density: "comfortable", headingFont: "inter", bodyFont: "inter" });

  test("a Site has at most one Draft, and Published versions are numbered once each", async () => {
    const second = await as(user.alex, apex, (client) => insertRow(client, "site_versions", { organization_id: apex, site_id: a.main, status: "draft", theme }));
    expect(second.constraint).toBe("site_versions_one_draft");
    const published = {
      organization_id: apex,
      site_id: a.main,
      version_number: 1,
      status: "published",
      theme,
      published_at: new Date().toISOString(),
      published_by_user_id: user.alex,
    };
    const again = await asOwner((client) => insertRow(client, "site_versions", published));
    expect(again.constraint).toBe("site_versions_site_number_unique");
    const shape = await asOwner((client) => insertRow(client, "site_versions", { ...published, version_number: 7, published_at: null }));
    expect(shape.constraint).toBe("site_versions_published_shape");
    const draftWithNumber = await asOwner((client) => insertRow(client, "site_versions", { organization_id: apex, site_id: a.commercial, status: "draft", version_number: 3, theme }));
    expect(draftWithNumber.constraint).toBe("site_versions_number_shape");
  });

  test("a theme and settings are bounded JSON of the registered shape", async () => {
    const draft = (overrides: Record<string, unknown>) => ({ organization_id: apex, site_id: a.commercial, status: "draft", theme, ...overrides });
    expect((await asOwner((client) => insertRow(client, "site_versions", draft({ theme: JSON.stringify([1]) })))).constraint).toBe("site_versions_theme_shape");
    expect((await asOwner((client) => insertRow(client, "site_versions", draft({ theme: JSON.stringify({ schema: 2 }) })))).constraint).toBe("site_versions_theme_shape");
    // A theme with no schema at all is not "unknown, so allowed": it is refused.
    expect((await asOwner((client) => insertRow(client, "site_versions", draft({ theme: JSON.stringify({}) })))).constraint).toBe("site_versions_theme_shape");
    expect((await asOwner((client) => insertRow(client, "site_versions", draft({ settings: JSON.stringify({ blob: "x".repeat(20001) }) })))).constraint).toBe("site_versions_settings_shape");
    expect((await asOwner((client) => insertRow(client, "site_versions", draft({ settings: JSON.stringify([]) })))).constraint).toBe("site_versions_settings_shape");
  });

  test("a Page keeps its rules: the root address is Home's alone, keys and addresses are unique per Version, names are bounded", async () => {
    const insert = (overrides: Record<string, unknown>) => as(user.alex, apex, (client) => insertRow(client, "site_pages", page(apex, a.main, a.draft, overrides)));
    expect((await insert({ page_type: "home", page_key: "second-home", slug: "" })).constraint).toBe("site_pages_version_slug_unique");
    expect((await insert({ page_type: "content", slug: "" })).constraint).toBe("site_pages_home_root");
    expect((await insert({ page_type: "home", slug: "welcome" })).constraint).toBe("site_pages_home_root");
    expect((await insert({ page_key: "about", slug: "about-us" })).constraint).toBe("site_pages_version_key_unique");
    expect((await insert({ slug: "services" })).constraint).toBe("site_pages_version_slug_unique");
    expect((await insert({ slug: "Has Spaces" })).constraint).toBe("site_pages_slug_format");
    expect((await insert({ page_key: "Has Caps" })).constraint).toBe("site_pages_key_format");
    expect((await insert({ title: "   " })).constraint).toBe("site_pages_title_length");
    expect((await insert({ page_type: "carousel" })).constraint).toBe("site_pages_type");
    expect((await insert({ sort_order: -1 })).constraint).toBe("site_pages_sort_order");
  });

  test("a Section keeps its rules: a well-formed registered-looking type, bounded JSON props, a unique key per Page", async () => {
    const insert = (overrides: Record<string, unknown>) => as(user.alex, apex, (client) => insertRow(client, "site_sections", section(apex, a.main, a.draft, a.draftHome, overrides)));
    expect((await insert({ type: "Hero" })).constraint).toBe("site_sections_type_format");
    expect((await insert({ type: "script tag" })).constraint).toBe("site_sections_type_format");
    expect((await insert({ variant: "Has Caps" })).constraint).toBe("site_sections_type_format");
    expect((await insert({ props: JSON.stringify([1, 2]) })).constraint).toBe("site_sections_props_shape");
    expect((await insert({ props: JSON.stringify({ blob: "x".repeat(20001) }) })).constraint).toBe("site_sections_props_shape");
    expect((await insert({ section_key: "hero" })).constraint).toBe("site_sections_page_key_unique");
    expect((await insert({ section_key: "1bad" })).constraint).toBe("site_sections_key_format");
    expect((await insert({ label: "" })).constraint).toBe("site_sections_label_length");
    expect((await insert({ sort_order: -1 })).constraint).toBe("site_sections_sort_order");
    expect((await insert({ type: "rich_text", props: JSON.stringify({ body: "ok" }) })).error).toBeUndefined();
  });
});

test.describe("the Marketplace listing", () => {
  test("Apex shows five of its six Services and Emergency No-Heat / No-Cool Service is not one of them; Northstar shows its own two", async () => {
    const shown = async (org: string) =>
      (
        await admin.query<{ name: string }>(
          `select s.name from marketplace_listing_services ls join services s on s.organization_id = ls.organization_id and s.id = ls.service_id
            where ls.organization_id = $1 order by ls.sort_order`,
          [org],
        )
      ).rows.map((row) => row.name);
    const apexShown = await shown(apex);
    expect(apexShown).toHaveLength(5);
    expect(apexShown).not.toContain("Emergency No-Heat / No-Cool Service");
    const all = (await admin.query<{ name: string }>("select name from services where organization_id = $1 and is_active and visibility <> 'internal'", [apex])).rows.map((row) => row.name);
    expect(all).toHaveLength(6);
    expect(all.filter((name) => !apexShown.includes(name))).toEqual(["Emergency No-Heat / No-Cool Service"]);
    expect(await shown(northstar)).toHaveLength(2);
    const status = await admin.query<{ organization_id: string; status: string; public_slug: string }>("select organization_id, status, public_slug from marketplace_listings where organization_id = any($1)", [[apex, northstar]]);
    expect(status.rows.map((row) => row.status)).toEqual(["published", "published"]);
    expect(new Set(status.rows.map((row) => row.public_slug)).size).toBe(2);
  });

  test("an owner configures the listing; a member and another business cannot; the business and listing identity are fixed", async () => {
    const owner = await as(user.alex, apex, (client) =>
      client.query("update marketplace_listings set description = 'New description', show_phone = false, cover = 'warm-linen' where id = $1", [a.listing]),
    );
    expect(owner.value?.rowCount).toBe(1);
    expect((await as(user.jamie, apex, (client) => client.query("update marketplace_listings set description = 'x' where id = $1", [a.listing]))).value?.rowCount).toBe(0);
    expect((await as(user.taylor, northstar, (client) => client.query("update marketplace_listings set description = 'x' where id = $1", [a.listing]))).value?.rowCount).toBe(0);
  });

  test("a business has at most one listing, a public address is unique and never a reserved name, and the description is bounded", async () => {
    const second = await asOwner((client) => insertRow(client, "marketplace_listings", { organization_id: apex, public_slug: "another", description: "x" }));
    expect(second.constraint).toBe("marketplace_listings_org_unique");
    const stolen = await asOwner(async (client) => {
      await client.query("delete from marketplace_listing_services where listing_id = $1", [n.listing]);
      await client.query("delete from marketplace_listings where id = $1", [n.listing]);
      return insertRow(client, "marketplace_listings", { organization_id: northstar, public_slug: "apex-climate-heating-air", description: "x" });
    });
    expect(stolen.constraint).toBe("marketplace_listings_public_slug_unique");
    for (const reserved of ["sites", "listings", "admin"]) {
      const result = await asOwner(async (client) => {
        await client.query("delete from marketplace_listing_services where listing_id = $1", [n.listing]);
        await client.query("delete from marketplace_listings where id = $1", [n.listing]);
        return insertRow(client, "marketplace_listings", { organization_id: northstar, public_slug: reserved, description: "x" });
      });
      expect(result.constraint, reserved).toBe("marketplace_listings_public_slug_format");
    }
    expect((await as(user.alex, apex, (client) => client.query("update marketplace_listings set description = '' where id = $1", [a.listing]))).constraint).toBe("marketplace_listings_description");
    expect((await as(user.alex, apex, (client) => client.query("update marketplace_listings set description = $2 where id = $1", [a.listing, "x".repeat(301)]))).constraint).toBe("marketplace_listings_description");
    expect((await as(user.alex, apex, (client) => client.query("update marketplace_listings set cover = 'neon' where id = $1", [a.listing]))).constraint).toBe("marketplace_listings_cover");
  });

  test("a listing is published once and is then published or hidden, never a draft again; hiding keeps its configuration", async () => {
    const result = await as(user.alex, apex, async (client) => {
      const before = (await client.query<{ published_at: Date }>("select published_at from marketplace_listings where id = $1", [a.listing])).rows[0].published_at;
      await client.query("update marketplace_listings set status = 'hidden' where id = $1", [a.listing]);
      const hidden = (await client.query<{ status: string; published_at: Date; selected: number }>(
        "select status, published_at, (select count(*)::int from marketplace_listing_services where listing_id = $1) as selected from marketplace_listings where id = $1",
        [a.listing],
      )).rows[0];
      return { before, hidden };
    });
    expect(result.value?.hidden.status).toBe("hidden");
    expect(result.value?.hidden.published_at).toEqual(result.value?.before);
    expect(result.value?.hidden.selected).toBe(5);
    const back = await as(user.alex, apex, (client) => client.query("update marketplace_listings set status = 'draft' where id = $1", [a.listing]));
    expect(back.constraint).toBe("marketplace_listings_no_draft");
  });

  test("a new listing starts as a draft with no publication time; a business that has not set one up has none", async () => {
    const created = await asOwner(async (client) => {
      await client.query("delete from marketplace_listing_services where listing_id = $1", [n.listing]);
      await client.query("delete from marketplace_listings where id = $1", [n.listing]);
      const id = await insertRow(client, "marketplace_listings", { organization_id: northstar, public_slug: "northstar-new", description: "Fresh", status: "draft" });
      return (await client.query<{ status: string; published_at: Date | null }>("select status, published_at from marketplace_listings where id = $1", [id])).rows[0];
    });
    expect(created.value).toEqual({ status: "draft", published_at: null });
    const none = await as(user.casey, apex, (client) => count(client, "select 1 from marketplace_listings where organization_id <> $1", [apex]));
    expect(none.value).toBe(0);
  });
});

test.describe("the public paths, called with no session and no business", () => {
  const publicSite = (slug: string, pageSlug = "") =>
    as(null, null, async (client) => (await client.query<{ site: Record<string, unknown> | null }>("select app_public_site($1, $2) as site", [slug, pageSlug])).rows[0].site);
  const publicListing = (slug: string) => as(null, null, async (client) => (await client.query<{ listing: Record<string, unknown> | null }>("select app_public_listing($1) as listing", [slug])).rows[0].listing);

  test("the visitor path is the only way in: with no context the tables are empty, but the function answers", async () => {
    const direct = await as(null, null, (client) => count(client, "select 1 from sites"));
    expect(direct.value).toBe(0);
    const answer = await publicSite("apexclimate");
    expect(answer.error).toBeUndefined();
    expect(answer.value).not.toBeNull();
  });

  test("a published site is returned as a visitor sees it: its pages, the requested page's visible sections, the organization's public details and its public Services", async () => {
    const answer = (await publicSite("apexclimate")).value as PublicSiteJson;
    expect(Object.keys(answer).sort()).toEqual(["fixedClock", "hours", "organization", "page", "pages", "services", "site", "version"]);
    expect(answer.site).toEqual({ name: "Apex Climate Heating & Air", platformSlug: "apexclimate" });
    expect(answer.pages.map((entry: { key: string }) => entry.key)).toEqual(["home", "services", "about", "contact", "booking"]);
    expect(answer.page?.key).toBe("home");
    expect(answer.page?.sections.map((entry: { key: string }) => entry.key)).toEqual(["hero", "services", "why", "hours", "contact", "bookingCta"]);
    // `logo` is the business's logo as an Asset id (migration 0018), or null: never a storage key.
    expect(Object.keys(answer.organization).sort()).toEqual(["city", "dateFormat", "email", "logo", "name", "phone", "postalCode", "state", "street", "timeFormat", "timeZone"]);
    expect(answer.services).toHaveLength(6);
    expect(Object.keys(answer.services[0]).sort()).toEqual(["bookingMethod", "category", "description", "displayOrder", "durationMinutes", "intake", "name", "priceAmount", "priceLabel", "pricingModel", "slug", "visibility"]);
    expect(answer.version.number).toBe(1);
    const page = (await publicSite("apexclimate", "about")).value as PublicSiteJson;
    expect(page.page?.key).toBe("about");
    const missing = (await publicSite("apexclimate", "nope")).value as PublicSiteJson;
    expect(missing.page).toBeNull();
    expect(missing.pages).toHaveLength(5);
  });

  test("nothing private is in it: no customers, team, money, internal notes, identifiers of the business, or anything from another business", async () => {
    const text = JSON.stringify((await publicSite("apexclimate")).value);
    for (const forbidden of ["Sarah Mitchell", "David Chen", "Alex Morgan", "Jamie Rivera", "internalDescription", "internal_description", "organization_id", "organizationId", "Northstar", "Marta Olsen", apex, northstar, a.main, a.live, "password", "token"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    const listing = JSON.stringify((await publicListing("apex-climate-heating-air")).value);
    for (const forbidden of ["Sarah Mitchell", "internalDescription", "organization_id", "organizationId", "Northstar", apex, a.listing]) expect(listing, forbidden).not.toContain(forbidden);
  });

  test("an unknown, private or malformed address answers nothing, and says nothing about why", async () => {
    for (const slug of ["nobody", "apexclimate-commercial", "", "x".repeat(64), "'; drop table sites; --", "../apexclimate", "apexclimate%"]) {
      const result = await publicSite(slug);
      expect(result.error, slug).toBeUndefined();
      expect(result.value, slug).toBeNull();
    }
    expect((await publicSite("APEXCLIMATE")).value).not.toBeNull();
    for (const slug of ["nobody", "", "x".repeat(64), "northstar'--"]) expect((await publicListing(slug)).value, slug).toBeNull();
    const intact = await admin.query("select count(*)::int as n from sites where organization_id = $1", [apex]);
    expect(intact.rows[0].n).toBe(2);
  });

  test("a Draft never reaches a visitor: editing it changes nothing they see, and a hidden section or page is not returned", async () => {
    const result = await asOwner(async (client) => {
      await client.query("update site_sections set props = props || '{\"headline\": \"DRAFT-ONLY-HEADLINE\"}'::jsonb where id = $1", [a.draftHero]);
      await client.query("update site_pages set title = 'DRAFT-ONLY-TITLE' where id = $1", [a.draftHome]);
      const answer = (await client.query("select app_public_site('apexclimate', '') as site")).rows[0].site;
      return JSON.stringify(answer);
    });
    expect(result.value).not.toContain("DRAFT-ONLY");
    expect(result.value).toContain("Heating & cooling service when you need it.");
    // Northstar's published home page leaves its hours card out (hidden in the snapshot).
    const northstarHome = (await publicSite("northstar")).value as PublicSiteJson;
    expect(northstarHome.page?.sections.map((entry: { key: string }) => entry.key)).not.toContain("hours");
    expect(northstarHome.page?.sections.map((entry: { key: string }) => entry.key)).toContain("hero");
  });

  test("a Site that is made private stops being served at once, and its content is kept", async () => {
    const result = await asOwner(async (client) => {
      const before = (await client.query("select app_public_site('apexclimate', '') as site")).rows[0].site;
      await client.query("update sites set status = 'draft', published_version_id = null where id = $1", [a.main]);
      const after = (await client.query("select app_public_site('apexclimate', '') as site")).rows[0].site;
      const kept = (await client.query("select count(*)::int as versions from site_versions where site_id = $1", [a.main])).rows[0].versions;
      return { before: before !== null, after, kept };
    });
    expect(result.value).toEqual({ before: true, after: null, kept: 2 });
  });

  test("a business's current record is what the page shows: a rename and a changed phone number are read live, with no new version", async () => {
    const result = await asOwner(async (client) => {
      await client.query("update organizations set name = 'Renamed Climate Co', phone = '(555) 000-1234' where id = $1", [apex]);
      return (await client.query("select app_public_site('apexclimate', '') as site")).rows[0].site;
    });
    const site = result.value as PublicSiteJson;
    expect(site.organization.name).toBe("Renamed Climate Co");
    expect(site.organization.phone).toBe("(555) 000-1234");
    expect(site.version.number).toBe(1);
  });

  test("a Service change is read live: a new price, a retired Service and an internal Service", async () => {
    const result = await asOwner(async (client) => {
      await client.query("update services set price_amount = 999 where organization_id = $1 and slug = 'annual-cooling-tune-up'", [apex]);
      await client.query("update services set is_active = false where organization_id = $1 and slug = 'furnace-safety-inspection'", [apex]);
      await client.query("update services set visibility = 'internal' where organization_id = $1 and slug = 'ductless-mini-split-estimate'", [apex]);
      return (await client.query("select app_public_site('apexclimate', 'services') as site")).rows[0].site;
    });
    const services = (result.value as PublicSiteJson).services;
    expect(services.map((service) => service.slug)).not.toContain("furnace-safety-inspection");
    expect(services.map((service) => service.slug)).not.toContain("ductless-mini-split-estimate");
    expect(Number(services.find((service) => service.slug === "annual-cooling-tune-up")?.priceAmount)).toBe(999);
    expect(services).toHaveLength(4);
  });

  test("a published listing shows only what it switches on, with its selected Services in its order, and Emergency is not among them", async () => {
    const apexListing = (await publicListing("apex-climate-heating-air")).value as PublicListingJson;
    expect(Object.keys(apexListing).sort()).toEqual(["hours", "listing", "organization", "rating", "reviews", "serviceAreas", "sitePages", "siteSlug", "services"].sort());
    expect(apexListing.services).toHaveLength(5);
    expect(apexListing.services.map((service: { slug: string }) => service.slug)).not.toContain("emergency-no-heat-no-cool");
    expect(apexListing.siteSlug).toBe("apexclimate");
    expect(apexListing.sitePages.map((entry: { key: string }) => entry.key)).toEqual(["home", "services", "about", "contact", "booking"]);
    expect(apexListing.organization.phone).toBe("(555) 392-8100");

    const northstarListing = (await publicListing("northstar-heating-cooling")).value as PublicListingJson;
    expect(northstarListing.hours).toEqual([]);
    expect(northstarListing.services.map((service: { slug: string }) => service.slug)).toEqual(["furnace-tune-up", "ac-repair-diagnostics"]);
    expect(northstarListing.listing.actions).toEqual({ book: true, website: true, contact: false });
  });

  test("a contact detail the listing switches off is absent from the answer, not just hidden", async () => {
    const result = await asOwner(async (client) => {
      await client.query("update marketplace_listings set show_phone = false, show_email = false, show_address = false where id = $1", [a.listing]);
      return (await client.query("select app_public_listing('apex-climate-heating-air') as listing")).rows[0].listing;
    });
    const org = (result.value as PublicListingJson).organization;
    expect(org.phone).toBeNull();
    expect(org.email).toBeNull();
    expect(org.street).toBeNull();
    expect(JSON.stringify(result.value)).not.toContain("392-8100");
  });

  test("a hidden listing, or one whose Services were all retired, is not served; a listing's website link follows its Site's publication", async () => {
    const hidden = await asOwner(async (client) => {
      await client.query("update marketplace_listings set status = 'hidden' where id = $1", [a.listing]);
      return (await client.query("select app_public_listing('apex-climate-heating-air') as listing")).rows[0].listing;
    });
    expect(hidden.value).toBeNull();
    const privateSite = await asOwner(async (client) => {
      await client.query("update sites set status = 'draft', published_version_id = null where id = $1", [a.main]);
      return (await client.query("select app_public_listing('apex-climate-heating-air') as listing")).rows[0].listing;
    });
    const listing = privateSite.value as PublicListingJson;
    expect(listing.siteSlug).toBeNull();
    expect(listing.sitePages).toEqual([]);
  });

  test("the functions are the only door: definer functions with a fixed search path, runnable by the runtime role and not by the public; the unrestricted number allocator is not callable at all", async () => {
    const functions = await admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; args: string[] | null }>(
      "select proname, prosecdef, proconfig, proargnames as args from pg_proc where proname in ('app_public_site', 'app_public_listing', 'app_public_create_booking', 'app_take_number')",
    );
    expect(functions.rows).toHaveLength(4);
    for (const fn of functions.rows) {
      expect(fn.prosecdef, fn.proname).toBe(true);
      expect(fn.proconfig?.join(","), fn.proname).toContain("search_path");
      // No function accepts an organization.
      expect((fn.args ?? []).filter((name) => /org/i.test(name)), fn.proname).toEqual(fn.proname === "app_take_number" ? ["p_org"] : []);
    }
    const privilege = async (grantee: string, fn: string) => (await admin.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [grantee, fn])).rows[0].ok;
    for (const fn of ["app_public_site(text, text)", "app_public_listing(text)", "app_public_create_booking(text, text, text, date, time, time, text, text, text, text, text, text, text, timestamptz)"]) {
      expect(await privilege("climvia_app", fn), fn).toBe(true);
      expect(await privilege("public", fn), fn).toBe(false);
    }
    expect(await privilege("climvia_app", "app_take_number(uuid, text)")).toBe(false);
    const direct = await as(user.alex, apex, (client) => client.query("select app_take_number($1, 'booking')", [apex]));
    expect(direct.code).toBe(PERMISSION);
  });
});

test.describe("a public booking, at the database", () => {
  const book = (client: PoolClient, slug: string, service: string, key: string, overrides: { email?: string; name?: string; date?: string; start?: string; end?: string } = {}) =>
    client
      .query<{ booking: { ok: boolean; reason?: string; duplicate?: boolean; number?: number; status?: string } }>(
        `select app_public_create_booking($1, $2, $3, $4::date, $5::time, $6::time, $7, '(512) 555-0100', $8, '1 Test Street, Austin, TX', null, null, null) as booking`,
        [slug, service, key, overrides.date ?? "2024-10-28", overrides.start ?? "09:00", overrides.end ?? "10:00", overrides.name ?? "Dana Visitor", overrides.email ?? "dana@example.test"],
      )
      .then((result) => result.rows[0].booking);

  test("the business is the Site's: an instant Service is confirmed and a request is pending, as a Website booking of a customer made from it, in the Site's own business", async () => {
    const result = await as(null, null, async (client) => {
      const instant = await book(client, "apexclimate", "annual-cooling-tune-up", "key-instant-0001");
      const request = await book(client, "apexclimate", "ac-repair-diagnostics", "key-request-0001", { start: "08:00", end: "10:00", email: "other@example.test" });
      return { instant, request };
    });
    expect(result.value?.instant).toMatchObject({ ok: true, duplicate: false, status: "confirmed" });
    expect(result.value?.request).toMatchObject({ ok: true, duplicate: false, status: "pending" });
    expect(result.value?.request.number).toBe((result.value?.instant.number ?? 0) + 1);

    const stored = await asOwner(async (client) => {
      const first = await book(client, "apexclimate", "annual-cooling-tune-up", "key-instant-0002");
      const row = (
        await client.query(
          `select b.organization_id, b.customer_id, c.organization_id as customer_organization, c.name as customer_name, b.property_id, b.source, b.status, b.contact_name, b.service_id, b.submission_key
             from bookings b left join customers c on c.id = b.customer_id where b.number = $1 and b.organization_id = $2`,
          [first.number, apex],
        )
      ).rows[0];
      return row;
    });
    // The visitor became (or was found as) the business's customer: the booking is theirs, in the same business, and carries no contact name of its own (drizzle/0030;
    // customer-acquisition-database.spec.ts holds the rule).
    expect(stored.value).toMatchObject({ organization_id: apex, customer_organization: apex, customer_name: "Dana Visitor", property_id: null, source: "Website", status: "confirmed", contact_name: null, submission_key: "key-instant-0002" });
    expect(stored.value?.customer_id).not.toBeNull();
    expect(stored.value?.service_id).not.toBeNull();
  });

  test("the numbers are the business's own: a booking for Northstar's site is numbered from Northstar's counter and is Northstar's", async () => {
    const result = await asOwner(async (client) => {
      const first = await book(client, "northstar", "furnace-tune-up", "key-northstar-0001");
      const row = (await client.query("select organization_id, number from bookings where number = $1 and source = 'Website' and submission_key = 'key-northstar-0001'", [first.number])).rows[0];
      const apexBooking = await book(client, "apexclimate", "annual-cooling-tune-up", "key-apex-0001");
      return { first, row, apexBooking };
    });
    expect(result.value?.row.organization_id).toBe(northstar);
    expect(result.value?.first.ok).toBe(true);
    expect(result.value?.apexBooking.ok).toBe(true);
  });

  test("a Service of another business, an unknown Service, a retired one and an internal one are all refused without a booking", async () => {
    const result = await asOwner(async (client) => {
      const made = () => client.query("select count(*)::int as n from bookings where submission_key like 'key-%'").then((result) => result.rows[0].n as number);
      const before = await made();
      const foreign = await book(client, "apexclimate", "furnace-tune-up", "key-foreign-0001"); // Northstar's Service, named on Apex's site
      const unknown = await book(client, "apexclimate", "does-not-exist", "key-unknown-0001");
      const wrongWay = await book(client, "northstar", "annual-cooling-tune-up", "key-wrongway-0001"); // Apex's Service, named on Northstar's site
      await client.query("update services set is_active = false where organization_id = $1 and slug = 'annual-cooling-tune-up'", [apex]);
      const retired = await book(client, "apexclimate", "annual-cooling-tune-up", "key-retired-0001");
      await client.query("update services set is_active = true, visibility = 'internal' where organization_id = $1 and slug = 'annual-cooling-tune-up'", [apex]);
      const internal = await book(client, "apexclimate", "annual-cooling-tune-up", "key-internal-0001");
      await client.query("update services set visibility = 'public-only' where organization_id = $1 and slug = 'annual-cooling-tune-up'", [apex]);
      const listedOnly = await book(client, "apexclimate", "annual-cooling-tune-up", "key-listed-0001");
      const after = await made();
      return { foreign, unknown, wrongWay, retired, internal, listedOnly, created: after - before };
    });
    for (const key of ["foreign", "unknown", "wrongWay", "retired", "internal", "listedOnly"] as const) expect(result.value?.[key], key).toEqual({ ok: false, reason: "service" });
    expect(result.value?.created).toBe(0);
  });

  test("a private or unknown Site takes no booking, and bad details are refused", async () => {
    const result = await asOwner(async (client) => {
      const unknown = await book(client, "nobody", "annual-cooling-tune-up", "key-nosite-0001");
      const privateSite = await book(client, "apexclimate-commercial", "annual-cooling-tune-up", "key-private-0001");
      const noName = await book(client, "apexclimate", "annual-cooling-tune-up", "key-noname-0001", { name: "  " });
      const backwards = await book(client, "apexclimate", "annual-cooling-tune-up", "key-back-0001", { start: "10:00", end: "09:00" });
      await client.query("update sites set status = 'draft', published_version_id = null where id = $1", [a.main]);
      const unpublished = await book(client, "apexclimate", "annual-cooling-tune-up", "key-unpub-0001");
      return { unknown, privateSite, noName, backwards, unpublished };
    });
    expect(result.value).toEqual({
      unknown: { ok: false, reason: "site" },
      privateSite: { ok: false, reason: "site" },
      noName: { ok: false, reason: "details" },
      backwards: { ok: false, reason: "details" },
      unpublished: { ok: false, reason: "site" },
    });
  });

  test("the same submission again, or the same person asking for the same time again, finds the first booking instead of making another", async () => {
    const result = await asOwner(async (client) => {
      const first = await book(client, "apexclimate", "annual-cooling-tune-up", "key-dup-00001");
      const sameKey = await book(client, "apexclimate", "annual-cooling-tune-up", "key-dup-00001", { email: "someone-else@example.test", start: "14:00", end: "15:00" });
      const sameAsk = await book(client, "apexclimate", "annual-cooling-tune-up", "key-dup-00002");
      const differentPerson = await book(client, "apexclimate", "annual-cooling-tune-up", "key-dup-00003", { email: "another@example.test" });
      const count = (await client.query("select count(*)::int as n from bookings where organization_id = $1 and submission_key like 'key-dup-%'", [apex])).rows[0].n;
      return { first, sameKey, sameAsk, differentPerson, count };
    });
    expect(result.value?.sameKey).toMatchObject({ ok: true, duplicate: true, number: result.value?.first.number });
    expect(result.value?.sameAsk).toMatchObject({ ok: true, duplicate: true, number: result.value?.first.number });
    expect(result.value?.differentPerson).toMatchObject({ ok: true, duplicate: false });
    expect(result.value?.differentPerson.number).not.toBe(result.value?.first.number);
    expect(result.value?.count).toBe(2);
  });

  test("a submission key belongs to one business: the same key on two Sites makes a booking in each", async () => {
    const result = await asOwner(async (client) => {
      const one = await book(client, "apexclimate", "annual-cooling-tune-up", "key-shared-0001");
      const two = await book(client, "northstar", "furnace-tune-up", "key-shared-0001");
      return { one, two };
    });
    expect(result.value?.one).toMatchObject({ ok: true, duplicate: false });
    expect(result.value?.two).toMatchObject({ ok: true, duplicate: false });
  });

  test("the runtime role can make a booking only through the function: it has no privilege to read or write bookings with no business", async () => {
    const direct = await as(null, null, (client) => count(client, "select 1 from bookings"));
    expect(direct.value).toBe(0);
    const insert = await as(null, null, (client) => client.query("insert into bookings (organization_id, number, service_id, status, service_date, start_time, end_time) values ($1, 99999, $2, 'pending', '2024-10-28', '09:00', '10:00')", [apex, a.service]));
    expect(insert.code).toBe(PERMISSION);
    const viaFunction = await as(null, null, async (client) => {
      const made = await book(client, "apexclimate", "annual-cooling-tune-up", "key-visitor-0001");
      // The visitor's answer is a number and a status, never a record.
      return Object.keys(made).sort();
    });
    expect(viaFunction.value).toEqual(["duplicate", "number", "ok", "status"]);
  });
});
