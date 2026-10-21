/**
 * Phase 19B, driven in a browser as a visitor and as a business would use it: finding a provider by service and place, filters and pages, the empty
 * and mistyped searches, the clean Service and place pages, a provider's profile, booking from it, what the platform's suspension does to every public
 * surface, and a business keeping its own service areas.
 *
 * Every test makes its own providers (e2e/marketplace-helpers.ts) and finds them by a word in their names that nothing else has, so what other specs
 * publish in parallel cannot change what is on the page. No test here asserts on the index of the whole Marketplace.
 */
import { randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "playwright/test";
import { Pool } from "pg";
import { adminDb } from "../scripts/db/lib";
import { anonymous } from "./assets-helpers";
import { insertActiveClaim, rawRequest, uniqueHost } from "./domain-helpers";
import { SAMPLE_SERVICES, allow, makeProvider, suspend, uniqueZip, type Provider } from "./marketplace-helpers";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { captureAction, withFirstArgument } from "./replay";
import { NOT_SIGNED_IN, ORIGIN, expect, expectAccessible, test } from "./saas";
import { signInOverHttp } from "./fixtures";

// Every test makes its own providers, and a new business takes a few seconds to set up.
test.describe.configure({ timeout: 120_000 });

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

const word = () => `fam${randomBytes(4).toString("hex")}`;
const zip = uniqueZip;
const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;

const providers = (page: Page) => page.locator('ul[aria-label="Providers"] > li');
const card = (page: Page, name: string) => page.getByRole("article", { name });
const robots = (page: Page) => page.locator('meta[name="robots"]').getAttribute("content");
const canonical = (page: Page) => page.locator('link[rel="canonical"]').getAttribute("href");
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** What a visitor reads on a page: its text, not its markup. */
const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");

async function get(api: APIRequestContext, path: string) {
  const response = await api.get(path, { maxRedirects: 0 });
  return { status: response.status(), body: await response.text(), headers: response.headers() };
}

test.describe("a visitor finds a provider", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("the Marketplace opens with no sign-in and nothing of a workspace around it: a search, one heading, no claim it cannot back", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page).toHaveURL(/\/marketplace$/);
    await expect(page.getByRole("heading", { level: 1, name: "Find HVAC service in your area" })).toBeVisible();
    await expect(page.getByRole("search", { name: "Search providers" })).toBeVisible();
    await expect(page.getByLabel("What do you need?")).toBeVisible();
    await expect(page.getByLabel("Where?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Search providers" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    expect(await page.title()).toBe("Find HVAC service in your area · Climvia Marketplace");
    // Nothing that sounds like a promise the page cannot keep.
    const text = await page.locator("body").innerText();
    for (const claim of [/verified/i, /licensed/i, /guarantee/i, /best price/i, /save up to/i, /nationwide/i, /\bAI\b/, /response time/i, /available now/i, /top[- ]rated/i, /trusted by/i]) expect(text, String(claim)).not.toMatch(claim);
    await expectAccessible(page);
  });

  test("searching by service and place finds the provider that lists both, with a card made of its public facts only", async ({ page }) => {
    const fam = word();
    const where = zip();
    const here = await makeProvider("find", owner, { nameWord: fam, areas: [{ postal: where, label: "Test Side" }, { city: "Austin", state: "TX" }], reviews: [{ rating: 5 }, { rating: 4 }, { rating: 1, visibility: "private" }] });
    const away = await makeProvider("away", owner, { nameWord: fam, areas: [{ postal: "99940" }] });
    const nowhere = await makeProvider("nowhere", owner, { nameWord: fam });
    const record = (await owner.pool.query<{ phone: string; email: string }>("select phone, email from organizations where id = $1", [here.business.organizationId])).rows[0];

    await page.goto("/marketplace");
    await page.getByLabel("What do you need?").fill(`${fam} repair`);
    await page.getByLabel("Where?").fill(where);
    await page.getByRole("button", { name: "Search providers" }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}\\+repair&location=${where}$`));
    await expect(page.getByRole("heading", { level: 2, name: "1 provider" })).toBeVisible();
    await expect(providers(page)).toHaveCount(1);

    const found = card(page, here.name);
    await expect(found.getByRole("link", { name: here.name, exact: true })).toHaveAttribute("href", `/listings/${here.slug}?service=${SAMPLE_SERVICES.repair}&location=${where}`);
    await expect(found).toContainText("AC Repair & Diagnostics");
    await expect(found).toContainText("4.5 · 2 reviews");
    // The area the visitor asked for comes first, under the name the business gave it; the others are counted.
    await expect(found.getByText("Serves", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("Test Side +1");
    await expect(found.getByText("Booking", { exact: true }).locator("xpath=following-sibling::dd[1]")).not.toBeEmpty();
    await expect(found.getByRole("link", { name: /Request appointment with|Book a time with|Request a quote with/ })).toHaveAttribute("href", new RegExp(`^/listings/${here.slug}/book/${SAMPLE_SERVICES.repair}\\?service=${SAMPLE_SERVICES.repair}&location=${where}$`));

    // The other providers are not on the page, and nothing private is in it.
    await expect(page.getByText(away.name)).toHaveCount(0);
    await expect(page.getByText(nowhere.name)).toHaveCount(0);
    const html = await page.content();
    for (const secret of [record.phone, record.email, here.business.organizationId, here.listingId, here.business.owner.userId, here.business.owner.email, "Secret"]) expect(html, secret).not.toContain(secret);
    await expectAccessible(page);
  });

  test("a provider with no reviews says so and one with no listed places says that, and neither is found by a place", async ({ page }) => {
    const fam = word();
    const bare = await makeProvider("bare", owner, { nameWord: fam });
    await page.goto(`/marketplace?q=${fam}`);
    const found = card(page, bare.name);
    await expect(found.getByText("Rating", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("No reviews yet");
    await expect(found.getByText("Serves", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("Not listed");
    await expect(found.getByText("Not listed")).toBeVisible();
    // A place nobody listed finds nothing, and says why.
    await page.goto(`/marketplace?q=${fam}&location=78704`);
    await expect(page.getByText("No providers match this search")).toBeVisible();
    await expect(page.getByText(/A provider only appears for the places it lists/)).toBeVisible();
  });

  test("a search is made with the keyboard alone", async ({ page }) => {
    const fam = word();
    const provider = await makeProvider("keys", owner, { nameWord: fam });
    await page.goto("/marketplace");
    await page.getByLabel("What do you need?").focus();
    await page.keyboard.type(fam);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}$`));
    await expect(card(page, provider.name)).toBeVisible();
    // The way through the form is the order on the page: what, where, then the button.
    await page.goto("/marketplace");
    await page.getByLabel("What do you need?").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Where?")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Search providers" })).toBeFocused();
  });

  test("the words are read, not trusted: hostile and malformed searches get an ordinary page, never an error, and break nothing", async ({ page }) => {
    const api = await anonymous(address());
    try {
      const hostile = [
        "/marketplace?q=%27%3B+drop+table+organizations%3B+--",
        "/marketplace?q=%25",
        "/marketplace?q=_%25_&location=%25",
        "/marketplace?q=%5C&service=%27+OR+1%3D1",
        "/marketplace?q=(%3Fi)a%7Cb&category=%27",
        "/marketplace?q=%5Ba-z%5D%2B&booking=%27%3B--",
        "/marketplace?q=%00&location=%00",
        `/marketplace?q=${"x".repeat(5000)}`,
        "/marketplace?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
        "/marketplace?page=999999999999999999999&q=a",
        "/marketplace?page=-1&service=Not+A+Slug",
        "/marketplace?service=%E2%80%AE&location=%F0%9F%98%80",
        "/marketplace?q=a&q=b&page=1&page=2&location=x&location=y",
        "/marketplace/services/%27%3B--",
        "/marketplace/locations/%27%3B--",
        "/marketplace/services/ac-repair-diagnostics/%27%3B--",
        "/marketplace/locations/%2e%2e%2f%2e%2e",
      ];
      for (const path of hostile) {
        const answer = await get(api, path);
        expect([200, 307, 308, 404], path).toContain(answer.status);
        expect(visibleText(answer.body), path).not.toMatch(/syntax error|invalid regular expression|stack|at async|digest|ECONNREFUSED|SELECT |relation "/i);
      }
      // The database is as it was.
      expect((await owner.pool.query("select count(*)::int as n from organizations")).rows[0].n).toBeGreaterThan(0);
      // A query string that is not valid percent-encoding is read as far as it goes; a PATH that is not is refused plainly (400), never answered with a server error.
      expect((await rawRequest(ORIGIN, "/marketplace?q=%E0%A4%A", { headers: { "x-forwarded-for": address() } })).status).toBeLessThan(500);
      for (const path of ["/marketplace/locations/%E0%A4%A", "/marketplace/services/%E0%A4%A", "/listings/%E0%A4%A", "/listings/%E0%A4%A/book/%E0%A4%A", "/sites/%E0%A4%A"]) {
        const refused = await rawRequest(ORIGIN, path, { headers: { "x-forwarded-for": address() } });
        expect(refused.status, path).toBe(400);
        expect(refused.body, path).toBe("Bad request");
      }
    } finally {
      await api.dispose();
    }
    // The hostile words are printed back as text, never as markup.
    await page.goto(`/marketplace?q=${encodeURIComponent('<img src=x onerror="window.pwned=1">')}`);
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  });
});

