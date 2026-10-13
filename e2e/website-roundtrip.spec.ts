/**
 * The seed and the application's database layer agree for the Website and the Marketplace: what the seed wrote is what the application reads
 * back (the Sites with their Draft and Published versions, the listing with its selected Services), the sample records keep the same database
 * identity every time the database is rebuilt, seeding again changes nothing, and a test copy of the sample business is put back to exactly
 * this however a test changed it, extra Sites included. The Marketplace operations (set up, save, hide, publish and what they refuse) run as
 * the application runs them, on a test copy.
 *
 * These read through the restricted runtime role under the tenant context (the way a page does).
 */
import { expect, test } from "playwright/test";
import { Pool } from "pg";
import { canonicalContent } from "../src/data/website";
import { getEligibleServices } from "../src/data/marketplace";
import { loadServices } from "../src/db/core-queries";
import { TEMPLATE_KEYS } from "../src/db/site-templates";
import { findListing, loadMarketplace, saveListing, setListingStatus, type ListingContext } from "../src/db/marketplace-queries";
import { createSite, loadPrimaryWebsite, loadWebsiteState, listSites, stableSiteIds } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { Refusal } from "../src/lib/refusal";
import { adminDb } from "../scripts/db/lib";
import { resetTestTenant, seedDevelopmentData } from "../scripts/db/seed-lib";
import { APEX_CONTENT, APEX_LISTING, NORTHSTAR_CONTENT, NORTHSTAR_LISTING } from "./apex-data";
import { test as fixtures } from "./fixtures";
import { versionOf } from "./website-edits";

let admin: Pool;
const ids = { apex: "", northstar: "", alex: "", taylor: "", jamie: "" };

test.beforeAll(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  const one = async (sql: string) => (await admin.query<{ id: string }>(sql)).rows[0].id;
  ids.apex = await one("select id from organizations where slug = 'apex-climate-heating-air'");
  ids.northstar = await one("select id from organizations where slug = 'northstar-heating-cooling'");
  ids.alex = await one("select id from auth_user where email = 'alex.morgan@apex.test'");
  ids.taylor = await one("select id from auth_user where email = 'taylor.brooks@northstar.test'");
  ids.jamie = await one("select id from auth_user where email = 'jamie.rivera@apex.test'");
});

test.afterAll(async () => {
  await admin.end();
});

const marketplaceOf = (user: string, org: string) =>
  withTenant({ userId: user, organizationId: org }, async (tx) => loadMarketplace(tx, org, await loadServices(tx, org)));

/** What these specs ask the loaders for: the domains without their verification records. */
const NO_DOMAINS = { reveal: false, routingTarget: null };

