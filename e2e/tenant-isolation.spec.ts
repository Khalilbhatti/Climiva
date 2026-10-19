/**
 * One business never sees another's data. Checked through the real application: pages, raw responses (HTML and the
 * client-navigation payload), cookies, caching headers, concurrent requests, and what is stored. Each test names the
 * people involved:
 *
 *   Alex    Apex only (owner)         Jamie   Apex only (member)
 *   Taylor  Northstar only (owner)    Casey   admin in both
 *
 * The seed's Apex and Northstar rows are only ever read here; the specs that change Settings use a worker's own copy.
 */
import type { Page } from "playwright/test";
import { business } from "../scripts/db/seed-data/apex";
import { expect, hydrated, ORIGIN, switchWorkspace, test, waitsForHydration, watchConsole } from "./saas";
import { ROUTE_INVENTORY } from "./route-inventory";
import { NORTHSTAR_CUSTOMERS, NORTHSTAR_ROLES, NORTHSTAR_SERVICES, NORTHSTAR_TEAM } from "../scripts/db/seed-data/northstar";
import { CUSTOMERS, FINANCIALS, JOBS, TEAM } from "./apex-data";

/** Everything that belongs to the sample business and so must never appear for anyone else. */
const APEX_ONLY = [
  business.name,
  business.phone,
  business.email,
  business.address.street,
  ...CUSTOMERS.map((customer) => customer.name),
  ...TEAM.map((member) => member.name),
  ...JOBS.slice(0, 5).map((job) => job.id),
  // PAY-1001 and PAY-1002 are skipped: Northstar numbers its own payments from 1001 too (a number belongs to its business).
  ...FINANCIALS.payments.slice(2, 7).map((payment) => payment.id),
];

const NORTHSTAR = { name: "Northstar Heating & Cooling", phone: "(555) 410-7788", email: "office@northstar-hvac.test" };

const asHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const leaksIn = (text: string, forbidden: string[]) => forbidden.filter((value) => text.includes(value) || text.includes(asHtml(value)));
const activeBusiness = (page: Page) => page.getByTitle("Switch workspace");

/**
 * What Taylor's request for one of the inventory's pages should answer. Customers, Services and the Team are Northstar's own
 * records now: a reference Northstar has answers 200 with Northstar's record, any other (all of Apex's, which the inventory is
 * built from) answers 404 exactly as a record that never existed does. Everything else is a page of the shell.
 */
function expectedStatusForTaylor(url: string): number {
  const [, module, id, next] = url.split("/");
  const known = (ids: readonly string[], reference: string) => (ids.includes(reference) ? 200 : 404);
  if (module === "customers" && id) return known(NORTHSTAR_CUSTOMERS.map((customer) => customer.id), id);
  if (module === "services" && id) return known(NORTHSTAR_SERVICES.map((service) => service.id), id);
  if (module === "team" && id === "roles" && next && next !== "new") return known(NORTHSTAR_ROLES.map((role) => role.id), next);
  if (module === "team" && id && id !== "roles") return known(NORTHSTAR_TEAM.map((member) => member.id), id);
  return 200;
}

