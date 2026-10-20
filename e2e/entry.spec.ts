/**
 * Phase 19C, the front door: what `/` is for a visitor, for each kind of signed-in person, and on a customer's own domain; the header's session answer;
 * sign-out from the public pages; where a login may send someone; and what a search engine is told.
 *
 * Everything here runs against the production build over HTTP and in a browser. The visitor's page is the same page for everyone who stays on it (it is
 * compared byte for byte), a business member is sent on to /overview, a platform administrator with no business of their own is not made to create
 * one, and a customer's domain serves that customer's site at its root and nothing of Climvia's.
 */
import { randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { publishSite, type SiteContext } from "../src/db/site-queries";
import { withTenant } from "../src/db/tenant";
import { anonymous, makeBusiness, signedIn } from "./assets-helpers";
import { insertActiveClaim, rawRequest, uniqueHost } from "./domain-helpers";
import { setHeadlineOf } from "./draft-edits";
import { makeProvider } from "./marketplace-helpers";
import { makeAccount, makePlatformAdmin } from "./platform-admin-helpers";
import { NOT_SIGNED_IN, ORIGIN, expect, expectAccessible, newEmail, test } from "./saas";

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

test.describe.configure({ timeout: 120_000 });

const PORT = new URL(ORIGIN).port;
const HEADLINE = "Find HVAC service. Run the business behind it.";
const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
const meta = (page: Page, name: string) => page.locator(`meta[name="${name}"]`).getAttribute("content");

async function fetchPage(api: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  const response = await api.get(path, { maxRedirects: 0, headers });
  return { status: response.status(), body: await response.text(), headers: response.headers() };
}

/** The platform's session answer, as a client sees it. */
async function stateOf(api: APIRequestContext) {
  const response = await api.get("/api/session-state", { maxRedirects: 0 });
  return { status: response.status(), json: await response.json(), headers: response.headers() };
}

/* ───────────────────────────── a visitor at the door ───────────────────────────── */

test.describe("a visitor at /", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("the landing: one heading, the two ways in, a sign-in, and a title, description and canonical address that belong to it", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    expect(await page.title()).toBe("Climvia · Find HVAC service. Run the business behind it.");
    expect(await meta(page, "description")).toContain("Climvia is where homeowners find HVAC businesses");
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(`${ORIGIN}/`);
    expect(await meta(page, "robots")).toBe("index, follow");

    // The two doors, named for who they are for.
    const homeowners = page.getByRole("region", { name: "Find HVAC services" });
    await expect(homeowners.getByRole("link", { name: "Find a Service" })).toHaveAttribute("href", "/marketplace");
    const business = page.getByRole("region", { name: "Run your HVAC business with Climvia" });
    await expect(business.getByRole("link", { name: "List Your Business" })).toHaveAttribute("href", "/signup");
    await expect(business.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/login");
    // The header: home, the Marketplace, the business pages and the account links; no workspace navigation, no console.
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Climvia home" })).toHaveAttribute("href", "/");
    await expect(header.getByRole("link", { name: "Marketplace" })).toHaveAttribute("href", "/marketplace");
    await expect(header.getByRole("link", { name: "For HVAC businesses" })).toHaveAttribute("href", "/#for-businesses");
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(header.getByRole("link", { name: "List your business" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Platform|console|admin/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

    // Headings run in order, each section is a region of the page, and the page has one main landmark.
    expect(await page.locator("h1").count()).toBe(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    for (const name of ["From the first search to the last review", "Everything you run, in one workspace", "How the Marketplace works"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    await expectAccessible(page);
  });

  test("it says only what Climvia does: no number, saving, promise, coverage or testimonial that nothing backs", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator("body").innerText();
    for (const claim of [
      /verified/i,
      /licensed/i,
      /guarantee/i,
      /best price/i,
      /save up to|saves? you|% (off|cheaper|more)/i,
      /nationwide|coast to coast|across the (country|nation|us)/i,
      /\bAI\b|artificial intelligence|machine learning|smart assistant/i,
      /response time|within \d+ (minutes|hours)|same[- ]day|24\/7|instant(ly)?\b/i,
      /top[- ]rated|best[- ]in|#1|number one|leading|trusted by|loved by|thousands of|hundreds of|\d[\d,]*\+? (businesses|customers|homeowners|providers|reviews|users)/i,
      /testimonial|"[^"]{20,}" —/i,
      /coming soon|beta|early access/i,
    ]) {
      expect(text, String(claim)).not.toMatch(claim);
    }
    // Every capability it names is one the workspace has, by the name the sidebar gives it.
    for (const name of ["Bookings", "Schedule", "Jobs", "Customers", "Quotes & Invoices", "Payments", "Maintenance Plans", "Website Builder", "Marketplace", "Reviews", "Marketing", "Analytics", "Services", "Team"]) {
      expect(text, name).toContain(name);
    }
  });

  test("the HTML holds nothing of anyone's workspace: no provider, no business, no person, no setting, no secret", async () => {
    const api = await anonymous(address());
    const { status, body, headers } = await fetchPage(api, "/");
    expect(status).toBe(200);
    for (const secret of ["Apex Climate", "Northstar", "climvia_org", "alex.morgan", "WorkspaceProviders", "app.user_id", "app.org_id", "SettingsProvider", "organizationId", "capabilities", "Platform console"]) expect(body, secret).not.toContain(secret);
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(headers["cache-control"]).toMatch(/no-store|private/);
    expect(headers["set-cookie"]).toBeUndefined();
    // A structured-data block that says what Climvia is, and nothing a business would own.
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body);
    expect(block).not.toBeNull();
    const graph = JSON.parse(block![1])["@graph"] as { "@type": string; url: string; potentialAction?: { target: { urlTemplate: string } } }[];
    expect(graph.map((item) => item["@type"]).sort()).toEqual(["Organization", "WebSite"]);
    expect(graph.every((item) => item.url === `${ORIGIN}/`)).toBe(true);
    expect(graph.find((item) => item["@type"] === "WebSite")?.potentialAction?.target.urlTemplate).toBe(`${ORIGIN}/marketplace?q={search_term_string}`);
    await api.dispose();
  });

  test("each way in goes where it says", async ({ page }) => {
    for (const [link, path] of [["Find a Service", "/marketplace"], ["List Your Business", "/signup"]] as const) {
      await page.goto("/");
      await page.getByRole("main").getByRole("link", { name: link }).first().click();
      await expect(page).toHaveURL(`${ORIGIN}${path}`);
    }
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "For HVAC businesses" }).click();
    await expect(page).toHaveURL(`${ORIGIN}/#for-businesses`);
    await expect(page.getByRole("heading", { level: 2, name: "Everything you run, in one workspace" })).toBeInViewport();
  });

  test("on a phone the header, the two doors and every section fit the width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expect(page.getByRole("banner").getByRole("link", { name: "List your business" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
    for (const name of ["Find HVAC services", "Run your HVAC business with Climvia"]) {
      const box = await page.getByRole("region", { name }).boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 390, name).toBe(true);
    }
    // Every control is at least a comfortable target.
    for (const link of await page.getByRole("main").getByRole("link").all()) {
      const box = await link.boundingBox();
      if (box) expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(24);
    }
    await expectAccessible(page);
  });

  test("keyboard: the first stops are the header's, in order, and each shows a visible focus", async ({ page }) => {
    await page.goto("/");
    const order: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      order.push(await focused.evaluate((element) => element.getAttribute("aria-label") || (element.textContent ?? "").trim()));
      const outline = await focused.evaluate((element) => getComputedStyle(element).outlineStyle);
      expect(outline, order[step]).not.toBe("none");
    }
    expect(order.slice(0, 5)).toEqual(["Climvia home", "Marketplace", "For HVAC businesses", "Sign in", "List your business"]);
  });

  test("what a search engine is told: the landing is in the sitemap and allowed, and the doors, the workspace and the console are not", async () => {
    const api = await anonymous(address());
    const robots = await (await api.get("/robots.txt")).text();
    expect(robots).toContain("Allow: /$");
    expect(robots.indexOf("Allow: /$")).toBeLessThan(robots.indexOf("Disallow: /"));
    const sitemap = await (await api.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>${ORIGIN}/</loc>`);
    for (const path of ["/login", "/signup", "/onboarding", "/overview", "/platform-admin", "/review/", "/api/", "/marketplace-listing"]) expect(sitemap, path).not.toContain(`${ORIGIN}${path}`);
    await api.dispose();
  });

  test("Log in, Sign up and the console's sign-in are never indexed; neither is a review link", async ({ page }) => {
    for (const path of ["/login", "/signup", "/platform-admin/login"]) {
      await page.goto(path);
      expect(await meta(page, "robots"), path).toBe("noindex, nofollow");
    }
    const review = await anonymous(address());
    const response = await review.get(`/review/${randomBytes(32).toString("base64url")}`);
    expect(response.status()).toBe(404);
    await review.dispose();
  });
});

/* ───────────────────────────── each kind of signed-in person ───────────────────────────── */

test.describe("signed in", () => {
  test("a business member is sent on to /overview in one step, from `/` and from Log in and Sign up", async () => {
    const business = await makeBusiness("entrymember", owner.db);
    for (const person of [business.owner, business.admin, business.member]) {
      const api = await signedIn(person.email, address());
      const root = await fetchPage(api, "/");
      expect(root.status, person.email).toBe(307);
      expect(new URL(root.headers.location, ORIGIN).pathname).toBe("/overview");
      for (const path of ["/login", "/signup"]) {
        const response = await fetchPage(api, path);
        expect(response.status, path).toBe(307);
        expect(new URL(response.headers.location, ORIGIN).pathname, path).toBe("/");
      }
      const overview = await fetchPage(api, "/overview");
      expect(overview.status).toBe(200);
      expect(await (await api.get("/overview")).text()).toContain("Workspace Overview");
      await api.dispose();
    }
  });

  test("someone with an account and no business is taken to set one up, not shown a business's pages", async () => {
    const account = await makeAccount("entrynone", owner.db);
    const api = await signedIn(account.email, address());
    const root = await fetchPage(api, "/");
    expect(root.status).toBe(307);
    expect(new URL(root.headers.location, ORIGIN).pathname).toBe("/onboarding");
    expect((await fetchPage(api, "/onboarding")).status).toBe(200);
    expect(await stateOf(api)).toMatchObject({ status: 200, json: { signedIn: true, workspace: false, platformAdmin: false } });
    for (const path of ["/overview", "/customers"]) expect(new URL((await fetchPage(api, path)).headers.location, ORIGIN).pathname, path).toBe("/onboarding");
    for (const path of ["/platform-admin", "/platform-admin/system"]) expect((await fetchPage(api, path)).status, path).toBe(404);
    await api.dispose();
  });

  test("a platform administrator with no business is not made to create one: `/` is the landing, the same bytes a visitor gets, and their console is one link away", async () => {
    const admin = await makePlatformAdmin("entryadmin", owner.db, owner.pool);
    const api = await signedIn(admin.email, address());
    const visitor = await anonymous(address());
    const mine = await fetchPage(api, "/");
    const theirs = await fetchPage(visitor, "/");
    expect(mine.status).toBe(200);
    expect(mine.body).toBe(theirs.body);
    expect(await stateOf(api)).toMatchObject({ json: { signedIn: true, workspace: false, platformAdmin: true } });
    // Nothing loops: following `/` is one page.
    const followed = await api.get("/");
    expect(followed.url()).toBe(`${ORIGIN}/`);
    expect((await fetchPage(api, "/platform-admin")).status).toBe(200);
    await api.dispose();
    await visitor.dispose();
  });

  test("a platform administrator who also belongs to a business is a business member at `/`", async () => {
    const business = await makeBusiness("entryboth", owner.db);
    const admin = await makePlatformAdmin("entryboth", owner.db, owner.pool);
    await owner.pool.query("insert into organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'admin', 'active')", [business.organizationId, admin.userId]);
    const api = await signedIn(admin.email, address());
    const root = await fetchPage(api, "/");
    expect(root.status).toBe(307);
    expect(new URL(root.headers.location, ORIGIN).pathname).toBe("/overview");
    expect(await stateOf(api)).toMatchObject({ json: { signedIn: true, workspace: true, platformAdmin: true } });
    await api.dispose();
  });

  test("the session answer is three booleans about the caller, never cached, and says nothing to a visitor", async () => {
    const business = await makeBusiness("entrystate", owner.db);
    const visitor = await anonymous(address());
    const answer = await stateOf(visitor);
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ signedIn: false, workspace: false, platformAdmin: false });
    expect(answer.headers["cache-control"]).toBe("private, no-store");
    expect(answer.headers.vary).toContain("Cookie");
    expect(answer.headers["set-cookie"]).toBeUndefined();
    expect(answer.headers["access-control-allow-origin"]).toBeUndefined();

    const member = await signedIn(business.member.email, address());
    const mine = await stateOf(member);
    expect(mine.json).toEqual({ signedIn: true, workspace: true, platformAdmin: false });
    expect(Object.keys(mine.json).sort()).toEqual(["platformAdmin", "signedIn", "workspace"]);
    // It takes nothing from the request: a person named in the query is not the caller, and another method is refused.
    expect((await member.get(`/api/session-state?user=${business.owner.userId}&admin=1`)).status()).toBe(200);
    expect((await stateOf(member)).json).toEqual(mine.json);
    expect((await member.post("/api/session-state", { data: {} })).status()).toBe(405);
    await member.dispose();
    await visitor.dispose();
  });

  test("the Marketplace and a provider's profile are the same page for a visitor and for a signed-in member, down to the byte", async () => {
    const provider = await makeProvider("entrypublic", { db: owner.db, pool: owner.pool });
    const member = await signedIn(provider.business.member.email, address());
    const visitor = await anonymous(address());
    for (const path of [`/marketplace?q=${provider.token}`, `/listings/${provider.slug}`, "/listings/apex-climate-heating-air"]) {
      const a = await fetchPage(visitor, path);
      const b = await fetchPage(member, path);
      expect(a.status, path).toBe(200);
      expect(b.body, path).toBe(a.body);
      expect(b.body, path).not.toContain(provider.business.member.email);
    }
    await member.dispose();
    await visitor.dispose();
  });
});

/* ───────────────────────────── the header knows who is looking ───────────────────────────── */

test.describe("the header of a public page, once it knows who is looking", () => {
  test("a visitor sees Sign in and List your business, and nothing about anyone", async ({ browser }) => {
    const context = await browser.newContext({ storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
    const page = await context.newPage();
    await page.goto("/marketplace");
    const account = page.getByRole("navigation", { name: "Account" });
    await expect(account).toHaveAttribute("data-session", "anonymous");
    await expect(account.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(account.getByRole("link", { name: "List your business" })).toBeVisible();
    await expect(account.getByRole("link", { name: "Platform console" })).toHaveCount(0);
    await context.close();
  });

  test("a business member gets a way back to the dashboard, and signing out from here ends the session everywhere", async ({ browser }) => {
    const business = await makeBusiness("entryisland", owner.db);
    const addressOf = address();
    const state = await (await signedIn(business.owner.email, addressOf)).storageState();
    const context = await browser.newContext({ storageState: state, extraHTTPHeaders: { "x-forwarded-for": addressOf } });
    const page = await context.newPage();
    await page.goto("/marketplace");
    const account = page.getByRole("navigation", { name: "Account" });
    await expect(account).toHaveAttribute("data-session", "member");
    await expect(account.getByRole("link", { name: "Go to Dashboard" })).toHaveAttribute("href", "/overview");
    await expect(account.getByRole("link", { name: "Platform console" })).toHaveCount(0);
    await account.getByRole("link", { name: "Go to Dashboard" }).click();
    await expect(page).toHaveURL(`${ORIGIN}/overview`);
    await page.goto("/marketplace");
    await page.getByRole("navigation", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Account" })).toHaveAttribute("data-session", "anonymous");

    // The workspace is closed again, the Marketplace is not, and nothing of the business is left in the browser.
    await page.goto("/overview");
    await expect(page).toHaveURL(new RegExp(`${ORIGIN}/login\\?next=%2Foverview$`));
    expect((await page.request.get("/api/session-state")).status()).toBe(200);
    expect(await (await page.request.get("/api/session-state")).json()).toEqual({ signedIn: false, workspace: false, platformAdmin: false });
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Find HVAC service in your area" })).toBeVisible();
    expect((await context.cookies()).filter((cookie) => /session/i.test(cookie.name) && cookie.value !== "")).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(business.owner.email);
    // The console is closed too.
    expect((await page.request.get("/platform-admin", { maxRedirects: 0 })).status()).toBe(307);
    await context.close();
  });

  test("a platform administrator gets a quiet link to the console; a business owner, admin and member do not", async ({ browser }) => {
    const business = await makeBusiness("entryconsole", owner.db);
    const admin = await makePlatformAdmin("entryconsole", owner.db, owner.pool);
    const cases: [string, boolean][] = [[admin.email, true], [business.owner.email, false], [business.admin.email, false], [business.member.email, false]];
    for (const [email, shown] of cases) {
      const addressOf = address();
      const context = await browser.newContext({ storageState: await (await signedIn(email, addressOf)).storageState(), extraHTTPHeaders: { "x-forwarded-for": addressOf } });
      const page = await context.newPage();
      await page.goto("/marketplace");
      const account = page.getByRole("navigation", { name: "Account" });
      await expect(account).not.toHaveAttribute("data-session", "loading");
      await expect(account.getByRole("link", { name: "Platform console" })).toHaveCount(shown ? 1 : 0);
      if (shown) {
        await expect(account).toHaveAttribute("data-session", "no-workspace");
        await account.getByRole("link", { name: "Platform console" }).click();
        await expect(page).toHaveURL(`${ORIGIN}/platform-admin`);
        await expect(page.getByRole("heading", { level: 1, name: "Platform overview" })).toBeVisible();
      }
      await context.close();
    }
  });
});

/* ───────────────────────────── where a login may send someone ───────────────────────────── */

test.describe("Log in returns only to a page of this site, and grants nothing by the way it was asked", () => {
  test("an address that is not a path on this site is dropped; the console is never a return address; a real page is honoured", async ({ browser }) => {
    const business = await makeBusiness("entrynext", owner.db);
    const outcomes: [string, string][] = [
      ["//evil.example.test/steal", "/overview"],
      ["https://evil.example.test/", "/overview"],
      ["/\\evil.example.test", "/overview"],
      ["javascript:alert(1)", "/overview"],
      ["/platform-admin", "/overview"],
      ["/platform-admin/system", "/overview"],
      ["/api/auth/sign-out", "/overview"],
      ["/customers", "/customers"],
    ];
    for (const [next, landed] of outcomes) {
      const context = await browser.newContext({ storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
      const page = await context.newPage();
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel(/^Email/).fill(business.owner.email);
      await page.getByLabel(/^Password/).fill(process.env.SEED_PASSWORD ?? "");
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL((url) => url.origin === ORIGIN && url.pathname !== "/login", { timeout: 30_000 });
      expect(new URL(page.url()).origin, next).toBe(ORIGIN);
      expect(new URL(page.url()).pathname, next).toBe(landed);
      await context.close();
    }
  });

  test("a platform administrator who signs in on the ordinary page lands as a person, not in the console", async ({ browser }) => {
    const admin = await makePlatformAdmin("entrynextadmin", owner.db, owner.pool);
    const context = await browser.newContext({ storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/^Email/).fill(admin.email);
    await page.getByLabel(/^Password/).fill(admin.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(`${ORIGIN}/`, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Platform console" })).toBeVisible();
    await context.close();
  });
});

/* ───────────────────────────── a customer's domain ───────────────────────────── */

test.describe("a customer's own domain is that customer's website at its root, and none of Climvia's front door", () => {
  const onHost = (host: string, path = "/", headers: Record<string, string> = {}) => rawRequest(ORIGIN, path, { host: `${host}:${PORT}`, headers });
  const run = <T>(who: { userId: string; organizationId: string }, work: (ctx: SiteContext) => Promise<T>): Promise<T> => withTenant({ userId: who.userId, organizationId: who.organizationId }, (tx) => work({ tx, organizationId: who.organizationId }));

  test("`/` on an active name is the customer's site; the landing, the Marketplace, Log in, Sign up, the review page, the session answer, the workspace and the console are not there", async ({ workerTenant }) => {
    const siteId = (await owner.pool.query<{ id: string }>("select id from sites where organization_id = $1 and slug = 'main'", [workerTenant.organizationId])).rows[0].id;
    const headline = `Root headline ${randomBytes(3).toString("hex")}`;
    await run(workerTenant, async (ctx) => {
      await setHeadlineOf(ctx, siteId, headline);
      await publishSite(ctx, siteId, workerTenant.userId);
    });
    const host = uniqueHost("entry");
    await insertActiveClaim(owner.pool, workerTenant.organizationId, host);

    const root = await onHost(host, "/");
    expect(root.status).toBe(200);
    expect(visibleText(root.body)).toContain(headline);
    for (const climvia of [HEADLINE, "Find a Service", "List Your Business", "List your business", "Climvia home", "Platform console", "data-session"]) expect(root.body, climvia).not.toContain(climvia);

    const token = randomBytes(32).toString("base64url");
    for (const path of ["/marketplace", "/marketplace?q=hvac", "/login", "/signup", "/onboarding", `/review/${token}`, "/api/session-state", "/overview", "/platform-admin", "/platform-admin/login", "/robots.txt", "/sitemap.xml", "/listings/apex-climate-heating-air"]) {
      const response = await onHost(host, path);
      expect([404, 400], path).toContain(response.status);
      expect(response.body, path).not.toContain(HEADLINE);
      expect(response.body, path).not.toMatch(/"signedIn"|Climvia Marketplace|Sign in|Log in/);
    }

    // A header any client can send chooses nothing, in either direction.
    const platformHost = new URL(ORIGIN).host;
    const forgedOnCustom = await onHost(host, "/", { "x-forwarded-host": platformHost, forwarded: `host=${platformHost}`, "x-original-host": platformHost });
    expect(forgedOnCustom.body).toBe(root.body);
    const forgedOnPlatform = await rawRequest(ORIGIN, "/", { headers: { "x-forwarded-host": host, forwarded: `host=${host}` } });
    expect(visibleText(forgedOnPlatform.body)).toContain("Find HVAC service. Run the business behind it.");
    expect(visibleText(forgedOnPlatform.body)).not.toContain(headline);
    // A signed-in member's cookie on the customer's name reaches nothing of theirs.
    const cookie = workerTenant.storageState.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    for (const path of ["/overview", "/customers", "/api/session-state"]) expect((await onHost(host, path, { cookie })).status, path).toBe(404);
  });

  test("a name nobody has claimed, an inactive claim and a malformed Host are not the landing either", async ({ workerTenant }) => {
    expect((await onHost(uniqueHost("nobody"), "/")).status).toBe(404);
    const body = (await onHost(uniqueHost("nobody"), "/")).body;
    expect(body).not.toContain(HEADLINE);
    const host = uniqueHost("pending");
    await owner.pool.query(
      `insert into site_domains (organization_id, site_id, hostname, status, verification_token, is_primary)
       select organization_id, id, $2, 'pending_verification', $3, false from sites where organization_id = $1 and slug = 'main'`,
      [workerTenant.organizationId, host, randomBytes(32).toString("base64url")],
    );
    expect((await onHost(host, "/")).status).toBe(404);
    for (const bad of ["exa mple.com", "http://example.com", "a..b"]) {
      const response = await rawRequest(ORIGIN, "/", { host: bad });
      expect([400, 404], bad).toContain(response.status);
      expect(response.body).not.toContain(HEADLINE);
    }
  });

  test("a deployment's own name is the platform's however it is spelled, and one name's neighbours are not (a duckdns-style single host)", async () => {
    // The names the platform answers on come from configuration (APP_HOSTS and the host of BETTER_AUTH_URL), so a deployment at a name like
    // `climvia.duckdns.org` needs no code change: it is the platform, a different name under the same provider is a customer's candidate, and nobody can
    // claim the platform's own. (The rules themselves are held in entry-rules.spec.ts; here the running server answers for the name it is configured with.)
    const platform = await rawRequest(ORIGIN, "/", { host: `localhost:${PORT}` });
    expect(platform.status).toBe(200);
    expect(visibleText(platform.body)).toContain("Find HVAC service. Run the business behind it.");
    const lookalike = await rawRequest(ORIGIN, "/", { host: `localhost.example.test:${PORT}` });
    expect(lookalike.status).toBe(404);
  });
});

/** Make a fresh account the way a person would, to check what the front door does for each newcomer. */
test.describe("a newcomer", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("signs up, is taken to set up their business, and Log in and Sign up have nothing more to say to them once they have one", async ({ page }) => {
    const email = newEmail("entrynew");
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "List Your Business" }).first().click();
    await expect(page).toHaveURL(`${ORIGIN}/signup`);
    await page.getByLabel(/^Full name/).fill("Pat Newcomer");
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel(/^Password/).fill("Correct-horse-1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(`${ORIGIN}/onboarding`);
    // Someone with no business who goes home is sent back to set one up.
    await page.goto("/");
    await expect(page).toHaveURL(`${ORIGIN}/onboarding`);
  });
});