test.describe("filters, pages and empty states", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("choosing a Service, a type of work or a way of booking narrows the list, marks what is chosen, and each choice can be taken off", async ({ page }) => {
    const fam = word();
    const a = await makeProvider("fa", owner, { nameWord: fam, services: [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp] });
    const b = await makeProvider("fb", owner, { nameWord: fam, services: [SAMPLE_SERVICES.repair] });
    const c = await makeProvider("fc", owner, { nameWord: fam, services: [SAMPLE_SERVICES.tuneUp] });
    await page.goto(`/marketplace?q=${fam}`);
    await expect(providers(page)).toHaveCount(3);
    const filters = page.getByTestId("marketplace-filters");
    await expect(filters.getByRole("link", { name: /^All services/ })).toHaveAttribute("aria-current", "true");
    await expect(filters.getByRole("link", { name: /^AC Repair & Diagnostics\s*2$/ })).toBeVisible();
    await expect(filters.getByRole("link", { name: /^Annual Cooling Tune-Up & Maintenance\s*2$/ })).toBeVisible();

    await filters.getByRole("link", { name: /^Annual Cooling Tune-Up/ }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}&service=${SAMPLE_SERVICES.tuneUp}$`));
    await expect(providers(page)).toHaveCount(2);
    await expect(card(page, a.name)).toBeVisible();
    await expect(card(page, c.name)).toBeVisible();
    await expect(card(page, b.name)).toHaveCount(0);
    await expect(page.getByTestId("marketplace-filters").getByRole("link", { name: /^Annual Cooling Tune-Up/ })).toHaveAttribute("aria-current", "true");
    // The card leads with the Service the visitor chose.
    await expect(card(page, a.name)).toContainText("Annual Cooling Tune-Up & Maintenance");
    // What is chosen is a chip that takes itself off.
    const chips = page.getByRole("list", { name: "Applied filters" });
    await expect(chips).toContainText(fam);
    await expect(chips).toContainText("Annual Cooling Tune-Up & Maintenance");
    await chips.getByRole("link", { name: /Annual Cooling Tune-Up/ }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}$`));
    await expect(providers(page)).toHaveCount(3);

    // A way of booking: only Services that can really be booked that way, and the filter says how many providers.
    const method = (await owner.pool.query<{ booking_method: string }>("select booking_method from services where organization_id = $1 and slug = $2", [a.business.organizationId, SAMPLE_SERVICES.tuneUp])).rows[0].booking_method;
    await page.goto(`/marketplace?q=${fam}&booking=${method}`);
    await expect(providers(page)).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Applied filters" })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}$`));
    await expect(providers(page)).toHaveCount(3);
  });

  test("a place chosen from the list is a clean page, with the Service and the place in the address, and the list of places is only what providers listed", async ({ page }) => {
    const fam = word();
    const a = zip();
    const b = zip();
    const p1 = await makeProvider("pa", owner, { nameWord: fam, areas: [{ postal: a }, { postal: b }] });
    await makeProvider("pb", owner, { nameWord: fam, areas: [{ postal: a }] });
    await page.goto(`/marketplace?q=${fam}`);
    const filters = page.getByTestId("marketplace-filters");
    await expect(filters.getByRole("link", { name: new RegExp(`^${a}\\s*2$`) })).toBeVisible();
    await expect(filters.getByRole("link", { name: new RegExp(`^${b}\\s*1$`) })).toBeVisible();
    await filters.getByRole("link", { name: new RegExp(`^${b}\\s*1$`) }).click();
    await expect(providers(page)).toHaveCount(1);
    await expect(card(page, p1.name)).toBeVisible();
    // With words in the search the place stays in the query, written the way a person writes it.
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}&location=${b}$`));
    await expect(page.getByLabel("Where?")).toHaveValue(b);
  });

  test("results come in pages of twelve, each with an address of its own, in an order that does not change; a page that is not there says so", async ({ page }) => {
    test.setTimeout(240_000);
    const fam = word();
    const made: Provider[] = [];
    for (let batch = 0; batch < 13; batch += 3) {
      made.push(...(await Promise.all(Array.from({ length: Math.min(3, 13 - batch) }, (_, index) => makeProvider(`pg${batch + index}`, owner, { nameWord: fam })))));
    }
    await page.goto(`/marketplace?q=${fam}`);
    await expect(page.getByRole("heading", { level: 2, name: "13 providers" })).toBeVisible();
    await expect(providers(page)).toHaveCount(12);
    await expect(page.getByText("Showing 1–12 of 13")).toBeVisible();
    const first = await providers(page).getByRole("heading").allInnerTexts();

    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager.getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await expect(pager.getByRole("link", { name: "Previous" })).toHaveCount(0);
    await pager.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}&page=2$`));
    await expect(providers(page)).toHaveCount(1);
    await expect(page.getByText("Showing 13–13 of 13")).toBeVisible();
    const second = await providers(page).getByRole("heading").allInnerTexts();
    expect(new Set([...first, ...second]).size).toBe(13);
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next" })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Previous" }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}$`));
    expect(await providers(page).getByRole("heading").allInnerTexts()).toEqual(first);

    // The same address, loaded again, is the same page.
    await page.goto(`/marketplace?q=${fam}&page=2`);
    expect(await providers(page).getByRole("heading").allInnerTexts()).toEqual(second);
    // A page past the end is said to be past the end, with the way back; a page number that makes no sense is the first page.
    await page.goto(`/marketplace?q=${fam}&page=3`);
    await expect(page.getByText("That page of results doesn't exist")).toBeVisible();
    await page.getByRole("link", { name: "Go to the first page" }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=${fam}$`));
    for (const bad of ["0", "-3", "abc", "1.5", "99999"]) {
      await page.goto(`/marketplace?q=${fam}&page=${bad}`);
      expect(await providers(page).getByRole("heading").allInnerTexts(), `page=${bad}`).toEqual(first);
    }
  });

  test("a page of results does not make the server draw every page it links to: nothing is prefetched, so a visitor's page view is one page view", async ({ page }) => {
    const fam = word();
    await makeProvider("quiet1", owner, { nameWord: fam, areas: [{ postal: zip() }] });
    await makeProvider("quiet2", owner, { nameWord: fam });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("_rsc=")) requests.push(request.url());
    });
    for (const path of ["/marketplace", `/marketplace?q=${fam}`, `/marketplace?q=${fam}&service=${SAMPLE_SERVICES.repair}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(1500);
    }
    expect(requests).toEqual([]);
    // Following a link still works (it is fetched when it is followed).
    await page.goto(`/marketplace?q=${fam}`);
    await page.getByTestId("marketplace-filters").getByRole("link", { name: /^AC Repair & Diagnostics/ }).click();
    await expect(page).toHaveURL(`/marketplace?q=${fam}&service=${SAMPLE_SERVICES.repair}`);
    await expect(providers(page)).toHaveCount(2);
  });

  test("a search with no result says what was searched and what to do, and a place that was not understood is said so and left out", async ({ page }) => {
    const fam = word();
    const provider = await makeProvider("empty", owner, { nameWord: fam, areas: [{ postal: zip() }] });
    await page.goto(`/marketplace?q=${fam}+nosuchthing`);
    await expect(page.getByRole("heading", { level: 2, name: "No providers match this search" })).toBeVisible();
    await expect(page.getByText("No provider matches all of the words and filters in this search.")).toBeVisible();
    await page.getByRole("link", { name: "Clear the search" }).click();
    await expect(page).toHaveURL(/\/marketplace$/);

    await page.goto(`/marketplace?q=${fam}&location=99999`);
    await expect(page.getByText(/No provider has listed 99999 as a place it works/)).toBeVisible();

    await page.goto(`/marketplace?q=${fam}&location=zzz!!`);
    await expect(page.getByRole("status")).toContainText("We didn't recognize “zzz!!” as a place, so it isn't applied.");
    await expect(card(page, provider.name)).toBeVisible();
    await expect(page.getByLabel("Where?")).toHaveValue("zzz!!");
    expect(await robots(page)).toContain("noindex");
    await expectAccessible(page);
  });
});

test.describe("the Service and place pages, and what a search engine is told", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a search that only names a Service or a place goes to that page's clean address, and a tidy one is left alone", async ({ page }) => {
    const where = zip();
    await makeProvider("tidy", owner, { areas: [{ postal: where }] });
    await page.goto(`/marketplace?location=${where}`);
    await expect(page).toHaveURL(new RegExp(`/marketplace/locations/${where}$`));
    await page.goto(`/marketplace?service=${SAMPLE_SERVICES.repair}&location=${where}`);
    await expect(page).toHaveURL(new RegExp(`/marketplace/services/${SAMPLE_SERVICES.repair}/${where}$`));
    await page.goto(`/marketplace?service=${SAMPLE_SERVICES.repair}`);
    await expect(page).toHaveURL(new RegExp(`/marketplace/services/${SAMPLE_SERVICES.repair}$`));
    await page.goto("/marketplace?q=&location=");
    await expect(page).toHaveURL(/\/marketplace$/);
    // With words, or another filter, the address is already the right one.
    await page.goto(`/marketplace?q=repair&location=${where}`);
    await expect(page).toHaveURL(new RegExp(`/marketplace\\?q=repair&location=${where}$`));
  });

  test("a place page lists the providers that listed it, says what it is, and may be indexed; a place nobody listed is empty and is not", async ({ page }) => {
    const where = zip();
    const provider = await makeProvider("place", owner, { areas: [{ postal: where }] });
    await page.goto(`/marketplace/locations/${where}`);
    await expect(page.getByRole("heading", { level: 1, name: `HVAC service in ${where}` })).toBeVisible();
    await expect(providers(page)).toHaveCount(1);
    await expect(card(page, provider.name)).toBeVisible();
    expect(await page.title()).toBe(`HVAC service in ${where} · Climvia Marketplace`);
    expect(await robots(page)).toBe("index, follow");
    expect(await canonical(page)).toBe(`${ORIGIN}/marketplace/locations/${where}`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", `Compare 1 HVAC provider that work in ${where} on Climvia Marketplace.`);
    // The search box on it keeps the place.
    await expect(page.getByLabel("Where?")).toHaveValue(where);
    await expectAccessible(page);

    await page.goto("/marketplace/locations/99997");
    await expect(page.getByRole("heading", { level: 1, name: "HVAC service in 99997" })).toBeVisible();
    await expect(page.getByText("No providers match this search")).toBeVisible();
    expect(await robots(page)).toBe("noindex, follow");
    expect(await page.locator('link[rel="canonical"]').count()).toBe(0);
  });

  test("a Service-in-place page exists for a combination a provider really has, and carries both in its heading and address", async ({ page }) => {
    const where = zip();
    await makeProvider("combo", owner, { services: [SAMPLE_SERVICES.repair], areas: [{ postal: where }] });
    await page.goto(`/marketplace/services/${SAMPLE_SERVICES.repair}/${where}`);
    await expect(page.getByRole("heading", { level: 1, name: `AC Repair & Diagnostics in ${where}` })).toBeVisible();
    await expect(providers(page)).toHaveCount(1);
    expect(await robots(page)).toBe("index, follow");
    expect(await canonical(page)).toBe(`${ORIGIN}/marketplace/services/${SAMPLE_SERVICES.repair}/${where}`);
    // Another Service in the same place has nobody: an empty page, not a page of someone else.
    await page.goto(`/marketplace/services/${SAMPLE_SERVICES.ductless}/${where}`);
    await expect(providers(page)).toHaveCount(0);
    await expect(page.getByText("No providers match this search")).toBeVisible();
    expect(await robots(page)).toBe("noindex, follow");
    // A later page of a clean page, and a search with words, are not indexed.
    await page.goto(`/marketplace/services/${SAMPLE_SERVICES.repair}/${where}?page=2`);
    expect(await robots(page)).toContain("noindex");
    await page.goto(`/marketplace?q=repair&location=${where}`);
    expect(await robots(page)).toContain("noindex");
    expect(await page.locator('link[rel="canonical"]').count()).toBe(0);
  });

  test("an address that is not a Service or a place at all is the plain page that is not found, not an empty page", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/404/);
    for (const path of ["/marketplace/services/NOT_A_SLUG", "/marketplace/locations/not%20a%20place", "/marketplace/locations/AUSTIN-TX", "/marketplace/nothing/here", "/marketplace/services", "/marketplace/services/a/b/c"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    }
  });

  test("the sitemap lists the Marketplace's real pages and the providers a visitor can open, and no one else; robots.txt points to it", async () => {
    const where = zip();
    const live = await makeProvider("smlive", owner, { services: [SAMPLE_SERVICES.repair], areas: [{ postal: where }] });
    const hidden = await makeProvider("smhid", owner, { status: "hidden", areas: [{ postal: "99941" }] });
    const suspended = await makeProvider("smsus", owner, { suspended: true, areas: [{ postal: "99942" }] });
    const api = await anonymous(address());
    try {
      const sitemap = await api.get("/sitemap.xml");
      expect(sitemap.status()).toBe(200);
      expect(sitemap.headers()["content-type"]).toContain("application/xml");
      const xml = await sitemap.text();
      expect(xml.startsWith('<?xml version="1.0"?>')).toBe(true);
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      for (const path of [`/listings/${live.slug}`, `/marketplace/locations/${where}`, `/marketplace/services/${SAMPLE_SERVICES.repair}/${where}`, "/marketplace"]) expect(xml, path).toContain(`<loc>${ORIGIN}${path}</loc>`);
      for (const gone of [hidden.slug, suspended.slug, "/marketplace/locations/99941", "/marketplace/locations/99942"]) expect(xml, gone).not.toContain(gone);
      // Every address is the platform's own, absolute, and nothing in it is made up: no query strings, no search pages.
      const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc);
      for (const loc of locs) {
        expect(loc.startsWith(`${ORIGIN}/`), loc).toBe(true);
        expect(loc, loc).not.toContain("?");
        expect(loc, loc).toMatch(/^[^<>&"']+$/);
      }
      expect(new Set(locs).size).toBe(locs.length);
      // Every page it names is a page (no 404 in the sitemap).
      for (const loc of [`/listings/${live.slug}`, `/marketplace/locations/${where}`]) expect((await api.get(loc)).status(), loc).toBe(200);

      const file = await api.get("/robots.txt");
      expect(file.status()).toBe(200);
      const text = await file.text();
      expect(text).toContain("User-agent: *");
      expect(text).toContain("Allow: /marketplace$");
      expect(text).toContain("Allow: /listings/");
      expect(text).toContain("Disallow: /");
      expect(text).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
      // The platform's workspace is not offered to a crawler.
      expect(text).not.toMatch(/Allow: \/(settings|customers|bookings|platform-admin|marketplace-listing)/);

      // Suspend the live one: it leaves the sitemap at once, and comes back when allowed.
      await suspend(owner.pool, live.listingId);
      expect(await (await api.get("/sitemap.xml")).text()).not.toContain(live.slug);
      await allow(owner.pool, live.listingId);
      expect(await (await api.get("/sitemap.xml")).text()).toContain(`/listings/${live.slug}`);
    } finally {
      await api.dispose();
    }
  });

  test("a customer's own domain never shows the Marketplace, its sitemap or its robots file: there is no fallback to the platform", async () => {
    const provider = await makeProvider("domain", owner, {});
    const host = uniqueHost("mkt");
    await insertActiveClaim(owner.pool, provider.business.organizationId, host);
    for (const path of ["/marketplace", "/marketplace/locations/78704", "/marketplace/services/ac-repair-diagnostics", `/listings/${provider.slug}`, "/sitemap.xml", "/robots.txt"]) {
      for (const hostName of [host, uniqueHost("nobody")]) {
        const response = await rawRequest(ORIGIN, path, { host: hostName, headers: { "x-forwarded-for": address() } });
        expect(response.status, `${hostName}${path}`).toBe(404);
        expect(response.body, `${hostName}${path}`).not.toContain("Climvia Marketplace");
        expect(response.body, `${hostName}${path}`).not.toContain(provider.name);
      }
    }
  });
});

test.describe("a provider's profile", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("it shows the business's own choices and its public reviews, and not a contact detail it turned off", async ({ page }) => {
    const fam = word();
    const provider = await makeProvider("profile", owner, {
      nameWord: fam,
      areas: [{ city: "Austin", state: "TX" }, { postal: "78704", label: "South Austin" }],
      services: [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp, SAMPLE_SERVICES.heatPump],
      reviews: [
        { rating: 5, reviewer: "Pat Jones", text: "Fixed it the same day.", on: "2024-10-25" },
        { rating: 4, reviewer: "Ana de la Cruz", text: "Kind and on time.", on: "2024-10-20" },
        { rating: 1, reviewer: "Hidden Person", text: "Words kept private.", visibility: "private" },
      ],
      show: { phone: false, email: false, address: false },
      description: "We keep Austin cool, and we say what we will do before we do it.",
    });
    const record = (await owner.pool.query<{ phone: string; email: string; address_line1: string }>("select phone, email, address_line1 from organizations where id = $1", [provider.business.organizationId])).rows[0];
    await page.goto(`/listings/${provider.slug}?service=${SAMPLE_SERVICES.tuneUp}&location=austin-tx`);
    await expect(page.getByRole("heading", { level: 1, name: provider.name })).toBeVisible();
    await expect(page.getByText("We keep Austin cool, and we say what we will do before we do it.")).toBeVisible();
    // The rating from the public reviews only: two of them, 4.5.
    await expect(page.getByRole("link", { name: /Rated 4\.5 out of 5 from 2 reviews/ })).toBeVisible();
    const reviews = page.getByRole("region", { name: "Reviews" });
    await expect(reviews.getByRole("listitem")).toHaveCount(2);
    await expect(reviews).toContainText("Pat J.");
    await expect(reviews).toContainText("Ana C.");
    await expect(reviews).toContainText("Oct 25, 2024");
    await expect(reviews).toContainText("Fixed it the same day.");
    // Where it works, as the business listed it.
    const areas = page.getByRole("region", { name: "Where we work" });
    await expect(areas.getByRole("listitem")).toHaveText(["Austin, TX", "South Austin"]);
    // The Services it shows, each with its own way in.
    const services = page.getByRole("region", { name: "Services" });
    await expect(services.getByRole("listitem")).toHaveCount(3);
    await expect(services.getByRole("link", { name: /Book a time Annual Cooling Tune-Up/ })).toHaveAttribute("href", `/listings/${provider.slug}/book/${SAMPLE_SERVICES.tuneUp}?service=${SAMPLE_SERVICES.tuneUp}&location=austin-tx`);
    // The way back is to the results it came from.
    await expect(page.getByRole("link", { name: "Back to results" })).toHaveAttribute("href", `/marketplace/services/${SAMPLE_SERVICES.tuneUp}/austin-tx`);
    expect(await canonical(page)).toBe(`${ORIGIN}/listings/${provider.slug}`);

    // Nothing the business turned off, and nothing private, is anywhere in the page.
    const html = await page.content();
    for (const hidden of [record.phone, record.email, record.address_line1, "Hidden Person", "Words kept private", "Pat Jones", "Ana de la Cruz", provider.business.organizationId, provider.listingId, provider.business.owner.email]) expect(html, hidden).not.toContain(hidden);
    await expect(page.getByText("Phone", { exact: true })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("a business without a published website offers no website or contact button, and one with a site links to the site, a different page from the profile", async ({ page, workerTenant }) => {
    const bare = await makeProvider("nosite", owner, {});
    await page.goto(`/listings/${bare.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: bare.name })).toBeVisible();
    await expect(page.getByRole("link", { name: "View website" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Contact business" })).toHaveCount(0);
    // No button that is only the look of one.
    await expect(page.locator("main span", { hasText: /^(View website|Contact business)$/ })).toHaveCount(0);

    await page.goto(`/listings/${workerTenant.listingSlug}`);
    await expect(page.getByRole("link", { name: "View website" })).toHaveAttribute("href", `/sites/${workerTenant.platformSlug}`);
    expect(new URL(page.url()).pathname).toBe(`/listings/${workerTenant.listingSlug}`);
  });

  test("with nothing to show about reviews or places, the profile does not make a section up", async ({ page }) => {
    const provider = await makeProvider("quiet", owner, {});
    await page.goto(`/listings/${provider.slug}`);
    await expect(page.getByRole("region", { name: "Reviews" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Where we work" })).toHaveCount(0);
    await expect(page.getByText(/Rated \d/)).toHaveCount(0);
  });

  test("a provider that is hidden, a draft, suspended or unknown has no profile and no booking page, all the same plain page", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/404/);
    const hidden = await makeProvider("h", owner, { status: "hidden" });
    const draft = await makeProvider("d", owner, { status: "draft" });
    const suspended = await makeProvider("s", owner, { suspended: true });
    for (const slug of [hidden.slug, draft.slug, suspended.slug, "no-such-provider"]) {
      for (const path of [`/listings/${slug}`, `/listings/${slug}/book/${SAMPLE_SERVICES.tuneUp}`]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
        await expect(page.locator("body")).not.toContainText(/suspend|moderat|reason/i);
      }
    }
  });
});

