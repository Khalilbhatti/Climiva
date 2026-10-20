/**
 * Customers, Services and the Team across businesses, through the real application (Phase 10, tests 38–46).
 *
 *   Casey   admin in both Apex and Northstar      Taylor  Northstar only (owner)      Alex  Apex only (owner)
 *
 * The question in every test is the same: after the active business changes, or the person leaves, or the request is forged,
 * does ANY record of the other business remain on a screen, in the page, in the browser's storage or in a response?
 */
import type { Page } from "playwright/test";
import { NORTHSTAR_CUSTOMERS, NORTHSTAR_SERVICES, NORTHSTAR_TEAM } from "../scripts/db/seed-data/northstar";
import { CUSTOMERS, SERVICES, TEAM } from "./apex-data";
import { business } from "../scripts/db/seed-data/apex";
import { expect, hydrated, ORIGIN, switchWorkspace, switcher, test } from "./saas";

const NORTHSTAR = "Northstar Heating & Cooling";

/** Everything about Apex's foundations that must be gone once Northstar is the active business. */
const APEX = [business.name, business.phone, business.email, ...CUSTOMERS.map((c) => c.name), ...CUSTOMERS.map((c) => c.email), ...SERVICES.map((s) => s.name), ...TEAM.map((m) => m.name)];
const NORTHSTAR_RECORDS = {
  customers: NORTHSTAR_CUSTOMERS.map((customer) => customer.name),
  services: NORTHSTAR_SERVICES.map((service) => service.name),
  team: NORTHSTAR_TEAM.map((member) => member.name),
};
/** And the other way round. */
const NORTHSTAR_ALL = [...NORTHSTAR_RECORDS.customers, ...NORTHSTAR_RECORDS.services, ...NORTHSTAR_RECORDS.team, ...NORTHSTAR_CUSTOMERS.map((customer) => customer.email)];

const asHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const leaksIn = (text: string, forbidden: readonly string[]) => forbidden.filter((value) => text.includes(value) || text.includes(asHtml(value)));
/** What a person can read on the page, what is in its markup, and what the browser kept: all three. */
async function everythingOn(page: Page): Promise<string> {
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  return [await page.locator("body").innerText(), await page.content(), storage].join("\n");
}
const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

const MODULES = {
  customers: { path: "/customers", rows: (page: Page) => page.getByRole("table", { name: "Customers" }).locator("tbody tr"), count: [CUSTOMERS.length, NORTHSTAR_CUSTOMERS.length] },
  services: { path: "/services", rows: (page: Page) => page.getByRole("table", { name: "Services" }).locator("tbody tr"), count: [SERVICES.length, NORTHSTAR_SERVICES.length] },
  team: { path: "/team", rows: (page: Page) => page.getByRole("table", { name: "Team members" }).locator("tbody tr"), count: [TEAM.length, NORTHSTAR_TEAM.length] },
} as const;