test.describe("what was seeded is what is read", () => {
  test("Apex: the primary Site's Draft and its Published version v1 are the approved website, and the second Site is private", async () => {
    const state = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadPrimaryWebsite(tx, ids.apex, NO_DOMAINS));
    expect(state?.published).toBe(true);
    expect(canonicalContent(state!.draft)).toBe(canonicalContent(versionOf(APEX_CONTENT)));
    expect(canonicalContent(state!.live!)).toBe(canonicalContent(versionOf(APEX_CONTENT)));
    expect(state?.live?.number).toBe(1);
    const sites = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => listSites(tx, ids.apex));
    expect(sites.map((site) => [site.slug, site.isPrimary, site.status, site.platformSlug])).toEqual([
      ["commercial", false, "draft", "apexclimate-commercial"],
      ["main", true, "published", "apexclimate"],
    ]);
    const second = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadWebsiteState(tx, ids.apex, sites.find((site) => site.slug === "commercial")!, NO_DOMAINS));
    expect(second?.published).toBe(false);
    expect(second?.live).toBeNull();
  });

  test("Northstar: its own Site comes back as seeded, through its own tenant only", async () => {
    const state = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadPrimaryWebsite(tx, ids.northstar, NO_DOMAINS));
    expect(canonicalContent(state!.live!)).toBe(canonicalContent(versionOf(NORTHSTAR_CONTENT)));
    // Through the same functions another business's Sites are invisible.
    expect(await withTenant({ userId: ids.taylor, organizationId: ids.apex }, (tx) => loadPrimaryWebsite(tx, ids.apex, NO_DOMAINS))).toBeNull();
    expect(await withTenant({ userId: ids.alex, organizationId: ids.northstar }, (tx) => loadPrimaryWebsite(tx, ids.northstar, NO_DOMAINS))).toBeNull();
  });

  test("Apex's listing is published and shows five of the six Services; Northstar's shows its own two", async () => {
    const apex = await marketplaceOf(ids.alex, ids.apex);
    expect(apex.status).toBe("published");
    expect(apex.slug).toBe("apex-climate-heating-air");
    expect(apex.config.selected).toEqual(APEX_LISTING.config.selected);
    expect(apex.config.selected).toHaveLength(5);
    expect(apex.config.selected).not.toContain("emergency-no-heat-no-cool");
    expect(apex.config.order).toHaveLength(6); // every eligible Service once: the selected ones first
    expect(apex.config).toEqual({ ...APEX_LISTING.config, order: apex.config.order });
    const northstar = await marketplaceOf(ids.taylor, ids.northstar);
    expect(northstar.config.selected).toEqual(NORTHSTAR_LISTING.config.selected);
    expect(northstar.config.contact.hours).toBe(false);
    expect(northstar.config.actions.contact).toBe(false);
    // Another business's listing is invisible to a person who is not a member.
    expect((await marketplaceOf(ids.taylor, ids.apex)).status).toBe("not-set-up");
    expect((await marketplaceOf(ids.alex, ids.northstar)).status).toBe("not-set-up");
  });
});

test.describe("identity and repeatability", () => {
  test("the sample Sites have deterministic ids, so a rebuilt database gives the same ones", async () => {
    const ofVersion = stableSiteIds(ids.apex, "main", "v1");
    const stored = await admin.query<{ id: string }>("select id from site_versions where organization_id = $1 and version_number = 1 and site_id = (select id from sites where organization_id = $1 and slug = 'main')", [ids.apex]);
    expect(stored.rows[0].id).toBe(ofVersion("version", "v1"));
    const hero = await admin.query<{ id: string }>(
      "select s.id from site_sections s join site_pages p on p.id = s.page_id where p.site_version_id = $1 and p.page_key = 'home' and s.section_key = 'hero'",
      [stored.rows[0].id],
    );
    expect(hero.rows[0].id).toBe(ofVersion("section", "home.hero"));
    expect(stableSiteIds(ids.northstar, "main", "v1")("version", "v1")).not.toBe(ofVersion("version", "v1"));
  });

  test("seeding again changes nothing: the same Sites, versions, pages, sections, listings and selections, with the same timestamps", async () => {
    const snapshot = async () =>
      (
        await admin.query(
          `select (select count(*)::int from sites where organization_id in ($1, $2)) as sites,
                  (select count(*)::int from site_versions where organization_id in ($1, $2)) as versions,
                  (select count(*)::int from site_pages where organization_id in ($1, $2)) as pages,
                  (select count(*)::int from site_sections where organization_id in ($1, $2)) as sections,
                  (select count(*)::int from marketplace_listings where organization_id in ($1, $2)) as listings,
                  (select count(*)::int from marketplace_listing_services where organization_id in ($1, $2)) as selections,
                  (select count(*)::int from site_templates) as templates,
                  (select max(updated_at)::text from sites where organization_id in ($1, $2)) as site_updated,
                  (select max(updated_at)::text from site_versions where organization_id in ($1, $2)) as version_updated,
                  (select max(updated_at)::text from site_sections where organization_id in ($1, $2)) as section_updated,
                  (select max(updated_at)::text from marketplace_listings where organization_id in ($1, $2)) as listing_updated,
                  (select string_agg(s.slug || ':' || s.platform_slug || ':' || s.status || ':' || (select count(*) from site_domains d where d.site_id = s.id), ',' order by s.organization_id, s.slug) from sites s where s.organization_id in ($1, $2)) as states`,
          [ids.apex, ids.northstar],
        )
      ).rows[0];
    const before = await snapshot();
    expect(before).toMatchObject({ sites: 3, versions: 5, pages: 25, sections: 110, listings: 2, selections: 7, templates: TEMPLATE_KEYS.length });
    await seedDevelopmentData();
    expect(await snapshot()).toEqual(before);
  });

  test("no business holds the same Site, page or section reference twice, and no public address is shared", async () => {
    expect((await admin.query("select organization_id, slug, count(*)::int as n from sites group by 1, 2 having count(*) > 1")).rows).toEqual([]);
    expect((await admin.query("select platform_slug, count(*)::int as n from sites group by 1 having count(*) > 1")).rows).toEqual([]);
    expect((await admin.query("select public_slug, count(*)::int as n from marketplace_listings group by 1 having count(*) > 1")).rows).toEqual([]);
    expect((await admin.query("select site_version_id, page_key, count(*)::int as n from site_pages group by 1, 2 having count(*) > 1")).rows).toEqual([]);
    expect((await admin.query("select page_id, section_key, count(*)::int as n from site_sections group by 1, 2 having count(*) > 1")).rows).toEqual([]);
    // Every Site has at most one Draft, and every published Site points at a published version of itself.
    expect((await admin.query("select site_id, count(*)::int as n from site_versions where status = 'draft' group by 1 having count(*) > 1")).rows).toEqual([]);
    expect(
      (
        await admin.query(
          "select s.id from sites s left join site_versions v on v.id = s.published_version_id and v.site_id = s.id and v.status = 'published' where (s.status = 'published') and v.id is null",
        )
      ).rows,
    ).toEqual([]);
  });
});