test.describe("what the platform's suspension does, everywhere a visitor could meet the provider", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a suspended provider is in no search, page, facet, sitemap or booking page, and is back as it was when allowed", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/404/);
    const fam = word();
    const where = zip();
    const provider = await makeProvider("susp", owner, { nameWord: fam, areas: [{ postal: where }] });
    const api = await anonymous(address());
    const reach = async () => ({
      search: visibleText((await get(api, `/marketplace?q=${fam}`)).body).includes(provider.name),
      place: visibleText((await get(api, `/marketplace/locations/${where}`)).body).includes(provider.name),
      profile: (await get(api, `/listings/${provider.slug}`)).status,
      booking: (await get(api, `/listings/${provider.slug}/book/${SAMPLE_SERVICES.tuneUp}`)).status,
      sitemap: (await get(api, "/sitemap.xml")).body.includes(provider.slug),
    });
    try {
      expect(await reach()).toEqual({ search: true, place: true, profile: 200, booking: 200, sitemap: true });
      await suspend(owner.pool, provider.listingId);
      expect(await reach()).toEqual({ search: false, place: false, profile: 404, booking: 404, sitemap: false });
      // The place page that is now empty says nothing of why, and the filters offer nothing of it.
      await page.goto(`/marketplace/locations/${where}`);
      await expect(page.getByText("No providers match this search")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/suspend/i);
      // The business's record is untouched.
      expect((await owner.pool.query("select status from marketplace_listings where id = $1", [provider.listingId])).rows[0].status).toBe("published");
      await allow(owner.pool, provider.listingId);
      expect(await reach()).toEqual({ search: true, place: true, profile: 200, booking: 200, sitemap: true });
    } finally {
      await api.dispose();
    }
  });

  test("a provider is public only when the business has published it AND the platform allows it: neither alone is enough", async () => {
    const fam = word();
    const provider = await makeProvider("both", owner, { nameWord: fam });
    const api = await anonymous(address());
    const found = async () => (await get(api, `/listings/${provider.slug}`)).status === 200 && visibleText((await get(api, `/marketplace?q=${fam}`)).body).includes(provider.name);
    try {
      const setStatus = (status: string) => owner.pool.query("update marketplace_listings set status = $2 where id = $1", [provider.listingId, status]);
      const matrix: [string, boolean, boolean][] = [
        ["published", true, true],
        ["hidden", true, false],
        ["published", false, false],
        ["hidden", false, false],
      ];
      for (const [status, allowed, expected] of matrix) {
        await setStatus(status);
        if (allowed) await allow(owner.pool, provider.listingId);
        else await suspend(owner.pool, provider.listingId);
        expect(await found(), `${status}, ${allowed ? "allowed" : "suspended"}`).toBe(expected);
      }
      // Publishing while suspended changes nothing for the public; allowing while hidden changes nothing either.
      await setStatus("published");
      await suspend(owner.pool, provider.listingId);
      expect(await found()).toBe(false);
      await setStatus("hidden");
      await allow(owner.pool, provider.listingId);
      expect(await found()).toBe(false);
      await setStatus("published");
      expect(await found()).toBe(true);
    } finally {
      await api.dispose();
    }
  });
});