test.describe("the sample business belongs to Apex alone", () => {
  test("Alex sees Apex's sample data", async ({ openAs }) => {
    const { page, problems } = await openAs("alex");
    await page.goto("/customers");
    await expect(activeBusiness(page)).toContainText(business.name);
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(page.getByText(CUSTOMERS[0].name).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("Taylor sees Northstar's own business and none of Apex's", async ({ openAs }) => {
    const { page, problems } = await openAs("taylor");
    await page.goto("/");
    await expect(activeBusiness(page)).toContainText(NORTHSTAR.name);
    await expect(page.getByText("Your workspace is ready")).toBeVisible();
    const card = page.getByRole("region", { name: "Business information" });
    await expect(card).toContainText(NORTHSTAR.phone);
    await expect(card).toContainText(NORTHSTAR.email);
    await expect(card).toContainText("918 Blue Spruce Way");
    await expect(card).toContainText("Denver, CO 80203");
    await expect(card).toContainText("Mon–Fri: 08:00–17:00");
    expect(leaksIn(await page.locator("body").innerText(), APEX_ONLY)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("Taylor sees Northstar's own Customers, Services and Team, and none of Apex's", async ({ openAs }) => {
    const { page, problems } = await openAs("taylor");
    for (const [path, name, shown] of [
      ["/customers", "Customers", NORTHSTAR_CUSTOMERS.map((customer) => customer.name)],
      ["/services", "Services", NORTHSTAR_SERVICES.map((service) => service.name)],
      ["/team", "Team", NORTHSTAR_TEAM.map((member) => member.name)],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name }), path).toBeVisible();
      const text = await page.locator("body").innerText();
      for (const value of shown) expect(text, `${path}: ${value}`).toContain(value);
      expect(leaksIn(text, APEX_ONLY), path).toEqual([]);
    }
    expect(problems).toEqual([]);
  });

  test("Taylor's Website and Marketplace are Northstar's own: its address, its listing, none of Apex's", async ({ openAs }) => {
    const { page, problems } = await openAs("taylor");
    for (const [path, name, shown] of [
      ["/website", "Website", "northstar.climvia.com"],
      ["/marketplace-listing", "Marketplace", NORTHSTAR.name],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name }), path).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: `${name} isn't available for ${NORTHSTAR.name} yet` }), path).toHaveCount(0);
      const text = await page.locator("body").innerText();
      expect(text, path).toContain(shown);
      expect(leaksIn(text, APEX_ONLY), path).toEqual([]);
    }
    // Bookings, the Schedule, Jobs, Quotes & Invoices, Payments, Maintenance Plans, Reviews, Marketing and Analytics are Northstar's own now: real pages with its own few records and none of Apex's.
    for (const [path, name] of [
      ["/bookings", "Bookings"],
      ["/schedule", "Schedule"],
      ["/jobs", "Jobs"],
      ["/quotes-invoices", "Quotes & Invoices"],
      ["/payments", "Payments"],
      ["/maintenance-plans", "Maintenance Plans"],
      ["/reviews", "Reviews"],
      ["/marketing", "Marketing"],
      ["/analytics", "Analytics"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name }), path).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: `${name} isn't available for ${NORTHSTAR.name} yet` }), path).toHaveCount(0);
      expect(leaksIn(await page.locator("body").innerText(), APEX_ONLY), path).toEqual([]);
    }
    expect(problems).toEqual([]);
  });

  test("every record page for Apex's customers, jobs, payments and people is unavailable (or not found) for Taylor, in HTML and in client navigation", async ({ apiAs }) => {
    // It asks for every shell address twice, as HTML and as a client navigation: about thirteen seconds alone, longer when the machine is busy.
    test.setTimeout(120_000);
    const taylor = await apiAs("taylor");
    const urls = ROUTE_INVENTORY.filter((route) => route.shell && !["/", "/help"].includes(route.url) && !route.url.startsWith("/settings")).map((route) => route.url);
    expect(urls.length).toBeGreaterThan(100);
    const leaks: string[] = [];
    for (const url of urls) {
      for (const headers of [{}, { rsc: "1" }] as Record<string, string>[]) {
        const response = await taylor.get(url, { headers });
        // A page load answers 404 for a record the business does not have. The client-navigation payload is a stream that
        // carries the same "not found" inside a 200, so it may answer either; what matters in both is what it contains.
        const acceptable = "rsc" in headers ? [200, expectedStatusForTaylor(url)] : [expectedStatusForTaylor(url)];
        if (!acceptable.includes(response.status())) leaks.push(`${url}: HTTP ${response.status()}, expected ${acceptable.join(" or ")}`);
        const found = leaksIn(await response.text(), APEX_ONLY.filter((value) => !url.includes(value)));
        if (found.length > 0) leaks.push(`${url} (${"rsc" in headers ? "client navigation" : "html"}): ${found.slice(0, 3).join(", ")}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test("Taylor's previews are her own site and listing; the public pages are the same for everyone", async ({ apiAs }) => {
    const taylor = await apiAs("taylor");
    const routes = ROUTE_INVENTORY.filter((route) => !route.shell);
    const previews = routes.filter((route) => route.url.startsWith("/website/preview") || route.url.startsWith("/marketplace-listing/preview"));
    const published = routes.filter((route) => route.url.startsWith("/sites/") || route.url.startsWith("/listings/"));
    expect(previews.length).toBeGreaterThan(6);
    expect(published.length).toBeGreaterThan(6);
    // A preview is drawn from the signed-in person's own business: Northstar's pages, or not found for an Apex record, never Apex's.
    for (const { url } of previews) {
      const response = await taylor.get(url);
      expect([200, 404], url).toContain(response.status());
      expect(leaksIn(await response.text(), APEX_ONLY), url).toEqual([]);
    }
    // A published site and listing are public by design: anyone, signed in or not, is served the same page.
    for (const { url } of published) {
      const response = await taylor.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()["cache-control"], url).toMatch(/no-store|private|no-cache/);
    }
  });

  test("the sidebar counts and the top-bar search are Apex's alone", async ({ openAs }) => {
    const taylor = await openAs("taylor");
    await taylor.page.goto("/");
    await expect(taylor.page.getByRole("navigation", { name: "Primary" }).locator("span.font-mono")).toHaveCount(0);
    await taylor.page.getByRole("combobox", { name: /Search customers/ }).fill("Sarah");
    await expect(taylor.page.getByText("No matches for")).toBeVisible();
    await expect(taylor.page.getByRole("option")).toHaveCount(0);

    const alex = await openAs("alex");
    await alex.page.goto("/");
    expect(await alex.page.getByRole("navigation", { name: "Primary" }).locator("span.font-mono").count()).toBeGreaterThan(0);
    await alex.page.getByRole("combobox", { name: /Search customers/ }).fill("Sarah");
    await expect(alex.page.getByRole("option").first()).toBeVisible();
  });
});

test.describe("the active workspace can only be one the person belongs to", () => {
  const tamperWith = async (page: Page, organizationId: string | null) => {
    const context = page.context();
    await context.clearCookies({ name: "climvia_org" });
    if (organizationId !== null) await context.addCookies([{ name: "climvia_org", value: organizationId, url: ORIGIN }]);
  };

  test("pointing the workspace cookie at Apex does not let Taylor in", async ({ openAs, db }) => {
    const apex = (await db.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
    const { page } = await openAs("taylor");
    for (const value of [apex, "not-a-uuid", "00000000-0000-0000-0000-000000000000", encodeURIComponent(`${apex}'; drop table organizations;--`)]) {
      await tamperWith(page, value);
      await page.goto("/");
      await expect(activeBusiness(page), value).toContainText(NORTHSTAR.name);
      await page.goto("/customers");
      expect(leaksIn(await page.locator("body").innerText(), APEX_ONLY), value).toEqual([]);
    }
  });

  test("pointing the workspace cookie at Northstar does not let Alex in", async ({ openAs, db }) => {
    const northstar = (await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const { page } = await openAs("alex");
    await tamperWith(page, northstar);
    await page.goto("/settings");
    await expect(activeBusiness(page)).toContainText(business.name);
    await expect(page.getByLabel(/^Business name/)).toHaveValue(business.name);
    expect(leaksIn(await page.locator("body").innerText(), [NORTHSTAR.phone, NORTHSTAR.email])).toEqual([]);
  });

  test("a person in two workspaces can choose either, and a valid cookie is honoured", async ({ openAs, db }) => {
    const northstar = (await db.query<{ id: string }>("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id;
    const { page } = await openAs("casey");
    await page.goto("/");
    await expect(activeBusiness(page)).toContainText(business.name);
    await tamperWith(page, northstar);
    await page.goto("/");
    await expect(activeBusiness(page)).toContainText(NORTHSTAR.name);
  });

  test("the workspace list holds only the person's own workspaces", async ({ openAs }) => {
    for (const [who, expected] of [["alex", [business.name]], ["taylor", [NORTHSTAR.name]], ["casey", [business.name, NORTHSTAR.name]]] as const) {
      const { page } = await openAs(who);
      await page.goto("/");
      await activeBusiness(page).click();
      const names = await page.getByRole("region", { name: "Workspaces" }).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.querySelector("span span")?.textContent ?? ""));
      expect(names.sort(), who).toEqual([...expected].sort());
    }
  });

  test("the workspace cookie is httpOnly, SameSite and scoped to the site", async ({ openAs }) => {
    const { page, context } = await openAs("casey");
    await page.goto("/");
    await switchWorkspace(page, new RegExp(NORTHSTAR.name));
    await expect(activeBusiness(page)).toContainText(NORTHSTAR.name);
    const cookie = (await context.cookies()).find((candidate) => candidate.name === "climvia_org");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("climvia_org");
  });
});

test.describe("switching between two workspaces", () => {
  test("shows the other business's settings, and switching back restores the first", async ({ openAs }) => {
    const { page, problems } = await openAs("casey");
    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue(business.name);

    await switchWorkspace(page, new RegExp(NORTHSTAR.name));
    await expect(page).toHaveURL(/\/$/);
    await expect(activeBusiness(page)).toContainText(NORTHSTAR.name);
    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue(NORTHSTAR.name);
    await expect(page.getByLabel(/^Phone/)).toHaveValue(NORTHSTAR.phone);
    await page.goto("/settings/preferences");
    await expect(page.getByLabel(/^Time zone/)).toHaveValue("America/Denver");
    await page.goto("/settings/hours");
    await expect(page.getByRole("region", { name: "Hours preview" })).toContainText(/Mon–Fri\s*08:00–17:00/);

    await switchWorkspace(page, new RegExp(business.name));
    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue(business.name);
    await page.goto("/settings/preferences");
    await expect(page.getByLabel(/^Time zone/)).toHaveValue("America/Chicago");
    expect(problems).toEqual([]);
  });

  test("sample data comes and goes with the workspace, and nothing from one survives in the other", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/customers");
    await expect(page.getByText(CUSTOMERS[0].name).first()).toBeVisible();
    await switchWorkspace(page, new RegExp(NORTHSTAR.name));
    await page.goto("/customers");
    await expect(page.getByText(NORTHSTAR_CUSTOMERS[0].name).first()).toBeVisible();
    expect(leaksIn(await page.content(), APEX_ONLY)).toEqual([]);
    // Payments are Northstar's own: its payment, and none of Apex's.
    await page.goto("/payments");
    await expect(page.getByRole("link", { name: "#PAY-1001" })).toBeVisible();
    expect(leaksIn(await page.content(), APEX_ONLY)).toEqual([]);
    // Jobs are Northstar's own: its one job, and none of Apex's.
    await page.goto("/jobs");
    await expect(page.getByText("JB-1001").first()).toBeVisible();
    expect(leaksIn(await page.content(), APEX_ONLY)).toEqual([]);
  });

  test("each workspace has its own Branding: Apex's logo and accent are Apex's, Northstar has none, and neither follows the person into the other", async ({ openAs }) => {
    // Read-only on purpose: Branding is stored now, so this must not save anything into the standing businesses.
    const { page } = await openAs("casey");
    await page.goto("/settings/branding");
    await expect(page.getByText("apex-climate-crest-revised.svg")).toBeVisible();
    await expect(page.locator("#brand-accent")).toHaveValue("#0D5C63");
    await switchWorkspace(page, new RegExp(NORTHSTAR.name));
    await page.goto("/settings/branding");
    await expect(page.getByText("No logo. The initials below are shown instead.")).toBeVisible();
    await expect(page.getByText("apex-climate-crest-revised.svg")).toHaveCount(0);
    await expect(page.locator("#brand-accent")).toHaveValue("");
    await switchWorkspace(page, new RegExp(business.name));
    await page.goto("/settings/branding");
    await expect(page.getByText("apex-climate-crest-revised.svg")).toBeVisible();
    await expect(page.locator("#brand-accent")).toHaveValue("#0D5C63");
  });
});