fixtures.describe("a test copy of the sample business", () => {
  fixtures("is restored to the seeded Sites, versions and listing, however a test changed them, extra Sites included", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const state = async () =>
      (
        await admin.query(
          `select (select count(*)::int from sites where organization_id = $1) as sites,
                  (select count(*)::int from site_versions where organization_id = $1) as versions,
                  (select count(*)::int from site_pages where organization_id = $1) as pages,
                  (select count(*)::int from site_sections where organization_id = $1) as sections,
                  (select count(*)::int from marketplace_listing_services where organization_id = $1) as selections,
                  (select string_agg(slug || ':' || status || ':' || (select count(*) from site_domains d where d.site_id = sites.id), ',' order by slug) from sites where organization_id = $1) as sites_state,
                  (select string_agg(status || ':' || description, ',') from marketplace_listings where organization_id = $1) as listing_state,
                  (select md5(string_agg(s.props::text, '|' order by s.site_id, p.page_key, s.section_key)) from site_sections s join site_pages p on p.id = s.page_id join site_versions v on v.id = p.site_version_id where s.organization_id = $1 and v.status = 'draft') as draft_text`,
          [org],
        )
      ).rows[0];
    const seeded = await state();
    expect(seeded).toMatchObject({ sites: 2, versions: 3, pages: 15, sections: 66, selections: 5 });

    // A test (or a person) changes things: a section is edited, a Site is made private, another Site is created, the listing is hidden.
    await admin.query("update site_sections set props = props || '{\"headline\": \"Changed\"}'::jsonb where organization_id = $1 and section_key = 'hero' and site_version_id in (select id from site_versions where status = 'draft')", [org]);
    await admin.query("update sites set status = 'draft', published_version_id = null where organization_id = $1 and slug = 'main'", [org]);
    await admin.query("insert into sites (organization_id, name, slug) values ($1, 'Extra', 'extra')", [org]);
    await admin.query("update marketplace_listings set status = 'hidden', description = 'Changed' where organization_id = $1", [org]);
    expect(await state()).not.toEqual(seeded);

    const { pool, db } = adminDb();
    try {
      await resetTestTenant(db, workerTenant);
    } finally {
      await pool.end();
    }
    expect(await state()).toEqual(seeded);
  });
});