test.describe("switching business", () => {
  test("38. a person in both businesses switches from Apex to Northstar", async ({ openAs }) => {
    const { page, problems } = await openAs("casey");
    await page.goto("/customers");
    await expect(switcher(page)).toContainText(business.name);
    await expect(MODULES.customers.rows(page)).toHaveCount(CUSTOMERS.length);

    // Switching reloads the app on the new business's Overview.
    await switchWorkspace(page, new RegExp(NORTHSTAR));
    await expect(switcher(page)).toContainText(NORTHSTAR);
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByText("Your workspace is ready")).toBeVisible();
    expect(problems).toEqual([]);
  });

  for (const [number, name] of [[39, "customers"], [40, "services"], [41, "team"]] as const) {
    test(`${number}. ${name === "team" ? "the Team" : name === "services" ? "Services" : "Customers"} change at once, with nothing of Apex left`, async ({ openAs }) => {
      const foundation = MODULES[name];
      const { page, problems } = await openAs("casey");
      await page.goto(foundation.path);
      await expect(foundation.rows(page)).toHaveCount(foundation.count[0]);
      for (const value of name === "customers" ? CUSTOMERS.map((c) => c.name) : name === "services" ? SERVICES.map((s) => s.name) : TEAM.map((m) => m.name)) {
        await expect(page.getByText(value).first()).toBeVisible();
      }

      // Straight after the switch, by client navigation (no reload of the page): the other business's records, and only those.
      await switchWorkspace(page, new RegExp(NORTHSTAR));
      await primary(page).getByRole("link", { name: new RegExp(`^${name}`, "i") }).click();
      await expect(page).toHaveURL(new RegExp(`${foundation.path}$`));
      await expect(foundation.rows(page)).toHaveCount(foundation.count[1]);
      for (const value of NORTHSTAR_RECORDS[name]) await expect(page.getByText(value).first()).toBeVisible();
      expect(leaksIn(await everythingOn(page), APEX)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test("42. no provider data from the first business survives the switch, wherever the person goes next", async ({ openAs }) => {
    const { page, problems } = await openAs("casey");
    await page.goto("/");
    // Visit every foundation in Apex first, so every provider has been filled.
    for (const link of ["Customers", "Services", "Team", "Bookings", "Jobs", "Schedule"]) {
      await primary(page).getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
    }
    await page.goto("/");
    await switchWorkspace(page, new RegExp(NORTHSTAR));

    // Move around by client navigation (no page load), the way a person does, and look at every step.
    for (const link of ["Customers", "Services", "Team", "Bookings", "Jobs", "Schedule", "Customers"]) {
      await primary(page).getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page.getByRole("heading", { level: 1, name: link })).toBeVisible();
      expect(leaksIn(await everythingOn(page), APEX), link).toEqual([]);
    }
    // The global search, which also reads the directory, finds Northstar's customers and none of Apex's.
    const search = page.getByRole("combobox", { name: /Search customers/ });
    await search.fill("Sarah");
    await expect(page.getByText("No matches for")).toBeVisible();
    await search.fill("Marta");
    await expect(page.getByRole("option", { name: /Marta Olsen/ }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("43. back and forward never bring the previous business's records back", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/customers");
    await expect(page.getByText("Sarah Mitchell").first()).toBeVisible();
    await primary(page).getByRole("link", { name: /^Services/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible();
    await switchWorkspace(page, new RegExp(NORTHSTAR));
    await primary(page).getByRole("link", { name: /^Team/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

    // Walk the whole history, back and then forward again: every page shows the business that is active NOW.
    // (The entries: Customers, Services, then Overview after the switch, then Team.)
    for (let step = 0; step < 3; step += 1) {
      await page.goBack({ waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      await expect(switcher(page)).toContainText(NORTHSTAR);
      expect(leaksIn(await everythingOn(page), APEX), `back ${step + 1}`).toEqual([]);
    }
    for (let step = 0; step < 3; step += 1) {
      await page.goForward({ waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      await expect(switcher(page)).toContainText(NORTHSTAR);
      expect(leaksIn(await everythingOn(page), APEX), `forward ${step + 1}`).toEqual([]);
    }
  });

  test("44. a reload stays on the verified business, and a forged one is never honoured", async ({ openAs, db }) => {
    const casey = await openAs("casey");
    await casey.page.goto("/services");
    await switchWorkspace(casey.page, new RegExp(NORTHSTAR));
    await casey.page.goto("/services");
    await casey.page.reload();
    await expect(switcher(casey.page)).toContainText(NORTHSTAR);
    await expect(MODULES.services.rows(casey.page)).toHaveCount(NORTHSTAR_SERVICES.length);

    // Taylor belongs to Northstar only: a cookie naming Apex is ignored on every reload.
    const apex = (await db.query<{ id: string }>("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id;
    const taylor = await openAs("taylor");
    await taylor.context.addCookies([{ name: "climvia_org", value: apex, url: ORIGIN }]);
    await taylor.page.goto("/services");
    for (let reload = 0; reload < 2; reload += 1) {
      await expect(switcher(taylor.page)).toContainText(NORTHSTAR);
      await expect(MODULES.services.rows(taylor.page)).toHaveCount(NORTHSTAR_SERVICES.length);
      expect(leaksIn(await everythingOn(taylor.page), APEX)).toEqual([]);
      await taylor.page.reload();
    }
  });

  test("45. logging out removes the business's records from the screen, from history and from the browser", async ({ openAs }) => {
    const { page } = await openAs("alex");
    for (const path of ["/customers", "/services", "/team"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.getByRole("button", { name: /Alex Morgan/ }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await hydrated(page);
    expect(leaksIn(await everythingOn(page), APEX)).toEqual([]);

    // History cannot bring a signed-in page back, and the addresses no longer open.
    for (let step = 0; step < 3; step += 1) {
      await page.goBack({ waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      expect(leaksIn(await everythingOn(page), [...CUSTOMERS.map((c) => c.name), ...SERVICES.map((s) => s.name), ...TEAM.filter((m) => m.name !== "Alex Morgan").map((m) => m.name)]), `back ${step + 1}`).toEqual([]);
    }
    for (const path of ["/customers", "/services", "/team", "/customers/sarah-mitchell", "/services/ac-repair-diagnostics", "/team/marcus-vance"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
      expect(leaksIn(await everythingOn(page), APEX), path).toEqual([]);
    }
  });

  test("46. a forged workspace cookie or record address cannot reveal any customer, Service or team member", async ({ openAs, db }) => {
    const orgs = await db.query<{ id: string; slug: string }>("select id, slug from organizations where slug in ('apex-climate-heating-air', 'northstar-heating-cooling')");
    const apex = orgs.rows.find((row) => row.slug === "apex-climate-heating-air")!.id;
    const northstar = orgs.rows.find((row) => row.slug === "northstar-heating-cooling")!.id;
    const forgeriesAimedAt = (target: string, own: string) => [target, "not-a-uuid", "00000000-0000-0000-0000-000000000000", encodeURIComponent(`${target}'; select * from customers;--`), `${target},${own}`];

    // Taylor (Northstar only) and Alex (Apex only), each pointing the cookie at the other's business.
    for (const { who, target, own, forbidden, foreignRecords } of [
      { who: "taylor", target: apex, own: northstar, forbidden: APEX, foreignRecords: ["/customers/sarah-mitchell", "/customers/sarah-mitchell/properties", "/services/annual-cooling-tune-up", "/team/marcus-vance", "/team/samira-patel/services"] },
      { who: "alex", target: northstar, own: apex, forbidden: NORTHSTAR_ALL, foreignRecords: ["/customers/marta-olsen", "/customers/priya-raman/properties", "/services/furnace-tune-up", "/team/jordan-pike", "/team/taylor-brooks/availability"] },
    ] as const) {
      const { context, page } = await openAs(who);
      for (const value of forgeriesAimedAt(target, own)) {
        await context.clearCookies({ name: "climvia_org" });
        await context.addCookies([{ name: "climvia_org", value, url: ORIGIN }]);
        for (const path of ["/customers", "/services", "/team"]) {
          const response = await page.request.get(path);
          expect(response.status(), `${who} ${path} with cookie ${value}`).toBe(200);
          expect(leaksIn(await response.text(), forbidden), `${who} ${path} with cookie ${value}`).toEqual([]);
        }
        for (const path of foreignRecords) {
          const response = await page.request.get(path);
          expect(response.status(), `${who} ${path} with cookie ${value}`).toBe(404);
          expect(leaksIn(await response.text(), forbidden), `${who} ${path} with cookie ${value}`).toEqual([]);
        }
      }
    }

    // The top-bar customer search is a server call too: with a forged cookie it still only reaches the person's own business.
    const taylor = await openAs("taylor");
    await taylor.context.addCookies([{ name: "climvia_org", value: apex, url: ORIGIN }]);
    await taylor.page.goto("/");
    const search = taylor.page.getByRole("combobox", { name: /Search customers/ });
    await search.fill("Sarah");
    await expect(taylor.page.getByText("No matches for")).toBeVisible();
    await search.fill("Priya");
    await expect(taylor.page.getByRole("option", { name: /Priya Raman/ })).toBeVisible();
  });
});