test.describe("booking from a provider's profile", () => {
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

  test("a visitor books from the profile: it is a Marketplace booking of that listing, with what they were looking at, and nothing else came with it", async ({ page, workerTenant, db }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/listings/${workerTenant.listingSlug}?service=annual-cooling-tune-up&location=austin-tx`);
    await page.getByRole("region", { name: "Services" }).getByRole("link", { name: /Book a time Annual Cooling Tune-Up/ }).click();
    await expect(page).toHaveURL(new RegExp(`/listings/${workerTenant.listingSlug}/book/annual-cooling-tune-up\\?service=annual-cooling-tune-up&location=austin-tx$`));
    await expect(page.getByText("Instant booking · 60 mins")).toBeVisible();
    await fill(page, "Jordan Visitor", email);
    await page.getByRole("button", { name: "Confirm booking" }).click();
    const done = page.getByRole("region", { name: "Instant booking confirmed" });
    await expect(done).toContainText(/BK-\d{4}/);
    await expect(done).toContainText("Tue, Oct 29 · 11:30 AM – 12:30 PM");

    const rows = (await db.query("select b.status, b.source, b.customer_id, b.contact_name, cu.name as customer_name, b.marketplace_listing_id, b.discovery_service, b.discovery_location, l.public_slug from bookings b join marketplace_listings l on l.id = b.marketplace_listing_id left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = $1 and (b.contact_email = $2 or cu.email_key = lower($2))", [workerTenant.organizationId, email])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "confirmed", source: "Marketplace", customer_id: expect.any(String), contact_name: null, customer_name: "Jordan Visitor", discovery_service: "annual-cooling-tune-up", discovery_location: "austin-tx", public_slug: workerTenant.listingSlug });
    // No job, quote, invoice or payment, and the visitor sees nothing of the business's other bookings.
    expect((await db.query("select count(*)::int as n from jobs where organization_id = $1 and booking_id = (select b.id from bookings b left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = $1 and (b.contact_email = $2 or cu.email_key = lower($2)))", [workerTenant.organizationId, email])).rows[0].n).toBe(0);
    expect(await page.locator("body").innerText()).not.toMatch(/Sarah Mitchell|David Chen/);
    // The way back from the confirmation is the provider's profile, never the business's website.
    await expect(page.getByRole("link", { name: /Back to|Back/ }).first()).toHaveAttribute("href", /\/listings\//);
  });

  test("a request-appointment Service is pending, and the business's own Bookings show it as coming from the Marketplace", async ({ page, workerTenant, db, browser }) => {
    const email = `visitor-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/listings/${workerTenant.listingSlug}/book/ac-repair-diagnostics`);
    await page.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await page.getByRole("radio", { name: /^Midday/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill("Casey Marketplace");
    await page.getByLabel(/^Phone number/).fill("(512) 555-0112");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Service address/).fill("5 Barton Hills Dr, Austin, TX 78704");
    await page.getByLabel(/primary cooling issue/).selectOption("Blowing warm air");
    await page.getByRole("button", { name: "Submit appointment request" }).click();
    await expect(page.getByRole("region", { name: "Appointment request submitted" })).toContainText(/BK-\d{4}/);
    expect((await db.query("select b.status, b.source, b.discovery_service from bookings b left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = $1 and (b.contact_email = $2 or cu.email_key = lower($2))", [workerTenant.organizationId, email])).rows).toEqual([{ status: "pending", source: "Marketplace", discovery_service: null }]);

    const staff = await browser.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState, extraHTTPHeaders: { "x-forwarded-for": address() } });
    try {
      const owner = await staff.newPage();
      await owner.goto("/bookings");
      const row = owner.getByRole("table", { name: "Requests bookings" }).locator("tbody tr", { hasText: "Casey Marketplace" });
      await expect(row).toContainText("AC Repair & Diagnostics");
      await expect(row).toContainText("Marketplace");
      await expect(row).toContainText("Pending");
    } finally {
      await staff.close();
    }
  });

  test("the page that is open when the platform suspends the provider cannot make a booking, and says so plainly", async ({ page, workerTenant, db }) => {
    const email = `late-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/listings/${workerTenant.listingSlug}/book/annual-cooling-tune-up`);
    await fill(page, "Late Visitor", email);
    const listing = (await db.query<{ id: string }>("select id from marketplace_listings where organization_id = $1", [workerTenant.organizationId])).rows[0].id;
    await suspend(db, listing);
    try {
      await page.getByRole("button", { name: "Confirm booking" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "This provider isn't taking online bookings right now." })).toBeVisible();
      // Refused: no booking, and no customer made from the refused request.
      expect((await db.query("select count(*)::int as n from bookings b left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = $1 and (b.contact_email = $2 or cu.email_key = lower($2))", [workerTenant.organizationId, email])).rows[0].n).toBe(0);
      expect((await db.query("select count(*)::int as n from customers where organization_id = $1 and email_key = lower($2)", [workerTenant.organizationId, email])).rows[0].n).toBe(0);
      await expect(page.locator("body")).not.toContainText(/suspend|moderat/i);
    } finally {
      // The worker's listing is shared by the tests that follow: it is allowed again whatever happened.
      await allow(db, listing);
    }
  });

  test("the booking call names a listing and a Service and nothing else: forged fields, another business's Service and a closed listing change nothing", async ({ page, workerTenant, db }) => {
    const email = `forge-${randomBytes(3).toString("hex")}@example.test`;
    await page.goto(`/listings/${workerTenant.listingSlug}/book/annual-cooling-tune-up`);
    await fill(page, "Forge Visitor", email);
    const captured = await captureAction(page, () => page.getByRole("button", { name: "Confirm booking" }).click());
    await expect(page.getByRole("region", { name: "Instant booking confirmed" })).toBeVisible();

    const other = await makeProvider("forge", owner, { services: [SAMPLE_SERVICES.repair] });
    const northstar = (await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const closed = await makeProvider("closed", owner, { status: "hidden" });
    const count = async (organizationId: string) => (await db.query("select count(*)::int as n from bookings where organization_id = $1", [organizationId])).rows[0].n as number;
    const before = { apex: await count(workerTenant.organizationId), north: await count(northstar), other: await count(other.business.organizationId), closed: await count(closed.business.organizationId) };

    const api = await anonymous(address());
    try {
      const send = (change: (argument: Record<string, unknown>) => void, forwarded = address()) =>
        api.post(captured.url, { headers: { ...captured.headers, origin: ORIGIN, "x-forwarded-for": forwarded }, data: withFirstArgument(captured, (argument) => { argument.submissionKey = randomBytes(8).toString("hex"); change(argument); }) });

      // A listing that is hidden, a Service the listing does not show, and an address that is not one: nothing is booked anywhere.
      await send((argument) => { argument.listingSlug = closed.slug; });
      await send((argument) => { argument.listingSlug = other.slug; });
      await send((argument) => { argument.serviceSlug = SAMPLE_SERVICES.heatPump; argument.listingSlug = other.slug; });
      await send((argument) => { argument.listingSlug = "'; drop table bookings; --"; });
      await send((argument) => { argument.serviceSlug = "'; drop table bookings; --"; });
      expect({ apex: await count(workerTenant.organizationId), north: await count(northstar), other: await count(other.business.organizationId), closed: await count(closed.business.organizationId) }).toEqual({ ...before, other: before.other });

      // Fields no one asked for (an organization, a source, a listing, a status, a number) are not read: what is booked is the listing's own, from the Marketplace.
      await send((argument) => {
        argument.organizationId = northstar;
        argument.source = "Website";
        argument.marketplaceListingId = other.listingId;
        argument.status = "confirmed";
        argument.number = 1;
        argument.discoveryService = "'; drop table bookings; --";
        argument.discoveryLocation = "x".repeat(200);
      });
      expect(await count(northstar)).toBe(before.north);
      expect(await count(other.business.organizationId)).toBe(before.other);
      const created = (await db.query("select b.source, b.marketplace_listing_id, b.discovery_service, b.discovery_location, b.organization_id from bookings b left join customers cu on cu.organization_id = b.organization_id and cu.id = b.customer_id where b.organization_id = $1 and (b.contact_email = $2 or cu.email_key = lower($2)) order by b.received_at desc", [workerTenant.organizationId, email])).rows;
      for (const row of created) expect(row).toMatchObject({ source: "Marketplace", organization_id: workerTenant.organizationId });
      expect(created.some((row) => row.discovery_service === "'; drop table bookings; --")).toBe(false);
    } finally {
      await api.dispose();
    }
  });
});

test.describe("on a phone", () => {
  test.use({ storageState: NOT_SIGNED_IN, viewport: { width: 390, height: 844 } });

  test("no page of the Marketplace scrolls sideways, and the filters fold behind one button that works with the keyboard", async ({ page, workerTenant }) => {
    const fam = word();
    const where = zip();
    const provider = await makeProvider("phone", owner, { nameWord: `${fam}${"x".repeat(30)}`, areas: [{ postal: where, label: "A neighborhood with a rather long name to wrap" }], reviews: [{ rating: 5 }] });
    for (const path of ["/marketplace", `/marketplace?q=${fam}`, `/marketplace/locations/${where}`, `/marketplace?q=${fam}&location=99999`, `/listings/${provider.slug}`, `/listings/${workerTenant.listingSlug}`, `/listings/${workerTenant.listingSlug}/book/annual-cooling-tune-up`]) {
      await page.goto(path);
      expect(await noOverflow(page), path).toBeLessThanOrEqual(0);
    }
    await page.goto(`/marketplace?q=${fam}`);
    const toggle = page.getByRole("button", { name: /^Filters/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("marketplace-filters")).toBeHidden();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("marketplace-filters")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // On a wide screen they are simply there, with no button.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByTestId("marketplace-filters")).toBeVisible();
    await expect(toggle).toBeHidden();
  });
});

test.describe("nothing of one business is on another's public pages", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a provider's search result, profile and booking page carry nothing of the standing sample businesses or of any account", async () => {
    const fam = word();
    const provider = await makeProvider("isolated", owner, { nameWord: fam, areas: [{ postal: zip() }], reviews: [{ rating: 5, reviewer: "Quinn Public" }] });
    const api = await anonymous(address());
    try {
      const pages = [`/marketplace?q=${fam}`, `/listings/${provider.slug}`, `/listings/${provider.slug}/book/${SAMPLE_SERVICES.tuneUp}`];
      const people = (await owner.pool.query<{ name: string; email: string; id: string }>("select name, email, id from auth_user where email not like '%@example.test'")).rows;
      const organizations = (await owner.pool.query<{ id: string; name: string }>("select id, name from organizations where id <> $1 and name !~ 'Logo Test|Meridian|Apex E2E'", [provider.business.organizationId])).rows;
      for (const path of pages) {
        const body = (await get(api, path)).body;
        const text = visibleText(body);
        for (const person of people) {
          expect(body, `${path}: ${person.email}`).not.toContain(person.email);
          expect(body, `${path}: ${person.id}`).not.toContain(person.id);
        }
        for (const org of organizations) expect(body, `${path}: ${org.id}`).not.toContain(org.id);
        for (const secret of ["Sarah Mitchell", "David Chen", "Elena Ruiz", "Marcus Silva", provider.business.owner.email, provider.business.admin.email, provider.business.member.email, provider.business.organizationId, provider.listingId, "Quinn Public"]) {
          expect(body.includes(secret) || text.includes(secret), `${path}: ${secret}`).toBe(false);
        }
        expect(body, path).not.toMatch(/climvia_org|canEditSettings|hasSampleData|"capabilities"/);
      }
    } finally {
      await api.dispose();
    }
  });
});

test.describe("a business keeps its own service areas", () => {
  const saveAndWaitUntilStored = async (page: Page) => {
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
    await expect(page.locator('div[role="status"]')).toContainText("Listing changes saved.");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  };
  const areas = (page: Page) => page.getByRole("region", { name: "Service areas" });
  const names = (page: Page) => areas(page).getByRole("list", { name: "Service areas" }).getByRole("listitem").locator("span.text-sm.font-medium");

  test("add, change, order and remove areas: the form checks them, the list is saved with the listing, and the public sees exactly what was saved", async ({ page, workerTenant, browser }) => {
    await page.goto("/marketplace-listing/edit");
    await expect(areas(page)).toBeVisible();
    await expect(names(page)).toHaveText(["Austin, TX", "South Austin", "78741", "Round Rock, TX"]);

    // Add a city and state.
    await areas(page).getByLabel("City", { exact: true }).fill("pflugerville");
    await areas(page).getByLabel("State", { exact: true }).selectOption("TX");
    await areas(page).getByRole("button", { name: "Add area" }).click();
    await expect(names(page)).toHaveText(["Austin, TX", "South Austin", "78741", "Round Rock, TX", "Pflugerville, TX"]);
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Listing preview" }).getByText("Pflugerville, TX")).toBeVisible();

    // The form checks what it is given, and says what to do.
    const problem = page.getByRole("alert").filter({ hasText: "Service area" });
    await areas(page).getByLabel("City", { exact: true }).fill("Dallas");
    await areas(page).getByRole("button", { name: "Add area" }).click();
    await expect(problem).toContainText("choose a US state for the city");
    await areas(page).getByLabel("State", { exact: true }).selectOption("TX");
    await areas(page).getByLabel("City", { exact: true }).fill("  AUSTIN ");
    await areas(page).getByRole("button", { name: "Add area" }).click();
    await expect(problem).toContainText("Austin, TX is already listed");
    await areas(page).getByRole("radio", { name: "ZIP code" }).check();
    await areas(page).getByRole("textbox", { name: "ZIP code" }).fill("787");
    await areas(page).getByRole("button", { name: "Add area" }).click();
    await expect(problem).toContainText("enter a five-digit US ZIP code");
    await areas(page).getByRole("textbox", { name: "ZIP code" }).fill("78741-1234");
    await areas(page).getByRole("button", { name: "Add area" }).click();
    await expect(problem).toContainText("78741 is already listed");
    await expect(names(page)).toHaveCount(5);

    // Change one, with the keyboard: Enter in a field adds or updates.
    await areas(page).getByRole("button", { name: "Edit South Austin" }).click();
    await expect(areas(page).getByRole("radio", { name: "ZIP code" })).toBeChecked();
    await expect(areas(page).getByRole("textbox", { name: "ZIP code" })).toHaveValue("78704");
    await areas(page).getByLabel("Name shown to customers (optional)").fill("Barton Hills");
    await areas(page).getByLabel("Name shown to customers (optional)").press("Enter");
    await expect(names(page)).toHaveText(["Austin, TX", "Barton Hills", "78741", "Round Rock, TX", "Pflugerville, TX"]);
    await expect(areas(page).getByRole("button", { name: "Add area" })).toBeVisible();

    // Order and remove.
    await areas(page).getByRole("button", { name: "Move Pflugerville, TX up" }).click();
    await areas(page).getByRole("button", { name: "Move Pflugerville, TX up" }).click();
    await areas(page).getByRole("button", { name: "Remove 78741" }).click();
    await expect(names(page)).toHaveText(["Austin, TX", "Barton Hills", "Pflugerville, TX", "Round Rock, TX"]);
    await expect(areas(page).getByRole("button", { name: "Move Austin, TX up" })).toBeDisabled();
    await expect(areas(page).getByRole("button", { name: "Move Round Rock, TX down" })).toBeDisabled();

    await saveAndWaitUntilStored(page);
    await page.reload();
    await expect(names(page)).toHaveText(["Austin, TX", "Barton Hills", "Pflugerville, TX", "Round Rock, TX"]);
    expect((await owner.pool.query("select coalesce(label, city || ', ' || state_region, postal_code) as shown from marketplace_service_areas where organization_id = $1 order by sort_order", [workerTenant.organizationId])).rows.map((row) => row.shown)).toEqual(["Austin, TX", "Barton Hills", "Pflugerville, TX", "Round Rock, TX"]);

    // The public sees what was saved: on the profile, and in a search by that place.
    const visitor = await browser.newContext({ baseURL: ORIGIN, storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
    try {
      const tab = await visitor.newPage();
      await tab.goto(`/listings/${workerTenant.listingSlug}`);
      await expect(tab.getByRole("region", { name: "Where we work" }).getByRole("listitem")).toHaveText(["Austin, TX", "Barton Hills", "Pflugerville, TX", "Round Rock, TX"]);
      await tab.goto("/marketplace/locations/pflugerville-tx");
      await expect(tab.locator(`a[href^="/listings/${workerTenant.listingSlug}"]`).first()).toBeVisible();
      await tab.goto("/marketplace/locations/78741");
      await expect(tab.locator(`a[href^="/listings/${workerTenant.listingSlug}"]`)).toHaveCount(0);
    } finally {
      await visitor.close();
    }

    // Leave none: the listing is still found by its name and Services, and by no place.
    for (const name of ["Austin, TX", "Barton Hills", "Pflugerville, TX", "Round Rock, TX"]) await areas(page).getByRole("button", { name: `Remove ${name}` }).click();
    await expect(areas(page)).toContainText("No service areas yet.");
    await saveAndWaitUntilStored(page);
    const nowhere = await browser.newContext({ baseURL: ORIGIN, storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
    try {
      const tab = await nowhere.newPage();
      await tab.goto("/marketplace/locations/pflugerville-tx");
      await expect(tab.locator(`a[href^="/listings/${workerTenant.listingSlug}"]`)).toHaveCount(0);
      await tab.goto(`/listings/${workerTenant.listingSlug}`);
      await expect(tab.getByRole("region", { name: "Where we work" })).toHaveCount(0);
      await expect(tab.getByRole("heading", { level: 1 })).toBeVisible();
    } finally {
      await nowhere.close();
    }
  });

  test("unsaved edits to the areas are guarded like the rest of the listing: they can be discarded, and nothing is stored until Save", async ({ page, workerTenant }) => {
    await page.goto("/marketplace-listing/edit");
    await areas(page).getByLabel("City", { exact: true }).fill("Temple");
    await areas(page).getByLabel("State", { exact: true }).selectOption("TX");
    await areas(page).getByRole("button", { name: "Add area" }).click();
    await expect(names(page)).toHaveCount(5);
    await page.getByRole("button", { name: "Discard" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(names(page)).toHaveText(["Austin, TX", "South Austin", "78741", "Round Rock, TX"]);
    expect((await owner.pool.query("select count(*)::int as n from marketplace_service_areas where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(4);
  });

  test("a member who may only read sees the areas and has no way to change them", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/marketplace-listing");
    const card = page.getByRole("region", { name: "Service areas" });
    await expect(card.getByRole("listitem")).toHaveCount(4);
    await expect(card.getByRole("link", { name: "Edit areas" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit listing" })).toHaveCount(0);
    await page.goto("/marketplace-listing/edit");
    await expect(page).toHaveURL(/\/marketplace-listing$/);
  });

  test("when the platform suspends the listing the business is told THAT, with no reason, and publishing again does not make it public", async ({ page, workerTenant, db }) => {
    const reason = `private-reason-${randomBytes(4).toString("hex")}`;
    const listing = (await db.query<{ id: string }>("select id from marketplace_listings where organization_id = $1", [workerTenant.organizationId])).rows[0].id;
    const publicStatus = async () => {
      const api = await anonymous(address());
      try {
        return (await api.get(`/listings/${workerTenant.listingSlug}`, { maxRedirects: 0 })).status();
      } finally {
        await api.dispose();
      }
    };
    await page.goto("/marketplace-listing");
    await expect(page.getByText("Climvia has suspended your Marketplace listing")).toHaveCount(0);
    expect(await publicStatus()).toBe(200);

    await suspend(db, listing, reason);
    await page.goto("/marketplace-listing");
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
    await expect(page.getByText("Suspended by Climvia", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Climvia has suspended your Marketplace listing" })).toContainText("Your listing content is saved and it is still set to published");
    await expect(page.getByRole("region", { name: "Listing summary" })).toContainText("Not discoverable: suspended by Climvia");
    // The way to the public page is replaced by the preview: the public page is not there.
    await expect(page.getByRole("link", { name: "View public listing" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Preview listing" })).toHaveAttribute("href", "/marketplace-listing/preview");
    expect(await publicStatus()).toBe(404);
    // The reason, and any sign of the decision's author, never reach the business's pages.
    for (const path of ["/marketplace-listing", "/marketplace-listing/edit", "/marketplace-listing/preview"]) {
      await page.goto(path);
      const html = await page.content();
      expect(html, path).not.toContain(reason);
      expect(html, path).not.toContain("test-administrator");
    }
    await page.goto("/marketplace-listing/edit");
    await expect(page.getByText("Climvia has suspended your Marketplace listing")).toBeVisible();

    // The business hides it and publishes it again: its own choice changes, the public does not.
    await page.getByRole("button", { name: "Hide listing" }).first().click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
    await expect(page.getByText("Marketplace listing hidden")).toBeVisible();
    await expect(page.getByText("Publishing it will not make it public until Climvia lifts the suspension.")).toBeVisible();
    await page.getByRole("button", { name: "Publish listing" }).first().click();
    await expect(page.getByText("Marketplace listing published.")).toBeVisible();
    expect(await publicStatus()).toBe(404);

    // Lifted: it is public again, because the business has it published.
    await allow(db, listing);
    expect(await publicStatus()).toBe(200);
    await page.goto("/marketplace-listing");
    await expect(page.getByText("Climvia has suspended your Marketplace listing")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View public listing" })).toHaveAttribute("href", `/listings/${workerTenant.listingSlug}`);
  });

  test("the business sees how many bookings came from its listing, counted from the bookings themselves", async ({ page, workerTenant, db }) => {
    const tiles = () => page.getByRole("region", { name: "Listing summary" });
    const marketplaceBookings = async () => (await db.query("select count(*)::int as n from bookings where organization_id = $1 and source = 'Marketplace'", [workerTenant.organizationId])).rows[0].n as number;
    // The sample business already has a booking recorded as coming from the Marketplace: the tile counts what is recorded, whatever its age.
    const baseline = await marketplaceBookings();
    await page.goto("/marketplace-listing");
    await expect(tiles()).toContainText(new RegExp(`Marketplace bookings\\s*${baseline}(?!\\d)`));
    const runtime = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      for (const service of ["annual-cooling-tune-up", "ac-repair-diagnostics"]) {
        const result = await runtime.query("select app_public_create_marketplace_booking($1, $2, $3, '2030-05-14'::date, '10:00'::time, '11:00'::time, 'Pat Visitor', '(555) 010-0000', $4, '1 Main Street', null, null, null, null, null) as r", [workerTenant.listingSlug, service, randomBytes(8).toString("hex"), `count-${randomBytes(3).toString("hex")}@example.test`]);
        expect(result.rows[0].r.ok).toBe(true);
      }
    } finally {
      await runtime.end();
    }
    // A Website booking is not a Marketplace booking.
    await db.query("select app_public_create_booking($1, 'annual-cooling-tune-up', $2, '2030-05-15'::date, '10:00'::time, '11:00'::time, 'Web Visitor', '(555) 010-0001', $3, '2 Main Street', null, null, null)", [workerTenant.platformSlug, randomBytes(8).toString("hex"), `web-${randomBytes(3).toString("hex")}@example.test`]);
    expect(await marketplaceBookings()).toBe(baseline + 2);
    await page.goto("/marketplace-listing");
    await expect(tiles()).toContainText(new RegExp(`Marketplace bookings\\s*${baseline + 2}(?!\\d)`));
    await expect(tiles()).toContainText("Booked from your Marketplace listing");
  });
});

test.describe("the console shows what the Marketplace shows", () => {
  test("a listing's services, its service areas, whether it is in the Marketplace, and a link to its profile; a review's visibility", async ({ page, context }) => {
    const admin = await makePlatformAdmin("p19bmk", owner.db, owner.pool);
    const state = await signInOverHttp(admin.email, admin.password, address());
    await context.addCookies(state.cookies);
    const fam = word();
    const live = await makeProvider("cons", owner, { nameWord: fam, services: [SAMPLE_SERVICES.repair, SAMPLE_SERVICES.tuneUp], areas: [{ city: "Austin", state: "TX" }, { postal: "78704", label: "South Austin" }], reviews: [{ rating: 5, reviewer: "Console Public", text: `Public ${fam}` }, { rating: 2, reviewer: "Console Private", text: `Private ${fam}`, visibility: "private" }] });
    const quiet = await makeProvider("consq", owner, { nameWord: fam, suspended: true });

    await page.goto(`/platform-admin/marketplace?q=${live.slug}`);
    const row = page.getByRole("row", { name: new RegExp(live.slug) });
    await expect(row).toContainText("AC Repair & Diagnostics, Annual Cooling Tune-Up & Maintenance");
    await expect(row).toContainText("Austin, TX, South Austin");
    await expect(row).toContainText("Listed in the Marketplace");
    await expect(row.getByRole("link", { name: `/listings/${live.slug}` })).toHaveAttribute("href", `/listings/${live.slug}`);

    await page.goto(`/platform-admin/marketplace?q=${quiet.slug}`);
    const suspended = page.getByRole("row", { name: new RegExp(quiet.slug) });
    await expect(suspended).toContainText("Not in the Marketplace");
    await expect(suspended.getByRole("link", { name: `/listings/${quiet.slug}` })).toHaveCount(0);

    await page.goto(`/platform-admin/reviews?q=${fam}`);
    await expect(page.getByRole("row", { name: /Console Public/ })).toContainText("Public");
    await expect(page.getByRole("row", { name: /Console Private/ })).toContainText("Private");
    await expect(page.getByText(/no published Site or Marketplace listing displays a review/)).toHaveCount(0);
    await expectAccessible(page);
  });
});