fixtures.describe("the Marketplace operations, as the application runs them", () => {
  const operate = async <T>(tenant: { userId: string; organizationId: string }, work: (ctx: ListingContext) => Promise<T>) => {
    const slug = (await admin.query<{ slug: string }>("select slug from organizations where id = $1", [tenant.organizationId])).rows[0].slug;
    return withTenant(tenant, (tx) => work({ tx, organizationId: tenant.organizationId, organizationSlug: slug })).then(
      (value) => ({ value }),
      (error: unknown) => (error instanceof Refusal ? { refused: error.message } : { failed: error }),
    );
  };

  fixtures("saving changes only the listing: its text, cover, details, actions and Services, in the order given; the Services and the business are untouched", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = JSON.stringify((await admin.query("select slug, name, price_amount from services where organization_id = $1 order by slug", [org])).rows);
    const current = await marketplaceOf(workerTenant.userId, org);
    const config = {
      ...current.config,
      description: "A shorter description.",
      cover: "cool-slate" as const,
      selected: ["furnace-safety-inspection", "annual-cooling-tune-up"],
      order: ["furnace-safety-inspection", ...current.config.order.filter((id) => id !== "furnace-safety-inspection")],
      contact: { ...current.config.contact, phone: false },
      actions: { ...current.config.actions, contact: false },
    };
    const saved = await operate(workerTenant, (ctx) => saveListing(ctx, config, { publish: false }));
    expect(saved).toHaveProperty("value");
    const read = await marketplaceOf(workerTenant.userId, org);
    expect(read.status).toBe("published");
    expect(read.config).toMatchObject({ description: "A shorter description.", cover: "cool-slate", selected: ["furnace-safety-inspection", "annual-cooling-tune-up"], contact: { phone: false }, actions: { contact: false } });
    expect(JSON.stringify((await admin.query("select slug, name, price_amount from services where organization_id = $1 order by slug", [org])).rows)).toBe(before);
    expect((await admin.query("select count(*)::int as n from marketplace_listing_services where organization_id = $1", [org])).rows[0].n).toBe(2);
  });

  fixtures("a Service of another business, an unknown Service, a retired one and an internal one cannot be selected, and a refused save changes nothing", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const current = await marketplaceOf(workerTenant.userId, org);
    const stored = async () => JSON.stringify((await admin.query("select ls.sort_order, s.slug from marketplace_listing_services ls join services s on s.id = ls.service_id and s.organization_id = ls.organization_id where ls.organization_id = $1 order by ls.sort_order", [org])).rows);
    const before = await stored();
    await admin.query("update services set is_active = false where organization_id = $1 and slug = 'furnace-safety-inspection'", [org]);
    await admin.query("update services set visibility = 'internal' where organization_id = $1 and slug = 'ac-repair-diagnostics'", [org]);
    for (const slug of ["furnace-tune-up", "radiant-heat-estimate", "does-not-exist", "furnace-safety-inspection", "ac-repair-diagnostics"]) {
      const result = await operate(workerTenant, (ctx) => saveListing(ctx, { ...current.config, selected: ["annual-cooling-tune-up", slug], order: [...current.config.order, slug] }, { publish: false }));
      expect(result, slug).toHaveProperty("refused");
      expect(await stored(), slug).toBe(before);
    }
  });

  fixtures("hiding keeps the whole configuration and the first publication time; publishing shows it again", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const first = (await admin.query<{ published_at: Date }>("select published_at from marketplace_listings where organization_id = $1", [org])).rows[0].published_at;
    const configBefore = (await marketplaceOf(workerTenant.userId, org)).config;
    expect(await operate(workerTenant, (ctx) => setListingStatus(ctx, "hidden"))).toHaveProperty("value");
    expect((await marketplaceOf(workerTenant.userId, org)).status).toBe("hidden");
    expect((await marketplaceOf(workerTenant.userId, org)).config).toEqual(configBefore);
    expect(await operate(workerTenant, (ctx) => setListingStatus(ctx, "published"))).toHaveProperty("value");
    expect((await marketplaceOf(workerTenant.userId, org)).status).toBe("published");
    expect((await admin.query<{ published_at: Date }>("select published_at from marketplace_listings where organization_id = $1", [org])).rows[0].published_at).toEqual(first);
  });

  fixtures("a business with no listing is 'not set up'; setting up creates and publishes it at an address of its own, once", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    await admin.query("delete from marketplace_listing_services where organization_id = $1", [org]);
    await admin.query("delete from marketplace_listings where organization_id = $1", [org]);
    const empty = await marketplaceOf(workerTenant.userId, org);
    expect(empty.status).toBe("not-set-up");
    expect(empty.slug).toBeUndefined();
    expect(empty.config.selected).toEqual(getEligibleServices(await withTenant({ userId: workerTenant.userId, organizationId: org }, (tx) => loadServices(tx, org))).map((service) => service.id));
    // Saving as a draft needs a listing to exist; setting up creates it.
    expect(await operate(workerTenant, (ctx) => saveListing(ctx, empty.config, { publish: false }))).toHaveProperty("refused");
    expect(await operate(workerTenant, (ctx) => saveListing(ctx, empty.config, { publish: true }))).toHaveProperty("value");
    const created = await marketplaceOf(workerTenant.userId, org);
    expect(created.status).toBe("published");
    expect(created.slug).toMatch(/^apex-e2e-\d+$/);
    expect(await withTenant({ userId: workerTenant.userId, organizationId: org }, (tx) => findListing(tx, org))).toMatchObject({ publicSlug: created.slug, status: "published" });
  });

  fixtures("people who are not owners or admins of the business cannot change its listing or set one up", async ({ workerTenant }) => {
    const org = workerTenant.organizationId;
    const current = await marketplaceOf(workerTenant.userId, org);
    // Taylor and Jamie are not members of this copy of the business at all: they see no listing and can write none.
    for (const outsider of [ids.taylor, ids.jamie]) {
      expect((await marketplaceOf(outsider, org)).status).toBe("not-set-up");
      const result = await operate({ userId: outsider, organizationId: org }, (ctx) => saveListing(ctx, { ...current.config, description: "Hijacked" }, { publish: false }));
      expect(result).toHaveProperty("refused");
    }
    await admin.query("delete from marketplace_listing_services where organization_id = $1", [org]);
    await admin.query("delete from marketplace_listings where organization_id = $1", [org]);
    for (const outsider of [ids.taylor, ids.jamie]) {
      // They cannot even see the business's Services, so the save is refused before anything is written (and the database would refuse it too).
      const result = await operate({ userId: outsider, organizationId: org }, (ctx) => saveListing(ctx, current.config, { publish: true }));
      expect(["refused", "failed"]).toContain(Object.keys(result)[0]);
    }
    expect((await admin.query("select count(*)::int as n from marketplace_listings where organization_id = $1", [org])).rows[0].n).toBe(0);
    // And a Site cannot be created in a business by someone who is not a member of it.
    const site = await withTenant({ userId: ids.taylor, organizationId: org }, (tx) => createSite(tx, org, { name: "Hijack", slug: "hijack", platformSlug: "hijack-site" })).then(
      () => "created",
      () => "refused",
    );
    expect(site).toBe("refused");
    expect((await admin.query("select count(*)::int as n from sites where organization_id = $1 and slug = 'hijack'", [org])).rows[0].n).toBe(0);
  });
});
