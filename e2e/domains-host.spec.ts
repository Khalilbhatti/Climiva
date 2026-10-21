/**
 * Phase 18B: a request that arrives with a customer's domain as its Host, asked of the running (production-built) server. No real DNS is
 * involved: the test sends the Host header itself, which is exactly what a browser sends once DNS and TLS are in place.
 *
 * What is proved: an ACTIVE name shows that business's published site through the same renderer as the platform address and nothing else;
 * every other name, and every other path on a customer's name, is a plain "not found" and never a business, the workspace or an API; two
 * businesses never see each other, whoever is signed in; a header any client can send chooses nothing; the Templates, publishing and the
 * logo behave as they do on the platform; and a booking made through a customer's domain is the domain's business's, whatever it says.
 */
import { randomBytes } from "node:crypto";
import type { Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { TEMPLATE_KEYS } from "../src/db/site-templates";
import { createDraftFromTemplate, publishSite, replaceDraftWithTemplate, unpublishSite, type SiteContext } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { CUSTOMERS } from "./apex-data";
import { addReadyLogo, makeBusiness, setLogo, signedIn } from "./assets-helpers";
import { insertActiveClaim, rawRequest, uniqueHost, type RawResponse } from "./domain-helpers";
import { editDraft, setHeadlineOf } from "./draft-edits";
import { captureAction } from "./replay";
import { NOT_SIGNED_IN, ORIGIN, expect, test } from "./saas";

const PORT = new URL(ORIGIN).port;

// The booking tests drive a real browser to a customer's name. There is no DNS for `.example.test`, so this browser is told where those names are
// (the test server, on this machine). Playwright allows this setting only for a whole file; the other tests here do not use a browser.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

let pool: ReturnType<typeof adminDb>["pool"];
let db: ReturnType<typeof adminDb>["db"];
test.beforeAll(() => {
  const admin = adminDb();
  pool = admin.pool;
  db = admin.db;
});
test.afterAll(async () => {
  await pool.end();
});

/** The text a visitor could read: tags, scripts and styles removed, entities decoded. */
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

/** One request to the server with a customer's name as its Host (as a browser sends it, with the port). */
const onHost = (host: string, path = "/", options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<RawResponse> =>
  rawRequest(ORIGIN, path, { host: `${host}:${PORT}`, ...options });
const onPlatform = (path: string, options: { headers?: Record<string, string> } = {}) => rawRequest(ORIGIN, path, options);

/** Where two bodies first differ, with a little of each around it, so a failure says what changed. */
function firstDifference(a: string, b: string): string {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return `at ${at}: ${JSON.stringify(a.slice(Math.max(0, at - 60), at + 120))} against ${JSON.stringify(b.slice(Math.max(0, at - 60), at + 120))}`;
}

const cookiesOf = (state: { cookies: { name: string; value: string }[] }) => state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

type Tenant = { userId: string; organizationId: string; platformSlug: string; storageState: { cookies: { name: string; value: string }[] } };

const run = <T>(who: { userId: string; organizationId: string }, work: (ctx: SiteContext) => Promise<T>): Promise<T> =>
  withTenant({ userId: who.userId, organizationId: who.organizationId }, (tx) => work({ tx, organizationId: who.organizationId }));

const siteOf = async (organizationId: string, slug = "main") => (await pool.query<{ id: string }>("select id from sites where organization_id = $1 and slug = $2", [organizationId, slug])).rows[0].id;

/** Make the worker's copy of Apex say something no other business says, publish it, and give it an active name. */
async function apexHost(tenant: Tenant, label = "apex"): Promise<{ host: string; headline: string; site: string }> {
  const site = await siteOf(tenant.organizationId);
  const headline = `Apex headline ${randomBytes(3).toString("hex")}`;
  await run(tenant, async (ctx) => {
    await setHeadlineOf(ctx, site, headline);
    await publishSite(ctx, site, tenant.userId);
  });
  const host = uniqueHost(label);
  await insertActiveClaim(pool, tenant.organizationId, host);
  return { host, headline, site };
}

/** A second, disposable business with its own published site, its own words and an active name. */
async function otherBusiness(label: string): Promise<{ host: string; headline: string; organizationId: string; name: string; owner: { userId: string; email: string } }> {
  const business = await makeBusiness(label, db);
  const headline = `Other headline ${randomBytes(3).toString("hex")}`;
  const site = await siteOf(business.organizationId);
  await run({ userId: business.owner.userId, organizationId: business.organizationId }, async (ctx) => {
    await createDraftFromTemplate(ctx, site, DEFAULT_TEMPLATE_KEY);
    await setHeadlineOf(ctx, site, headline);
    await publishSite(ctx, site, business.owner.userId);
  });
  const host = uniqueHost(label);
  await insertActiveClaim(pool, business.organizationId, host);
  const name = (await pool.query<{ name: string }>("select name from organizations where id = $1", [business.organizationId])).rows[0].name;
  return { host, headline, organizationId: business.organizationId, name, owner: business.owner };
}

test.describe("a customer's domain shows that business's published site, and only that", () => {
  test("every page of the site is served at the root of the host, through the same renderer as the platform address", async ({ workerTenant }) => {
    const { host, headline } = await apexHost(workerTenant);
    for (const [path, title] of [["/", "Home"], ["/services", "Services"], ["/about", "About"], ["/contact", "Contact"], ["/booking", "Booking"], ["/booking/annual-cooling-tune-up", "Booking"]] as const) {
      const custom = await onHost(host, path);
      expect(custom.status, path).toBe(200);
      expect(custom.body, path).toContain(`<title>${title} · Apex Climate Heating &amp; Air</title>`);
      const platform = await onPlatform(`/sites/${workerTenant.platformSlug}${path === "/" ? "" : path}`);
      expect(platform.status, path).toBe(200);
      // The same words, in the same order: one renderer, reached two ways.
      expect(visibleText(custom.body), path).toBe(visibleText(platform.body));
    }
    expect(visibleText((await onHost(host, "/")).body)).toContain(headline);
  });

  test("the pages link to each other at the root of the host, never into the platform's /sites paths", async ({ workerTenant }) => {
    const { host } = await apexHost(workerTenant);
    const home = (await onHost(host, "/")).body;
    const hrefs = [...home.matchAll(/href="([^"]*)"/g)].map(([, href]) => href).filter((href) => !/^(https?:|mailto:|tel:)/.test(href) && !href.startsWith("/_next") && !href.startsWith("/assets/") && !/icon|favicon/.test(href));
    for (const expected of ["/", "/about", "/booking", "/contact", "/services"]) expect(hrefs).toContain(expected);
    expect(hrefs.filter((href) => href.startsWith("/sites"))).toEqual([]);
    expect(hrefs.filter((href) => href.startsWith("/booking/")).length).toBeGreaterThan(0);
  });

  test("a path that is not a page of the site, a page under a page, and a hidden page are a plain not found", async ({ workerTenant }) => {
    const { host, site } = await apexHost(workerTenant);
    for (const path of ["/nope", "/services/extra", "/about/extra", "/booking/a/b", "/%00", "/..%2fservices", "/services%2f"]) {
      const response = await onHost(host, path);
      expect([400, 404], path).toContain(response.status);
      expect(visibleText(response.body), path).not.toContain("Apex Climate Heating");
    }
    // A page the business hides is not served, once the hiding is published.
    expect((await onHost(host, "/about")).status).toBe(200);
    await run(workerTenant, async (ctx) => {
      await editDraft(ctx, site, (content) => ({ ...content, pages: content.pages.map((page) => (page.key === "about" ? { ...page, visible: false } : page)) }));
    });
    expect((await onHost(host, "/about")).status).toBe(200);
    await run(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    const hidden = await onHost(host, "/about");
    expect(hidden.status).toBe(404);
    expect(visibleText(hidden.body)).not.toContain("Apex Climate Heating");
    expect((await onHost(host, "/contact")).status).toBe(200);
  });

  test("a site that is not published is a plain not found, and is served again when it is published", async ({ workerTenant }) => {
    const { host, headline, site } = await apexHost(workerTenant);
    expect((await onHost(host, "/")).status).toBe(200);
    await run(workerTenant, (ctx) => unpublishSite(ctx, site));
    for (const path of ["/", "/services", "/booking"]) {
      const response = await onHost(host, path);
      expect(response.status, path).toBe(404);
      expect(response.body, path).not.toContain(headline);
      expect(visibleText(response.body), path).not.toContain("Apex Climate Heating");
    }
    await run(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
    expect((await onHost(host, "/")).status).toBe(200);
  });

  test("a name that is unknown, or whose claim is pending, verified, disabled or removed, is a plain not found and never falls back to a business", async ({ workerTenant }) => {
    const { headline, site } = await apexHost(workerTenant);
    const states: Record<string, string> = {
      pending: "status, verification_token",
      verified: "status, verification_token, verified_at",
      disabled: "status, verification_token, verified_at, activated_at, disabled_at",
      removed: "status, verification_token, removed_at",
    };
    const values: Record<string, string> = {
      pending: "'pending_verification', $4",
      verified: "'verified', $4, now()",
      disabled: "'disabled', $4, now(), now(), now()",
      removed: "'removed', $4, now()",
    };
    const hosts: string[] = [uniqueHost("unknown")];
    for (const state of Object.keys(states)) {
      const host = uniqueHost(state);
      hosts.push(host);
      await pool.query(`insert into site_domains (organization_id, site_id, hostname, ${states[state]}) values ($1, $2, $3, ${values[state]})`, [workerTenant.organizationId, site, host, randomBytes(32).toString("base64url")]);
    }
    for (const host of hosts) {
      for (const path of ["/", "/services"]) {
        const response = await onHost(host, path);
        expect(response.status, `${host}${path}`).toBe(404);
        expect(response.body, `${host}${path}`).not.toContain(headline);
        expect(visibleText(response.body), `${host}${path}`).not.toMatch(/Apex Climate|Northstar|Logo Test/);
      }
    }
  });

  test("a name that is not a name, an unusable Host and a name nobody holds are all refused, and the platform's own names are never taken for a customer's", async ({ workerTenant }) => {
    await apexHost(workerTenant);
    // A Host that is not a name at all.
    for (const host of ["exa mple.com", "http://example.com", "a..b"]) expect([400, 404], host).toContain((await rawRequest(ORIGIN, "/", { host })).status);
    // Names that are the platform's: the application itself answers (the sign-in page), never a site. This is what keeps a health check
    // that calls the server by its address, or a container by its service name, working.
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, "web", `[::1]:${PORT}`]) {
      const response = await rawRequest(ORIGIN, "/login", { host });
      expect(response.status, host).toBe(200);
      expect(visibleText(response.body), host).toContain("Log in");
    }
    // The platform's domain and anything beneath it is the platform's, not a customer's: it is the sign-in page, not a site.
    for (const host of ["climvia.com", "www.climvia.com", "app.climvia.com", "someone.climvia.com"]) {
      const response = await rawRequest(ORIGIN, "/login", { host });
      expect(response.status, host).toBe(200);
      expect(visibleText(response.body), host).toContain("Log in");
    }
  });

  test("the name is read as a name: case, a trailing dot and a port make no difference", async ({ workerTenant }) => {
    const { host, headline } = await apexHost(workerTenant);
    for (const sent of [host, host.toUpperCase(), `${host}.`, `${host.toUpperCase()}.`]) {
      for (const withPort of [true, false]) {
        const response = await rawRequest(ORIGIN, "/", { host: withPort ? `${sent}:${PORT}` : sent });
        expect(response.status, `${sent} ${withPort}`).toBe(200);
        expect(response.body).toContain(headline);
      }
    }
  });
});

test.describe("a customer's domain is a public surface only", () => {
  const PRIVATE = ["/settings", "/settings/branding", "/analytics", "/customers", "/bookings", "/schedule", "/website", "/website/builder", "/website/preview", "/website/templates", "/website/domain", "/marketplace-listing", "/marketplace-listing/preview", "/team", "/platform-admin", "/platform-admin/login", "/platform-admin/organizations", "/login", "/signup", "/api/auth/get-session", "/api/auth/sign-in/email", "/api/branding", "/sites/apexclimate", "/sites", "/listings/apex-climate-heating-air", "/listings", "/custom-site", "/custom-site/services", "/_next/data/x/index.json", "/robots.txt", "/sitemap.xml"];

  test("the workspace, the sign-in pages, the Builder, the previews and every API are not there, whoever asks and however", async ({ workerTenant }) => {
    const { host, headline } = await apexHost(workerTenant);
    const session = cookiesOf(workerTenant.storageState);
    for (const path of PRIVATE) {
      for (const method of ["GET", "POST"]) {
        for (const headers of [{}, { cookie: session }] as Record<string, string>[]) {
          const response = await onHost(host, path, { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
          const label = `${method} ${path} ${"cookie" in headers ? "signed in" : "anonymous"}`;
          expect([400, 404, 405], label).toContain(response.status);
          const text = visibleText(response.body);
          expect(text, label).not.toMatch(/Workspace Overview|Website Builder|Log in to|Sign up|Your session has ended/);
          expect(response.body, label).not.toContain(headline);
          expect(response.headers["set-cookie"], label).toBeUndefined();
        }
      }
    }
  });

  test("the only other thing served on a customer's name is the public logo, which answers for the business that chose it and for nobody else", async ({ workerTenant }) => {
    const { host } = await apexHost(workerTenant);
    const home = (await onHost(host, "/")).body;
    const logo = home.match(/src="(\/assets\/[0-9a-f-]{36})"/)?.[1];
    expect(logo).toBeTruthy();
    const viaHost = await onHost(host, logo!);
    expect(viaHost.status).toBe(200);
    expect(String(viaHost.headers["content-type"])).toBe("image/webp");
    expect(viaHost.headers["x-content-type-options"]).toBe("nosniff");
    expect(viaHost.body).toBe((await onPlatform(logo!)).body);
    // No storage key, path or bucket appears on the page or in the asset's headers.
    for (const text of [home, JSON.stringify(viaHost.headers)]) expect(text).not.toMatch(/organizations\/[0-9a-f-]{36}\/assets|\.data|s3:\/\/|amazonaws/i);
    // An id that is not a logo's, or not an id, is not found on this host either.
    expect((await onHost(host, `/assets/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`)).status).toBe(404);
    expect((await onHost(host, "/assets/not-an-id")).status).toBe(404);
  });

  test("a header any client can send chooses no business: X-Forwarded-Host, Forwarded and the like are not read", async ({ workerTenant }) => {
    const mine = await apexHost(workerTenant);
    const other = await otherBusiness("fwd");
    const forged = (host: string): Record<string, string>[] => [{ "x-forwarded-host": host }, { forwarded: `host=${host};proto=https` }, { "x-original-host": host }, { "x-host": host }, { "x-forwarded-server": host }, { "x-forwarded-host": `${host}:${PORT}` }];
    for (const headers of forged(other.host)) {
      const response = await onHost(mine.host, "/", { headers });
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect(response.body, JSON.stringify(headers)).toContain(mine.headline);
      expect(response.body, JSON.stringify(headers)).not.toContain(other.headline);
    }
    // An unknown name cannot borrow an active one's: it stays not found.
    for (const headers of forged(mine.host)) {
      const response = await onHost(uniqueHost("borrow"), "/", { headers });
      expect(response.status, JSON.stringify(headers)).toBe(404);
      expect(response.body, JSON.stringify(headers)).not.toContain(mine.headline);
    }
    // And the platform's own address does not become a customer's site because a header names one.
    for (const headers of forged(mine.host)) {
      const response = await onPlatform("/login", { headers });
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect(response.body, JSON.stringify(headers)).not.toContain(mine.headline);
    }
    // The platform's front door is Climvia's own landing: a header naming a customer's site does not turn it into that site.
    const root = await rawRequest(ORIGIN, "/", { headers: { "x-forwarded-host": mine.host } });
    expect(root.status).toBe(200);
    expect(root.body).not.toContain(mine.headline);
    expect(visibleText(root.body)).toContain("Find HVAC service. Run the business behind it.");
  });
});

test.describe("two businesses, two names", () => {
  test("each name shows its own business and nothing of the other, however many times and in whatever order they are asked", async ({ workerTenant }) => {
    const mine = await apexHost(workerTenant);
    const other = await otherBusiness("iso");
    for (const [host, own, theirs] of [[mine.host, mine, other], [other.host, other, mine], [mine.host, mine, other], [other.host, other, mine]] as const) {
      const response = await onHost(host, "/");
      expect(response.status).toBe(200);
      expect(response.body).toContain(own.headline);
      expect(response.body).not.toContain(theirs.headline);
    }
    expect(visibleText((await onHost(other.host, "/")).body)).toContain(other.name);
    expect(visibleText((await onHost(other.host, "/contact")).body)).not.toContain("Apex Climate");
    expect(visibleText((await onHost(mine.host, "/contact")).body)).not.toContain(other.name);
  });

  test("being signed in to one business changes nothing on another's name, and nothing of the workspace is on a customer's page", async ({ workerTenant, clientAddresses }) => {
    const mine = await apexHost(workerTenant);
    const other = await otherBusiness("sess");
    const theirs = await signedIn(other.owner.email, clientAddresses());
    try {
      const theirSession = cookiesOf(await theirs.storageState());
      const mySession = cookiesOf(workerTenant.storageState);
      // The owner of one business, with a real session, asks for the other's name: the public page, byte for byte what a stranger gets.
      const anonymousOther = await onHost(other.host, "/");
      const withMine = await onHost(other.host, "/", { headers: { cookie: mySession } });
      expect(withMine.status).toBe(200);
      expect(withMine.body === anonymousOther.body, firstDifference(anonymousOther.body, withMine.body)).toBe(true);
      const anonymousMine = await onHost(mine.host, "/");
      const withTheirs = await onHost(mine.host, "/", { headers: { cookie: theirSession } });
      expect(withTheirs.body === anonymousMine.body, firstDifference(anonymousMine.body, withTheirs.body)).toBe(true);
      // Neither page carries a person, a customer or a workspace.
      for (const body of [withMine.body, withTheirs.body]) {
        expect(body).not.toContain(other.owner.email);
        expect(body).not.toContain(workerTenant.userId);
        for (const customer of CUSTOMERS.slice(0, 5)) expect(body).not.toContain(customer.name);
        expect(body).not.toMatch(/WorkspaceProvider|organization_memberships|"role":"owner"/);
      }
    } finally {
      await theirs.dispose();
    }
  });

  test("a business with two Sites: each name shows its own Site, and publishing one does not change the other", async ({ workerTenant }) => {
    const main = await apexHost(workerTenant, "main");
    const commercial = await siteOf(workerTenant.organizationId, "commercial");
    const commercialHeadline = `Commercial headline ${randomBytes(3).toString("hex")}`;
    await run(workerTenant, async (ctx) => {
      await setHeadlineOf(ctx, commercial, commercialHeadline);
      await publishSite(ctx, commercial, workerTenant.userId);
    });
    const commercialHost = uniqueHost("commercial");
    await insertActiveClaim(pool, workerTenant.organizationId, commercialHost, { siteSlug: "commercial" });
    expect((await onHost(main.host, "/")).body).toContain(main.headline);
    expect((await onHost(main.host, "/")).body).not.toContain(commercialHeadline);
    expect((await onHost(commercialHost, "/")).body).toContain(commercialHeadline);
    expect((await onHost(commercialHost, "/")).body).not.toContain(main.headline);

    // Publishing the first Site again changes the first name only.
    const changed = `Main again ${randomBytes(3).toString("hex")}`;
    await run(workerTenant, async (ctx) => {
      await setHeadlineOf(ctx, main.site, changed);
      await publishSite(ctx, main.site, workerTenant.userId);
    });
    expect((await onHost(main.host, "/")).body).toContain(changed);
    expect((await onHost(commercialHost, "/")).body).toContain(commercialHeadline);
    expect((await onHost(commercialHost, "/")).body).not.toContain(changed);
    // The business is the same for both, yet the Site is decided by the name, not by the business.
    const platformMain = await onPlatform(`/sites/${workerTenant.platformSlug}`);
    expect(platformMain.body).toContain(changed);
  });
});

test.describe("Templates, publishing and the logo behave as they do on the platform", () => {
  test("all four Templates render through a customer's name, with the same words as the platform address, and a Draft is invisible until it is published", async ({ workerTenant }) => {
    const { host, site } = await apexHost(workerTenant);
    expect(TEMPLATE_KEYS).toHaveLength(4);
    let previous = visibleText((await onHost(host, "/")).body);
    for (const key of TEMPLATE_KEYS) {
      const revision = (await pool.query<{ revision: number }>("select revision from site_versions where site_id = $1 and status = 'draft'", [site])).rows[0].revision;
      await run(workerTenant, (ctx) => replaceDraftWithTemplate(ctx, site, key, { confirmReplace: true, expectedRevision: revision }));
      // Saved but not published: the name still shows what was published.
      const beforePublish = await onHost(host, "/");
      expect(beforePublish.status, `${key} draft`).toBe(200);
      expect(visibleText(beforePublish.body), `${key} draft`).toBe(previous);
      await run(workerTenant, (ctx) => publishSite(ctx, site, workerTenant.userId));
      for (const path of ["/", "/services", "/booking"]) {
        const custom = await onHost(host, path);
        const platform = await onPlatform(`/sites/${workerTenant.platformSlug}${path === "/" ? "" : path}`);
        expect(custom.status, `${key} ${path}`).toBe(200);
        expect(visibleText(custom.body), `${key} ${path}`).toBe(visibleText(platform.body));
      }
      const published = visibleText((await onHost(host, "/")).body);
      // The first Template replaces the business's own authored words, so what visitors read changes at the moment it is published.
      if (key === TEMPLATE_KEYS[0]) expect(published, key).not.toBe(previous);
      previous = published;
    }
  });

  test("changing the logo shows on the name at once, with no Publish, and removing it falls back to the business's initials", async ({ workerTenant }) => {
    const { host } = await apexHost(workerTenant);
    const logoOf = async () => (await onHost(host, "/")).body.match(/src="(\/assets\/[0-9a-f-]{36})"/)?.[1] ?? null;
    const first = await logoOf();
    expect(first).toBeTruthy();
    const replacement = await addReadyLogo(pool, workerTenant.organizationId, { color: { r: 200, g: 30, b: 30 } });
    await setLogo(pool, workerTenant.organizationId, replacement);
    expect(await logoOf()).toBe(`/assets/${replacement}`);
    expect((await onHost(host, `/assets/${replacement}`)).status).toBe(200);
    // The logo it replaced is no longer anyone's chosen one.
    expect((await onHost(host, first!)).status).toBe(404);
    await setLogo(pool, workerTenant.organizationId, null);
    expect(await logoOf()).toBeNull();
    const text = visibleText((await onHost(host, "/")).body);
    expect(text).toContain("Apex Climate Heating");
  });
});

test.describe("canonical addresses", () => {
  test("a page on a customer's name calls itself by the site's main active name; the platform address says the same once there is one", async ({ workerTenant }) => {
    const { host, site } = await apexHost(workerTenant);
    const canonical = (body: string) => body.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
    expect(canonical((await onHost(host, "/")).body)).toBe(`http://${host}`);
    expect(canonical((await onHost(host, "/services")).body)).toBe(`http://${host}/services`);
    expect(canonical((await onHost(host, "/booking/annual-cooling-tune-up")).body)).toBe(`http://${host}/booking/annual-cooling-tune-up`);
    expect(canonical((await onPlatform(`/sites/${workerTenant.platformSlug}/services`)).body)).toBe(`http://${host}/services`);
    // A second name for the same site names the main one as the site's own.
    const alias = uniqueHost("alias");
    await insertActiveClaim(pool, workerTenant.organizationId, alias, { primary: false });
    expect(canonical((await onHost(alias, "/about")).body)).toBe(`http://${host}/about`);
    // With no main name, a page names itself by the name it was reached on, and the platform address names nothing.
    await pool.query("update site_domains set is_primary = false where site_id = $1", [site]);
    expect(canonical((await onHost(alias, "/about")).body)).toBe(`http://${alias}/about`);
    expect(canonical((await onPlatform(`/sites/${workerTenant.platformSlug}/about`)).body)).toBeNull();
    // Nothing redirects: both addresses keep serving.
    expect((await onPlatform(`/sites/${workerTenant.platformSlug}`)).status).toBe(200);
  });
});

test.describe("a booking made through a customer's name", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  const fill = async (page: Page, name: string, email: string) => {
    await page.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await page.getByRole("radio", { name: /^11:30 AM/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill(name);
    await page.getByLabel(/^Phone number/).fill("(512) 555-0111");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Service address/).fill("1402 South Congress Ave, Austin, TX 78704");
  };

  const bookingsOf = async (organizationId: string, email: string) =>
    (await pool.query("select b.number, b.status, b.source, b.customer_id, b.organization_id, s.slug as service from bookings b join services s on s.id = b.service_id and s.organization_id = b.organization_id left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = $1 and (b.contact_email = $2 or cu.email_key = lower($2))", [organizationId, email])).rows;

  /** Book through the page on the customer's name, and keep the call the page sent. */
  async function book(page: Page, host: string, email: string) {
    await page.goto(`http://${host}:${PORT}/booking/annual-cooling-tune-up`);
    await expect(page.getByRole("heading", { name: "Choose a date and time" })).toBeVisible();
    await fill(page, "Jordan Visitor", email);
    return captureAction(page, () => page.getByRole("button", { name: "Confirm booking" }).click());
  }

  /** Send the captured call again to the server, with the Host of the person's choosing (the way a script would). */
  const resend = (captured: Awaited<ReturnType<typeof book>>, host: string, change: (argument: Record<string, unknown>) => void) => {
    const args = JSON.parse(captured.body) as Record<string, unknown>[];
    const first = { ...args[0] };
    change(first);
    return rawRequest(ORIGIN, new URL(captured.url).pathname, {
      host: `${host}:${PORT}`,
      method: "POST",
      headers: { ...captured.headers, origin: `http://${host}:${PORT}`, "x-forwarded-for": `fd00:${randomBytes(2).toString("hex")}::${randomBytes(2).toString("hex")}` },
      body: JSON.stringify([first, ...args.slice(1)]),
    });
  };

  test("a visitor books on the customer's own name: the booking is the name's business's, confirmed, with the reference on the page", async ({ page, workerTenant }) => {
    const { host } = await apexHost(workerTenant);
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`http://${host}:${PORT}/booking/annual-cooling-tune-up`);
    await expect(page.getByText("Instant booking · 60 mins")).toBeVisible();
    await fill(page, "Jordan Visitor", email);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toContainText(/BK-\d{4}/);
    const rows = await bookingsOf(workerTenant.organizationId, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "confirmed", source: "Website", customer_id: expect.any(String), service: "annual-cooling-tune-up", organization_id: workerTenant.organizationId });
    // The page stayed on the customer's name the whole time, and held nothing of the business's other bookings.
    expect(page.url()).toContain(host);
    expect(await page.locator("body").innerText()).not.toMatch(/Sarah Mitchell|David Chen/);
  });

  test("the name decides the business: a Service of another business is refused, a business or Site named in the request is ignored, and a repeat finds the first booking", async ({ page, workerTenant }) => {
    const mine = await apexHost(workerTenant);
    const other = await otherBusiness("book");
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await book(page, mine.host, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    expect(await bookingsOf(workerTenant.organizationId, email)).toHaveLength(1);

    // Northstar's Service, sent to Apex's name: not one of Apex's Services, so nothing is booked anywhere.
    const foreignEmail = `foreign-${randomBytes(3).toString("hex")}@example.test`;
    const foreign = await resend(captured, mine.host, (argument) => Object.assign(argument, { serviceSlug: "furnace-tune-up", submissionKey: `k-${randomBytes(4).toString("hex")}`, email: foreignEmail }));
    expect(foreign.body).toMatch(/isn't available to book online/);
    expect(await bookingsOf(workerTenant.organizationId, foreignEmail)).toEqual([]);

    // Another business's organization and its site's address named in the request make no difference: the name is Apex's, so the booking is Apex's.
    const forgedEmail = `forged-${randomBytes(3).toString("hex")}@example.test`;
    const forged = await resend(captured, mine.host, (argument) =>
      Object.assign(argument, { organizationId: other.organizationId, organization_id: other.organizationId, siteSlug: (/* a platform address */ "northstar"), submissionKey: `k-${randomBytes(4).toString("hex")}`, email: forgedEmail }),
    );
    expect(forged.body).toMatch(/BK-\d{4}/);
    expect(await bookingsOf(workerTenant.organizationId, forgedEmail)).toHaveLength(1);
    expect(await bookingsOf(other.organizationId, forgedEmail)).toEqual([]);
    // Nothing was made in Northstar either: no booking, and no customer carrying the forged address.
    expect((await pool.query("select count(*)::int as n from bookings b left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = (select id from organizations where slug = 'northstar-heating-cooling') and (b.contact_email = $1 or cu.email_key = lower($1))", [forgedEmail])).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from customers where organization_id = (select id from organizations where slug = 'northstar-heating-cooling') and email_key = lower($1)", [forgedEmail])).rows[0].n).toBe(0);

    // The same submission again is the same booking: one row, the same reference.
    const key = `k-${randomBytes(4).toString("hex")}`;
    const dupEmail = `dup-${randomBytes(3).toString("hex")}@example.test`;
    const first = await resend(captured, mine.host, (argument) => Object.assign(argument, { submissionKey: key, email: dupEmail }));
    const second = await resend(captured, mine.host, (argument) => Object.assign(argument, { submissionKey: key, email: dupEmail }));
    const reference = (text: string) => text.match(/BK-\d{4}/)?.[0];
    expect(reference(first.body)).toBeTruthy();
    expect(reference(second.body)).toBe(reference(first.body));
    expect(await bookingsOf(workerTenant.organizationId, dupEmail)).toHaveLength(1);
  });

  test("a booking sent to a name that is not active books nothing, whatever the request says", async ({ page, workerTenant }) => {
    const mine = await apexHost(workerTenant);
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    const captured = await book(page, mine.host, email);
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();
    for (const host of [uniqueHost("nobody"), "exa mple.com"]) {
      const forgedEmail = `unk-${randomBytes(3).toString("hex")}@example.test`;
      const response = await resend(captured, host, (argument) => Object.assign(argument, { submissionKey: `k-${randomBytes(4).toString("hex")}`, email: forgedEmail }));
      expect(response.body, host).not.toMatch(/BK-\d{4}/);
      expect(await bookingsOf(workerTenant.organizationId, forgedEmail), host).toEqual([]);
    }
  });
});
