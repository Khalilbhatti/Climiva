/**
 * Phase 15: the published website and listing as a visitor meets them, and the signed-in Draft preview, through the running application.
 *
 *   - the public pages: what they show, what they never show, the same "not found" for a site that is private or does not exist, no
 *     organization taken from the browser, no shared cache;
 *   - what stays live-bound: the business's own record and its Services are read when a page is drawn, so a rename or a new price needs no
 *     republish (the published STRUCTURE is the snapshot; this is documented in docs/saas-architecture.md, section 28);
 *   - a visitor's booking: the business is the Site's, a forged or ineligible request is refused, a repeat is one booking, a script is slowed;
 *   - the Draft preview: only for people signed in to the business, only their own Draft;
 *   - a new business: a private Site with a Draft of neutral copy, no listing, and an address of its own;
 *   - the client bundle: none of any business's website or listing copy is compiled into the browser's JavaScript.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Page } from "playwright/test";
import { DEFAULT_DESCRIPTION } from "../src/data/marketplace";
import { DEFAULT_TEMPLATE } from "../src/db/default-template";
import { loadPublicSite } from "../src/db/public-queries";
import { publishSite, saveDraftPage, unpublishSite } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { NORTHSTAR_LISTING, NORTHSTAR_CONTENT } from "../scripts/db/seed-data/website";
import { APEX_CONTENT, APEX_LISTING, SERVICES } from "./apex-data";
import { captureAction, type Captured } from "./replay";
import { completeOnboarding, expect, NOT_SIGNED_IN, ORIGIN, signUp, test } from "./saas";

/** The text a visitor could read on a page: tags, scripts and styles removed, entities decoded. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

const APEX = { name: "Apex Climate Heating & Air", phone: "(555) 392-8100", email: "service@apexclimate.com", street: "4820 East Riverside Dr" };
const NORTHSTAR = { name: "Northstar Heating & Cooling", phone: "(555) 410-7788", email: "office@northstar-hvac.test" };
const APEX_PAGES = ["", "/services", "/about", "/contact", "/booking"];

async function get(api: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  const response = await api.get(path, { maxRedirects: 0, headers });
  return { status: response.status(), headers: response.headers(), body: await response.text() };
}

const idOf = async (db: import("pg").Pool, sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;

test.describe("the published website, for anyone", () => {
  test("every page of a published site is served to a visitor with no session, the approved words and the business's own record", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    const home = await get(visitor, "/sites/apexclimate");
    expect(home.status).toBe(200);
    const text = visibleText(home.body);
    expect(text).toContain("Heating & cooling service when you need it.");
    expect(text).toContain("Book HVAC maintenance, diagnostics, and repair services with Apex Climate Heating & Air.");
    expect(text).toContain("Why customers choose Apex Climate");
    for (const service of SERVICES) expect(text, service.name).toContain(service.name);
    expect(text).toContain("$89 diagnostic fee");
    for (const path of APEX_PAGES.slice(1)) {
      const page = await get(visitor, `/sites/apexclimate${path}`);
      expect(page.status, path).toBe(200);
      expect(visibleText(page.body), path).toContain(APEX.name);
    }
    const contact = visibleText((await get(visitor, "/sites/apexclimate/contact")).body);
    for (const value of [APEX.phone, APEX.email, "4820 East Riverside Dr, Suite 110", "Austin, TX 78741", "Mon–Fri", "7:30 AM–6:00 PM", "Sun Closed"]) expect(contact, value).toContain(value);
  });

  test("the published site is not the workspace: no shell, no editor, no preview chrome, no one's name", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    for (const path of APEX_PAGES) {
      const { body } = await get(visitor, `/sites/apexclimate${path}`);
      const text = visibleText(body);
      for (const forbidden of ["Alex Morgan", "Operations Lead", "Quotes & Invoices", "Maintenance Plans", "Back to editor", "Preview", "Unpublished", "Draft", "Sarah Mitchell", "Skip to main content"]) {
        expect(text, `${path}: ${forbidden}`).not.toContain(forbidden);
      }
      expect(body, path).not.toMatch(/data-testid="(workspace|sidebar)/);
    }
  });

  test("a page is never cached anywhere shared: every response says so", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    for (const path of ["/sites/apexclimate", "/sites/apexclimate/services", "/sites/apexclimate/booking/annual-cooling-tune-up", "/listings/apex-climate-heating-air", "/sites/nobody"]) {
      const { headers } = await get(visitor, path);
      const cache = headers["cache-control"] ?? "";
      expect(cache, path).toMatch(/no-store/);
      expect(cache, path).not.toMatch(/public|s-maxage|max-age=[1-9]/);
      expect(headers["set-cookie"], path).toBeUndefined();
    }
  });

  test("a site that is private, unknown or misspelt is the same 'not found', with nothing to tell them apart", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    const pages = [
      await get(visitor, "/sites/apexclimate-commercial"), // exists, never published
      await get(visitor, "/sites/nobody-at-all"),
      await get(visitor, "/sites/APEXCLIMATE-COMMERCIAL"),
    ];
    for (const page of pages) expect(page.status).toBe(404);
    const [first, second, third] = pages.map((page) => visibleText(page.body));
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).not.toMatch(/Apex|private|unpublished|draft/i);
  });

  test("an address the site does not have is not found: an unknown page, a page under a page, an unknown or hidden Service", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    for (const path of ["/sites/apexclimate/nope", "/sites/apexclimate/about/extra", "/sites/apexclimate/booking/a/b", "/sites/apexclimate/services/ac-repair-diagnostics", "/sites/apexclimate/%00", "/sites/apexclimate/..%2fnorthstar"]) {
      expect([400, 404], path).toContain((await get(visitor, path)).status);
    }
    // A Service that is not on the site is explained, not an error page.
    const unknown = await get(visitor, "/sites/apexclimate/booking/nothing-here");
    expect(visibleText(unknown.body)).toContain("Service not found");
    for (const path of ["/listings/nobody", "/listings/apex-climate-heating-air/extra"]) expect((await get(visitor, path)).status, path).toBe(404);
  });

  test("no organization can be named from the browser: a query, a header or a cookie changes nothing", async ({ apiAs, db }) => {
    const visitor = await apiAs(null);
    const northstar = await idOf(db, "select id from organizations where slug = 'northstar-heating-cooling'");
    const apex = await idOf(db, "select id from organizations where slug = 'apex-climate-heating-air'");
    const plain = await get(visitor, "/sites/apexclimate");
    // In the address (the page may echo its own address back, so this one is checked by what a visitor reads).
    const inTheAddress = await get(visitor, `/sites/apexclimate?organizationId=${northstar}&organization_id=${northstar}&org=${northstar}&site=northstar`);
    expect(inTheAddress.status).toBe(200);
    expect(visibleText(inTheAddress.body)).toBe(visibleText(plain.body));
    // In a header or a cookie.
    const forged = await get(visitor, "/sites/apexclimate", {
      "x-organization-id": northstar,
      "x-org": northstar,
      cookie: `climvia_org=${northstar}; organization_id=${northstar}`,
    });
    expect(forged.status).toBe(200);
    expect(visibleText(forged.body)).toBe(visibleText(plain.body));
    expect(forged.body).not.toContain(northstar);
    expect(forged.body).not.toContain(apex);
    const asNorthstar = await get(visitor, "/sites/northstar", { cookie: `climvia_org=${apex}` });
    expect(visibleText(asNorthstar.body)).toContain(NORTHSTAR.name);
    expect(visibleText(asNorthstar.body)).not.toContain(APEX.name);
  });

  test("no business's id, no table name and no internal field appears in a page's HTML", async ({ apiAs, db }) => {
    const visitor = await apiAs(null);
    const ids = (await db.query<{ id: string }>("select id from organizations where slug in ('apex-climate-heating-air', 'northstar-heating-cooling')")).rows.map((row) => row.id);
    const siteIds = (await db.query<{ id: string }>("select id from sites where organization_id = any($1)", [ids])).rows.map((row) => row.id);
    for (const path of ["/sites/apexclimate", "/sites/apexclimate/services", "/sites/northstar", "/listings/apex-climate-heating-air"]) {
      const { body } = await get(visitor, path);
      for (const secret of [...ids, ...siteIds]) expect(body, `${path}: ${secret}`).not.toContain(secret);
      for (const internal of ["organization_id", "organizationId", "internalDescription", "publishedVersionId", "published_version_id", "site_versions", "DATABASE_URL", "BETTER_AUTH"]) {
        expect(body, `${path}: ${internal}`).not.toContain(internal);
      }
    }
  });
});

test.describe("one business never shows another's website", () => {
  test("Northstar's site is its own words, colour, details and Services; Apex's carries none of them and the reverse", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    const northstar = await get(visitor, "/sites/northstar");
    expect(northstar.status).toBe(200);
    const northstarText = visibleText(northstar.body);
    expect(northstarText).toContain("Denver's heating and cooling crew.");
    expect(northstarText).toContain(NORTHSTAR.name);
    expect(northstar.body).toContain("#1F5FAF");
    expect(northstarText).not.toContain("Business hours"); // its hours card is switched off on the home page
    const northstarContact = visibleText((await get(visitor, "/sites/northstar/contact")).body);
    expect(northstarContact).toContain(NORTHSTAR.phone);
    expect(northstarContact).toContain(NORTHSTAR.email);
    const apex = visibleText((await get(visitor, "/sites/apexclimate")).body);
    for (const own of ["Heating & cooling service when you need it.", APEX.name]) expect(apex).toContain(own);
    for (const foreign of ["Denver's heating and cooling crew.", NORTHSTAR.name, NORTHSTAR.phone, NORTHSTAR.email]) expect(apex, foreign).not.toContain(foreign);
    for (const foreign of [APEX.name, APEX.phone, APEX.email, "Heating & cooling service when you need it.", "Why customers choose Apex Climate"]) expect(northstarText + northstarContact, foreign).not.toContain(foreign);
  });

  test("a Service of one business is never booked from another's site", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    // Furnace Tune-Up is Northstar's; Annual Cooling Tune-Up is Apex's.
    expect(visibleText((await get(visitor, "/sites/apexclimate/booking/furnace-tune-up")).body)).toContain("Service not found");
    expect(visibleText((await get(visitor, "/sites/northstar/booking/annual-cooling-tune-up")).body)).toContain("Service not found");
    const northstarServices = visibleText((await get(visitor, "/sites/northstar/services")).body);
    expect(northstarServices).not.toContain("Annual Cooling Tune-Up");
    expect(northstarServices).toContain("Furnace");
  });
});

test.describe("the Draft and the Published version", () => {
  const tenantOf = (workerTenant: { userId: string; organizationId: string }) => ({ userId: workerTenant.userId, organizationId: workerTenant.organizationId });
  const siteOf = async (db: import("pg").Pool, organizationId: string) => idOf(db, "select id from sites where organization_id = $1 and slug = 'main'", [organizationId]);

  async function setHeadline(workerTenant: { userId: string; organizationId: string }, db: import("pg").Pool, headline: string) {
    const site = await siteOf(db, workerTenant.organizationId);
    const hero = (await db.query<{ props: Record<string, string> }>(
      `select s.props from site_sections s join site_pages p on p.id = s.page_id join site_versions v on v.id = p.site_version_id
        where v.site_id = $1 and v.status = 'draft' and p.page_key = 'home' and s.section_key = 'hero'`,
      [site],
    )).rows[0].props;
    await withTenant(tenantOf(workerTenant), (tx) => saveDraftPage({ tx, organizationId: workerTenant.organizationId }, site, "home", { sections: { hero: { visible: true, props: { ...hero, headline } } } }));
  }

  test("a saved Draft is never public: only the signed-in owner's preview shows it, and Publish is what a visitor sees", async ({ page, workerTenant, db, apiAs }) => {
    const visitor = await apiAs(null);
    const slug = workerTenant.platformSlug;
    await setHeadline(workerTenant, db, "Draft only headline");

    expect(visibleText((await get(visitor, `/sites/${slug}`)).body)).not.toContain("Draft only headline");
    expect(visibleText((await get(visitor, `/sites/${slug}`)).body)).toContain("Heating & cooling service when you need it.");
    // The signed-in preview is the Draft.
    await page.goto("/website/preview");
    await expect(page.getByRole("heading", { level: 1, name: "Draft only headline" })).toBeVisible();
    // A visitor cannot reach the preview.
    const blocked = await get(visitor, "/website/preview");
    expect(blocked.status).toBe(307);
    expect(blocked.headers.location).toContain("/login");
    expect(blocked.body).not.toContain("Draft only headline");

    // Publishing is what changes the public page, at once.
    await withTenant(tenantOf(workerTenant), async (tx) => {
      const site = await siteOf(db, workerTenant.organizationId);
      await publishSite({ tx, organizationId: workerTenant.organizationId }, site, workerTenant.userId);
    });
    expect(visibleText((await get(visitor, `/sites/${slug}`)).body)).toContain("Draft only headline");
  });

  test("making a Site private takes it down at once, and its listing no longer links to it", async ({ workerTenant, db, apiAs }) => {
    const visitor = await apiAs(null);
    const slug = workerTenant.platformSlug;
    const listing = `/listings/${workerTenant.listingSlug}`;
    expect((await get(visitor, `/sites/${slug}`)).status).toBe(200);
    expect(visibleText((await get(visitor, listing)).body)).toContain("View website");
    await withTenant(tenantOf(workerTenant), async (tx) => unpublishSite({ tx, organizationId: workerTenant.organizationId }, await siteOf(db, workerTenant.organizationId)));
    expect((await get(visitor, `/sites/${slug}`)).status).toBe(404);
    expect((await get(visitor, `/sites/${slug}/services`)).status).toBe(404);
    const afterwards = await get(visitor, listing);
    expect(afterwards.status).toBe(200);
    expect(afterwards.body).not.toContain(`/sites/${slug}`);
  });

  test("the preview shows the signed-in person's own Draft and nobody else's", async ({ openAs }) => {
    const taylor = await openAs("taylor");
    await taylor.page.goto("/website/preview");
    await expect(taylor.page.getByRole("heading", { level: 1, name: "Denver's heating and cooling crew." })).toBeVisible();
    const text = await taylor.page.locator("body").innerText();
    for (const foreign of [APEX.name, APEX.phone, "Heating & cooling service when you need it.", "Why customers choose Apex Climate"]) expect(text, foreign).not.toContain(foreign);
    // An Apex-only Service journey is not found for Taylor.
    const response = await taylor.page.goto("/website/preview/booking/annual-cooling-tune-up");
    expect([200, 404]).toContain(response?.status());
    expect(await taylor.page.locator("body").innerText()).not.toContain("Annual Cooling Tune-Up");
    await taylor.context.close();
  });

  test("older preview links still work: the live view is the published site, and an address that names nothing is not found", async ({ apiAs, workerTenant }) => {
    const owner = await apiAs("alex");
    const slug = workerTenant.platformSlug;
    void slug;
    const live = await get(owner, "/website/preview?view=live");
    expect(live.status).toBe(307);
    expect(live.headers.location).toMatch(/\/sites\/apexclimate(?!\w)/);
    const liveServices = await get(owner, "/website/preview/services?view=live");
    expect(liveServices.headers.location).toMatch(/\/sites\/apexclimate\/services$/);
    expect((await get(owner, "/website/preview/nope")).status).toBe(404);
  });
});

test.describe("what a page reads live from the business", () => {
  test("a renamed business, a new phone number, a new address and new hours show on the published site with no republish", async ({ workerTenant, db, apiAs }) => {
    const visitor = await apiAs(null);
    const slug = workerTenant.platformSlug;
    await db.query("update organizations set name = 'Rebranded Air Co', phone = '(555) 010-2020', email = 'new@rebranded.test', address_line1 = '9 New Road', city = 'Dallas', state_region = 'TX' where id = $1", [workerTenant.organizationId]);
    await db.query("update organization_business_hours set is_open = false, opens_at = null, closes_at = null where organization_id = $1 and day_of_week = 6", [workerTenant.organizationId]);
    const home = visibleText((await get(visitor, `/sites/${slug}`)).body);
    expect(home).toContain("Book HVAC maintenance, diagnostics, and repair services with Rebranded Air Co.");
    expect(home).toContain("Heating and cooling specialists serving Dallas, TX.");
    expect(home).not.toContain("Apex Climate Heating & Air");
    const contact = visibleText((await get(visitor, `/sites/${slug}/contact`)).body);
    for (const value of ["(555) 010-2020", "new@rebranded.test", "9 New Road", "Dallas, TX"]) expect(contact, value).toContain(value);
    expect(contact).not.toContain(APEX.phone);
    expect(contact).toMatch(/Sat–Sun\s+Closed/);
    // The published version is the same one: a rename is not a new version.
    expect((await loadPublicSite(slug, ""))?.version.number).toBe(1);
  });

  test("a Service's new price and a retired Service show at once; the Services themselves are the catalog, never the website's copy", async ({ workerTenant, db, apiAs }) => {
    const visitor = await apiAs(null);
    const slug = workerTenant.platformSlug;
    await db.query("update services set price_amount = 199 where organization_id = $1 and slug = 'annual-cooling-tune-up'", [workerTenant.organizationId]);
    await db.query("update services set is_active = false where organization_id = $1 and slug = 'furnace-safety-inspection'", [workerTenant.organizationId]);
    await db.query("update services set visibility = 'internal' where organization_id = $1 and slug = 'ductless-mini-split-estimate'", [workerTenant.organizationId]);
    const services = visibleText((await get(visitor, `/sites/${slug}/services`)).body);
    expect(services).toContain("$199 fixed price");
    expect(services).not.toContain("$129 fixed price");
    expect(services).not.toContain("Furnace Safety Inspection & Tune-Up");
    expect(services).not.toContain("Ductless Mini-Split");
    expect(services).toContain("AC Repair & Diagnostics");
    expect(visibleText((await get(visitor, `/sites/${slug}/booking/furnace-safety-inspection`)).body)).toContain("Service not found");
    expect(visibleText((await get(visitor, `/sites/${slug}/booking/ductless-mini-split-estimate`)).body)).toContain("Service not found");
    // The website holds a list of references, never a copy: no service name or price is in a stored section.
    const stored = (await db.query<{ props: unknown }>("select props from site_sections where organization_id = $1", [workerTenant.organizationId])).rows.map((row) => JSON.stringify(row.props)).join(" ");
    for (const service of SERVICES) expect(stored, service.name).not.toContain(service.name);
  });

  test("the Services a site hides, and the order it shows, are the Draft's until published; the catalog is untouched", async ({ workerTenant, db, apiAs }) => {
    const visitor = await apiAs(null);
    const slug = workerTenant.platformSlug;
    const site = await idOf(db, "select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId]);
    const catalog = JSON.stringify((await db.query("select slug, name, price_amount, is_active, visibility from services where organization_id = $1 order by slug", [workerTenant.organizationId])).rows);
    await db.query("update site_versions set settings = $2::jsonb where site_id = $1 and status = 'draft'", [site, JSON.stringify({ serviceDisplay: { order: ["furnace-safety-inspection"], hidden: ["annual-cooling-tune-up"] } })]);
    expect(visibleText((await get(visitor, `/sites/${slug}/services`)).body)).toContain("Annual Cooling Tune-Up & Maintenance");
    await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, (tx) => publishSite({ tx, organizationId: workerTenant.organizationId }, site, workerTenant.userId));
    const after = visibleText((await get(visitor, `/sites/${slug}/services`)).body);
    expect(after).not.toContain("Annual Cooling Tune-Up & Maintenance");
    expect(after.indexOf("Furnace Safety Inspection")).toBeLessThan(after.indexOf("AC Repair & Diagnostics"));
    expect(JSON.stringify((await db.query("select slug, name, price_amount, is_active, visibility from services where organization_id = $1 order by slug", [workerTenant.organizationId])).rows)).toBe(catalog);
  });
});

test.describe("the Marketplace listing, for anyone", () => {
  test("the published listing shows five of Apex's six Services, never Emergency, and only the details it switches on", async ({ apiAs }) => {
    const visitor = await apiAs(null);
    const listing = await get(visitor, "/listings/apex-climate-heating-air");
    expect(listing.status).toBe(200);
    const text = visibleText(listing.body);
    expect(text).toContain(APEX.name);
    expect(text).toContain(APEX_LISTING.config.description);
    for (const service of SERVICES.filter((candidate) => candidate.id !== "emergency-no-heat-no-cool")) expect(text, service.name).toContain(service.name);
    expect(text).not.toContain("Emergency No-Heat / No-Cool Service");
    expect(text).not.toContain("Cooling maintenance");
    expect(listing.body).toContain("/sites/apexclimate");
    const northstar = visibleText((await get(visitor, "/listings/northstar-heating-cooling")).body);
    expect(northstar).toContain(NORTHSTAR_LISTING.config.description);
    expect(northstar).toContain("Furnace");
    expect(northstar).not.toContain(APEX.name);
    expect(northstar).not.toContain("Radiant");
    expect(text).not.toContain(NORTHSTAR.name);
  });

  test("a hidden listing, a retired Service and a contact detail switched off all follow at once", async ({ workerTenant, db, apiAs }) => {
    const visitor = await apiAs(null);
    const path = `/listings/${workerTenant.listingSlug}`;
    expect(visibleText((await get(visitor, path)).body)).toContain(APEX.phone);
    await db.query("update marketplace_listings set show_phone = false, show_email = false where organization_id = $1", [workerTenant.organizationId]);
    const quieter = visibleText((await get(visitor, path)).body);
    expect(quieter).not.toContain(APEX.phone);
    expect(quieter).not.toContain(APEX.email);
    expect(quieter).toContain("Annual Cooling Tune-Up");
    await db.query("update services set is_active = false where organization_id = $1 and slug = 'annual-cooling-tune-up'", [workerTenant.organizationId]);
    expect(visibleText((await get(visitor, path)).body)).not.toContain("Annual Cooling Tune-Up");
    await db.query("update marketplace_listings set status = 'hidden' where organization_id = $1", [workerTenant.organizationId]);
    expect((await get(visitor, path)).status).toBe(404);
  });
});

test.describe("a visitor's booking", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  const fill = async (page: Page, name = "Jordan Visitor", email = "jordan.visitor@example.test") => {
    await page.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await page.getByRole("radio", { name: /^11:30 AM/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill(name);
    await page.getByLabel(/^Phone number/).fill("(512) 555-0111");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Service address/).fill("1402 South Congress Ave, Austin, TX 78704");
  };

  const bookingsOf = async (db: import("pg").Pool, organizationId: string, email: string) =>
    (await db.query("select b.number, b.status, b.source, b.customer_id, b.contact_name, b.submission_key, b.organization_id, s.slug as service from bookings b join services s on s.id = b.service_id and s.organization_id = b.organization_id where b.organization_id = $1 and b.contact_email = $2 order by b.number", [organizationId, email])).rows;

  /** Make a real booking through the page and capture the call the page sent. */
  async function bookThroughThePage(page: Page, workerTenant: { platformSlug: string }, email: string): Promise<Captured> {
    await page.goto(`/sites/${workerTenant.platformSlug}/booking/annual-cooling-tune-up`);
    await expect(page.getByRole("heading", { name: "Choose a date and time" })).toBeVisible();
    await fill(page, "Jordan Visitor", email);
    return captureAction(page, () => page.getByRole("button", { name: "Confirm booking" }).click());
  }

  const post = (api: APIRequestContext, captured: Captured, body: string, forwardedFor?: string) =>
    api.post(captured.url, { headers: { ...captured.headers, origin: ORIGIN, ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) }, data: body });

  const edited = (captured: Captured, change: (argument: Record<string, unknown>) => void): string => {
    const args = JSON.parse(captured.body) as Record<string, unknown>[];
    const first = { ...args[0] };
    change(first);
    return JSON.stringify([first, ...args.slice(1)]);
  };

  test("a visitor books from the published site: the booking is the site's business's, an instant one is confirmed, with no customer and no job", async ({ page, workerTenant, db }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/sites/${workerTenant.platformSlug}/booking/annual-cooling-tune-up`);
    await expect(page.getByText("Instant booking · 60 mins")).toBeVisible();
    await fill(page, "Jordan Visitor", email);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    const done = page.getByRole("region", { name: "Instant booking confirmed" });
    await expect(done).toContainText("Booking reference");
    await expect(done).toContainText(/BK-\d{4}/);
    await expect(done).toContainText("Tue, Oct 29 · 11:30 AM – 12:30 PM");
    await expect(done).toContainText("$129 fixed price");

    const rows = await bookingsOf(db, workerTenant.organizationId, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "confirmed", source: "Website", customer_id: null, contact_name: "Jordan Visitor", service: "annual-cooling-tune-up", organization_id: workerTenant.organizationId });
    // The booking took the next number of this business's own counter, and no job, quote, invoice or payment came with it.
    expect(await db.query("select 1 from jobs where organization_id = $1 and booking_id = (select id from bookings where organization_id = $1 and contact_email = $2)", [workerTenant.organizationId, email]).then((result) => result.rowCount)).toBe(0);
    // And the visitor sees nothing of the business's other bookings: the page held only a reference.
    expect(await page.locator("body").innerText()).not.toMatch(/Sarah Mitchell|David Chen/);
  });

  test("a request-appointment Service is pending; the owner sees the booking in Bookings, from the website", async ({ page, workerTenant, db, browser }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/sites/${workerTenant.platformSlug}/booking/ac-repair-diagnostics`);
    await page.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await page.getByRole("radio", { name: /^Midday/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill("Casey Visitor");
    await page.getByLabel(/^Phone number/).fill("(512) 555-0112");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Service address/).fill("5 Barton Hills Dr, Austin, TX 78704");
    await page.getByLabel(/primary cooling issue/).selectOption("Blowing warm air");
    await page.getByRole("button", { name: "Submit appointment request" }).click();
    await expect(page.getByRole("region", { name: "Appointment request submitted" })).toContainText(/BK-\d{4}/);
    expect(await bookingsOf(db, workerTenant.organizationId, email)).toMatchObject([{ status: "pending", source: "Website", customer_id: null }]);

    const staff = await browser.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState, extraHTTPHeaders: { "x-forwarded-for": `fd00:${process.pid.toString(16)}:${randomBytes(2).toString("hex")}::7` } });
    try {
      const owner = await staff.newPage();
      await owner.goto("/bookings");
      const row = owner.getByRole("table", { name: "Requests bookings" }).locator("tbody tr", { hasText: "Casey Visitor" });
      await expect(row).toContainText("AC Repair & Diagnostics");
      await expect(row).toContainText("Website");
      await expect(row).toContainText("Pending");
    } finally {
      await staff.close();
    }
  });

  test("the business is the Site's, whatever the request says: a business named in it is ignored, and no booking appears in another business", async ({ page, workerTenant, db, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await bookThroughThePage(page, workerTenant, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const northstar = await idOf(db, "select id from organizations where slug = 'northstar-heating-cooling'");
    const before = (await db.query("select count(*)::int as n from bookings where organization_id = $1", [northstar])).rows[0].n;
    const api = await apiAs(null);
    const forgedEmail = `forged-${randomBytes(3).toString("hex")}@example.test`;
    const response = await post(
      api,
      captured,
      edited(captured, (argument) => {
        Object.assign(argument, { organizationId: northstar, organization_id: northstar, orgId: northstar, submissionKey: `forged-key-${randomBytes(4).toString("hex")}`, email: forgedEmail, start: "14:00", end: "15:00" });
      }),
    );
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/BK-\d{4}/);
    expect((await db.query("select count(*)::int as n from bookings where organization_id = $1", [northstar])).rows[0].n).toBe(before);
    expect(await bookingsOf(db, northstar, forgedEmail)).toEqual([]);
    expect(await bookingsOf(db, workerTenant.organizationId, forgedEmail)).toHaveLength(1);
  });

  test("a Service the site's business does not offer online is refused, however it is named: another business's, unknown, retired, internal or listed only", async ({ page, workerTenant, db, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await bookThroughThePage(page, workerTenant, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const api = await apiAs(null);
    const attempt = async (serviceSlug: string) => {
      const forgedEmail = `forged-${randomBytes(3).toString("hex")}@example.test`;
      const response = await post(api, captured, edited(captured, (argument) => Object.assign(argument, { serviceSlug, submissionKey: `forged-key-${randomBytes(4).toString("hex")}`, email: forgedEmail })));
      return { text: await response.text(), rows: await bookingsOf(db, workerTenant.organizationId, forgedEmail) };
    };
    for (const slug of ["furnace-tune-up", "radiant-heat-estimate", "does-not-exist", "../etc/passwd", "UPPER"]) {
      const result = await attempt(slug);
      expect(result.rows, slug).toEqual([]);
      expect(result.text, slug).toMatch(/isn't available to book online|not understood/);
    }
    await db.query("update services set is_active = false where organization_id = $1 and slug = 'furnace-safety-inspection'", [workerTenant.organizationId]);
    await db.query("update services set visibility = 'internal' where organization_id = $1 and slug = 'ac-repair-diagnostics'", [workerTenant.organizationId]);
    await db.query("update services set visibility = 'public-only' where organization_id = $1 and slug = 'heat-pump-diagnostics-repair'", [workerTenant.organizationId]);
    for (const slug of ["furnace-safety-inspection", "ac-repair-diagnostics", "heat-pump-diagnostics-repair"]) {
      const result = await attempt(slug);
      expect(result.rows, slug).toEqual([]);
      expect(result.text, slug).toContain("isn't available to book online");
    }
  });

  test("a site that is private, or does not exist, takes no booking", async ({ page, workerTenant, db, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await bookThroughThePage(page, workerTenant, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const api = await apiAs(null);
    const attempt = async (siteSlug: string) => {
      const forgedEmail = `forged-${randomBytes(3).toString("hex")}@example.test`;
      const response = await post(api, captured, edited(captured, (argument) => Object.assign(argument, { siteSlug, submissionKey: `forged-key-${randomBytes(4).toString("hex")}`, email: forgedEmail })));
      return { text: await response.text(), forgedEmail };
    };
    for (const slug of ["nobody-at-all", "apexclimate-commercial"]) {
      const result = await attempt(slug);
      expect(result.text, slug).toContain("isn't taking bookings right now");
    }
    await withTenant({ userId: workerTenant.userId, organizationId: workerTenant.organizationId }, async (tx) =>
      unpublishSite({ tx, organizationId: workerTenant.organizationId }, await idOf(db, "select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId])),
    );
    const result = await attempt(workerTenant.platformSlug);
    expect(result.text).toContain("isn't taking bookings right now");
    expect(await bookingsOf(db, workerTenant.organizationId, result.forgedEmail)).toEqual([]);
  });

  test("a time the business does not offer, bad details and extra fields are refused with a safe message and no booking", async ({ page, workerTenant, db, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await bookThroughThePage(page, workerTenant, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const api = await apiAs(null);
    const attempts: [string, Record<string, unknown>, RegExp][] = [
      ["a Sunday: closed", { date: "2024-10-27" }, /closed|Choose another date/i],
      ["a day in the past", { date: "2024-10-20" }, /already passed|Choose another date/i],
      ["a time that is not one of the Service's slots", { start: "09:15", end: "10:15" }, /Select an available time/],
      ["a late Saturday slot after closing", { date: "2024-10-26", start: "16:00", end: "17:00" }, /Select an available time/],
      ["a name that is markup", { name: "<script>alert(1)</script>" }, /Check the highlighted fields|Enter your full name/],
      ["a phone number that is too short", { phone: "123" }, /Check the highlighted fields/],
      ["an email that is not one", { email: "not-an-email" }, /Check the highlighted fields/],
      ["a message that is markup", { notes: "<iframe src=x></iframe>" }, /Check the highlighted fields/],
      ["a booking key that is too short", { submissionKey: "x" }, /not understood/],
      ["no site", { siteSlug: "" }, /not understood/],
    ];
    for (const [label, change, message] of attempts) {
      const forgedEmail = `forged-${randomBytes(3).toString("hex")}@example.test`;
      const response = await post(api, captured, edited(captured, (argument) => Object.assign(argument, { submissionKey: `forged-key-${randomBytes(4).toString("hex")}`, email: forgedEmail }, change)));
      const text = await response.text();
      expect(text, label).toMatch(message);
      expect(text, label).not.toMatch(/violates|constraint|postgres|stack trace|ECONN|select\s+\w+\s+from|insert\s+into/i);
      if (!("email" in change)) expect(await bookingsOf(db, workerTenant.organizationId, forgedEmail), label).toEqual([]);
    }
  });

  test("the same journey submitted twice is one booking: a double click, a retry and the same person asking again", async ({ page, workerTenant, db, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await bookThroughThePage(page, workerTenant, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const [first] = await bookingsOf(db, workerTenant.organizationId, email);
    expect(first).toBeDefined();
    const api = await apiAs(null);
    // The same key again (a retry).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const again = await post(api, captured, captured.body);
      expect(await again.text()).toContain(`BK-${first.number}`);
    }
    // A new key but the same person, Service and time (a second click on a refreshed page).
    const refreshed = await post(api, captured, edited(captured, (argument) => Object.assign(argument, { submissionKey: `second-key-${randomBytes(4).toString("hex")}` })));
    expect(await refreshed.text()).toContain(`BK-${first.number}`);
    expect(await bookingsOf(db, workerTenant.organizationId, email)).toHaveLength(1);
    // A different person at the same time is a different booking.
    const other = `other-${randomBytes(3).toString("hex")}@example.test`;
    const different = await post(api, captured, edited(captured, (argument) => Object.assign(argument, { submissionKey: `third-key-${randomBytes(4).toString("hex")}`, email: other })));
    expect(await different.text()).not.toContain(`BK-${first.number}`);
    expect(await bookingsOf(db, workerTenant.organizationId, other)).toHaveLength(1);
  });

  test("six identical submissions at once make one booking", async ({ page, workerTenant, db, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/sites/${workerTenant.platformSlug}/booking/annual-cooling-tune-up`);
    await fill(page, "Jordan Visitor", email);
    // Capture the call but let it finish; then send the same call six times at once.
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Confirm booking" }).click());
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const api = await apiAs(null);
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(api, captured, captured.body)));
    for (const response of responses) expect(response.status()).toBe(200);
    expect(await bookingsOf(db, workerTenant.organizationId, email)).toHaveLength(1);
  });

  test("a script that posts the form in a loop is slowed: the right-most forwarded address is the visitor's, and a forged left-hand address evades nothing", async ({ page, workerTenant, apiAs }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await bookThroughThePage(page, workerTenant, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    const api = await apiAs(null);
    const visitor = `fd00:${process.pid.toString(16)}:${randomBytes(3).toString("hex")}::42`;
    const texts: string[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      // Each call claims a different address on the left, as a script would; the proxy's own entry on the right is the same.
      const response = await post(
        api,
        captured,
        edited(captured, (argument) => Object.assign(argument, { serviceSlug: "does-not-exist", submissionKey: `loop-key-${randomBytes(4).toString("hex")}` })),
        `10.${attempt}.0.1, ${visitor}`,
      );
      texts.push(await response.text());
    }
    expect(texts.slice(0, 12).every((text) => text.includes("isn't available to book online"))).toBe(true);
    expect(texts[12]).toContain("Too many requests");
    expect(texts[13]).toContain("Too many requests");
    // Another visitor is not slowed by it.
    const calm = await post(api, captured, edited(captured, (argument) => Object.assign(argument, { serviceSlug: "does-not-exist", submissionKey: `loop-key-${randomBytes(4).toString("hex")}` })), `fd00:${process.pid.toString(16)}:${randomBytes(3).toString("hex")}::43`);
    expect(await calm.text()).toContain("isn't available to book online");
  });
});

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 120_000 });

  test("gets a private Site with a Draft of neutral copy, an address of its own, and no listing; nothing of Apex or Northstar", async ({ page, db, apiAs }) => {
    const name = `Fresh Start Air ${randomBytes(3).toString("hex")}`;
    await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name, phone: "(303) 555-0199", email: "hello@freshstart.test", street: "77 Pine Street", city: "Boulder", state: "CO", zip: "80301" });

    const organization = (await db.query<{ id: string; slug: string }>("select id, slug from organizations where name = $1", [name])).rows[0];
    const sites = (await db.query("select id, name, slug, platform_slug, is_primary, status, published_version_id, selected_template_id, custom_domain from sites where organization_id = $1", [organization.id])).rows;
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ name, slug: "main", is_primary: true, status: "draft", published_version_id: null, custom_domain: null });
    expect(sites[0].platform_slug).toBe(organization.slug);
    expect(sites[0].selected_template_id).not.toBeNull();
    const versions = (await db.query("select status, version_number from site_versions where site_id = $1", [sites[0].id])).rows;
    expect(versions).toEqual([{ status: "draft", version_number: null }]);
    expect((await db.query("select page_key from site_pages where site_id = $1 order by sort_order", [sites[0].id])).rows.map((row) => row.page_key)).toEqual(["home", "services", "about", "contact", "booking"]);
    // The Draft is the default template, word for word, with no business named in it.
    const stored = (await db.query<{ props: unknown }>("select props from site_sections where site_id = $1 order by page_id, sort_order", [sites[0].id])).rows.map((row) => JSON.stringify(row.props)).join(" ");
    for (const foreign of ["Apex", "Northstar", "Austin", "Denver", "(555)"]) expect(stored, foreign).not.toContain(foreign);
    expect(stored).toContain(DEFAULT_TEMPLATE.pages[0].sections[0].props.headline);
    // No Marketplace listing, no Services, no customers.
    expect((await db.query("select count(*)::int as n from marketplace_listings where organization_id = $1", [organization.id])).rows[0].n).toBe(0);

    // Private: the public address is not found, and so is the listing address.
    const visitor = await apiAs(null);
    expect((await get(visitor, `/sites/${organization.slug}`)).status).toBe(404);
    expect((await get(visitor, `/listings/${organization.slug}`)).status).toBe(404);

    // In the workspace: the Website is a Draft, the preview speaks of this business only, and the Marketplace is not set up.
    await page.goto("/website");
    await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
    await expect(page.getByText("Apex")).toHaveCount(0);
    await page.goto("/website/preview");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Heating & cooling service when you need it.");
    const preview = await page.locator("body").innerText();
    expect(preview).toContain(name);
    expect(preview).toContain("(303) 555-0199");
    expect(preview).toContain("Boulder, CO");
    for (const foreign of ["Apex", "Northstar", "(555) 392-8100"]) expect(preview, foreign).not.toContain(foreign);
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
    await expect(page.getByText("Apex")).toHaveCount(0);
  });

  test("two businesses with the same name get two different public addresses", async ({ page, browser, db }) => {
    const name = `Twin Name Air ${randomBytes(3).toString("hex")}`;
    await signUp(page, { name: "First Founder" });
    await completeOnboarding(page, { name });
    const second = await browser.newContext({ baseURL: ORIGIN, storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": `fd00:${process.pid.toString(16)}:${randomBytes(2).toString("hex")}::9` } });
    try {
      const other = await second.newPage();
      await signUp(other, { name: "Second Founder" });
      await completeOnboarding(other, { name });
    } finally {
      await second.close();
    }
    const slugs = (await db.query<{ platform_slug: string; slug: string }>("select s.platform_slug, o.slug from sites s join organizations o on o.id = s.organization_id where o.name = $1 order by o.created_at", [name])).rows;
    expect(slugs).toHaveLength(2);
    expect(new Set(slugs.map((row) => row.platform_slug)).size).toBe(2);
    // Collision-safe and never a name the platform keeps for itself.
    for (const row of slugs) expect(row.platform_slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

test.describe("the browser never receives a business's website or listing", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? walk(join(dir, entry)) : entry.endsWith(".js") ? [join(dir, entry)] : []));

  test("none of the template's or either business's website copy, nor either listing's description, is compiled into the client JavaScript", () => {
    const staticDir = join(process.cwd(), ".next", "static");
    expect(existsSync(staticDir), "run a production build first (npm run build)").toBe(true);
    const bundle = walk(staticDir).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(bundle.length).toBeGreaterThan(100_000);
    const copy = [
      ...DEFAULT_TEMPLATE.pages.flatMap((page) => page.sections.flatMap((section) => Object.values(section.props))),
      ...APEX_CONTENT.pages.flatMap((page) => page.sections.flatMap((section) => Object.values(section.props))),
      ...NORTHSTAR_CONTENT.pages.flatMap((page) => page.sections.flatMap((section) => Object.values(section.props))),
      NORTHSTAR_LISTING.config.description,
      APEX_LISTING.config.description,
    ]
      .filter((value) => value.length > 18 && value !== "left" && value !== "center")
      // The Marketplace setup form's default description is a product default shipped to every business; it is not any business's copy.
      .filter((value) => value !== DEFAULT_DESCRIPTION);
    expect(copy.length).toBeGreaterThan(40);
    expect(copy.filter((value) => bundle.includes(value) || bundle.includes(JSON.stringify(value).slice(1, -1)))).toEqual([]);
  });

  test("nothing under src imports the seed, the default template (outside the database layer) or a private query from a client component", () => {
    const sources = (dir: string): string[] => readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? sources(join(dir, entry)) : /\.(ts|tsx)$/.test(entry) ? [join(dir, entry)] : []));
    const offenders: string[] = [];
    for (const file of sources(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      const isClient = /^\s*(["'])use client\1/.test(source.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
      if (isClient && /default-template|site-queries|public-queries|marketplace-queries|seed-data/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