test.describe("concurrent requests from different people", () => {
  test("two people reading Settings at the same moment each get only their own business, every time", async ({ apiAs }) => {
    const alex = await apiAs("alex");
    const taylor = await apiAs("taylor");
    const casey = await apiAs("casey");
    const rounds = Array.from({ length: 25 }, () => [alex, taylor, casey]).flat();
    const results = await Promise.all(rounds.map(async (api, index) => ({ who: index % 3, html: await (await api.get("/settings")).text() })));
    const wrong = results.filter(({ who, html }) => {
      const hasApex = html.includes("Apex Climate Heating");
      const hasNorthstar = html.includes("Northstar Heating");
      // Alex sees only Apex and Taylor only Northstar. Casey belongs to both, so her page names both, with Apex (her first) active.
      if (who === 0) return !hasApex || hasNorthstar;
      if (who === 1) return !hasNorthstar || hasApex;
      return !hasApex;
    });
    expect(wrong).toHaveLength(0);
  });

  test("two browsers in two workspaces at once do not share formats or state", async ({ openAs }) => {
    const alex = await openAs("alex");
    const taylor = await openAs("taylor");
    await Promise.all([alex.page.goto("/settings/preferences"), taylor.page.goto("/settings/preferences")]);
    await expect(alex.page.getByLabel(/^Time zone/)).toHaveValue("America/Chicago");
    await expect(taylor.page.getByLabel(/^Time zone/)).toHaveValue("America/Denver");
    await expect(alex.page.getByLabel("Date format")).toHaveValue("mdy-short");
    await expect(taylor.page.getByLabel("Date format")).toHaveValue("ymd-iso");
    expect([...alex.problems, ...taylor.problems]).toEqual([]);
  });
});

test.describe("nothing about a workspace is cached", () => {
  test("pages that show a workspace are never stored by a browser or a shared cache", async ({ apiAs }) => {
    const alex = await apiAs("alex");
    for (const url of ["/", "/settings", "/settings/hours", "/customers", "/customers/sarah-mitchell", "/website/preview", "/marketplace-listing/preview", "/help"]) {
      for (const headers of [{}, { rsc: "1" }] as Record<string, string>[]) {
        const cacheControl = (await alex.get(url, { headers })).headers()["cache-control"] ?? "";
        expect(cacheControl, url).toMatch(/no-store|private/);
        expect(cacheControl, url).not.toMatch(/public|s-maxage|stale-while-revalidate/);
      }
    }
  });

  test("the sign-in and set-up pages are not stored either", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    const alex = await apiAs("alex");
    for (const [api, url] of [[anonymous, "/login"], [anonymous, "/signup"], [alex, "/onboarding?new=1"]] as const) {
      const cacheControl = (await api.get(url, { maxRedirects: 0 })).headers()["cache-control"] ?? "";
      expect(cacheControl, url).not.toMatch(/public|s-maxage/);
    }
  });

  test("a workspace is not served from a cache to the next person on the same browser", async ({ openAs }) => {
    const alex = await openAs("alex");
    await alex.page.goto("/settings");
    await expect(alex.page.getByLabel(/^Business name/)).toHaveValue(business.name);
    // Same browser profile, different person: sign out, sign in as Taylor, open the same address.
    await alex.page.getByRole("button", { name: /Alex Morgan/ }).click();
    await alex.page.getByRole("button", { name: "Log out" }).click();
    await expect(alex.page).toHaveURL(/\/login$/);
    await hydrated(alex.page);
    await alex.page.getByLabel(/^Email/).fill("taylor.brooks@northstar.test");
    await alex.page.getByLabel(/^Password/).fill(process.env.SEED_PASSWORD ?? "");
    await alex.page.getByRole("button", { name: "Log in" }).click();
    await expect(alex.page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
    await alex.page.goto("/settings");
    await expect(alex.page.getByLabel(/^Business name/)).toHaveValue(NORTHSTAR.name);
    await alex.page.goBack({ waitUntil: "load" });
    await alex.page.goBack({ waitUntil: "load" });
    await alex.page.waitForLoadState("networkidle");
    expect(leaksIn(await alex.page.content(), [business.phone, business.email])).toEqual([]);
      });
});

test.describe("what one workspace saves, another never sees", () => {
  test("saving Business information in a worker's Apex copy leaves Apex, Northstar and everyone else unchanged", async ({ page, db, openAs }) => {
    await page.goto("/settings");
    await page.getByLabel(/^Business name/).fill("Isolated Edit Heating");
    await page.getByLabel(/^Phone/).fill("(555) 000-9999");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Business information saved.");

    const rows = await db.query<{ slug: string; name: string; phone: string }>("select slug, name, phone from organizations where slug in ('apex-climate-heating-air', 'northstar-heating-cooling') order by slug");
    expect(rows.rows).toEqual([
      { slug: "apex-climate-heating-air", name: business.name, phone: business.phone },
      { slug: "northstar-heating-cooling", name: NORTHSTAR.name, phone: NORTHSTAR.phone },
    ]);

    const taylor = await openAs("taylor");
    await taylor.page.goto("/settings");
    await expect(taylor.page.getByLabel(/^Business name/)).toHaveValue(NORTHSTAR.name);
    const alex = await openAs("alex");
    await alex.page.goto("/settings");
    await expect(alex.page.getByLabel(/^Business name/)).toHaveValue(business.name);
  });
});

test.describe("failures never fall back to someone's data", () => {
  test("a malformed or unknown session shows Log in, not a workspace", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [{ name: "better-auth.session_token", value: "x", domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] } });
    const page = waitsForHydration(await context.newPage());
    const problems = watchConsole(page);
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login/);
    expect(leaksIn(await page.content(), APEX_ONLY)).toEqual([]);
    expect(problems).toEqual([]);
    await context.close();
  });
});
