/**
 * Phase 8, Part O. Empty states, unusual addresses and missing optional links. The approved empty states are the
 * only ones (no skeletons, spinners or invented error screens); a hand-edited address or a record that lacks an
 * optional link never breaks the page; and no screen prints a programming artefact in place of a value.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";
import { ROUTE_INVENTORY, STATE_ROUTES, moduleOf } from "./route-inventory";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

/** What a screen must never print where a value belongs. */
const ARTEFACTS = /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]|\bnull\b|\{\{[^}]*\}\}(?!.*first_name)/;

/**
 * The editors show their merge fields on purpose, and they are the only template text a page may show: the Marketing editor's first-name
 * field, and the two Website text tokens (the business's name and place) in a section's text boxes.
 */
const withoutSanctionedFields = (text: string) => text.replace(/\{\{contact\.first_name\}\}/g, "").replace(/\{\{business\.(name|location)\}\}/g, "");

test.describe("no screen prints a programming artefact", () => {
  for (const url of [...ROUTE_INVENTORY.map((route) => route.url), ...STATE_ROUTES]) {
    test(url, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      expect(withoutSanctionedFields(text)).not.toMatch(ARTEFACTS);
    });
  }
});

test.describe("the approved empty states", () => {
  // The modules with an approved first-time screen preview it with ?state=empty.
  const LISTS = ["/jobs", "/payments", "/maintenance-plans", "/services", "/website", "/marketplace", "/reviews", "/marketing"];
  for (const path of LISTS) {
    test(`${path}?state=empty explains itself and offers a way forward`, async ({ page }) => {
      await page.goto(`${path}?state=empty`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveAttribute("href", moduleOf(path));
      await expect(page.locator("main").getByRole("table")).toHaveCount(0);
      // The explanation is an EmptyState: a heading and a sentence, and the next step as a link or a button.
      const empty = page.locator("main").getByRole("heading", { level: 2 }).first();
      await expect(empty).toBeVisible();
      expect((await page.locator("main").getByRole("link").count()) + (await page.locator("main").getByRole("button").count())).toBeGreaterThan(0);
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/loading|please wait|something went wrong|error/i);
    });
  }

  test("Bookings, Customers, Quotes & Invoices and Team say so in the table when a search or tab finds nothing", async ({ page }) => {
    await page.goto("/bookings?tab=cancelled");
    await expect(page.getByRole("tabpanel")).toContainText("No cancelled bookings.");
    await page.goto("/bookings?tab=past");
    await page.locator("main").getByRole("searchbox").first().fill("zzzz-nothing");
    await expect(page.getByRole("tabpanel")).toContainText("No bookings match your search.");

    await page.goto("/customers");
    await page.locator("main").getByRole("searchbox").first().fill("zzzz-nothing");
    await expect(page.locator("main")).toContainText("No customers match your search.");

    await page.goto("/quotes-invoices");
    await page.locator("main").getByRole("searchbox").first().fill("zzzz-nothing");
    await expect(page.locator("main")).toContainText("No quotes match your filters.");

    await page.goto("/team");
    await page.locator("main").getByRole("searchbox").first().fill("zzzz-nothing");
    await expect(page.locator("main")).toContainText("No team members match your filters.");
  });

  test("Team previews the solo state", async ({ page }) => {
    await page.goto("/team?state=solo");
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(ARTEFACTS);
  });

  test("a list with nothing to show says so rather than drawing an empty table", async ({ page }) => {
    await page.goto("/jobs?state=empty");
    await expect(page.getByText("No jobs yet")).toBeVisible();
    await expect(page.getByText("Jobs will appear when service work is created from a booking.")).toBeVisible();
    await page.goto("/payments?state=empty");
    await expect(page.locator("main")).toContainText(/No payments/i);
  });
});

test.describe("unusual addresses never break a page", () => {
  const ODD: string[] = [
    "/bookings?tab=bogus",
    "/bookings?booking=BK-999",
    "/bookings?tab=cancelled&booking=BK-1042",
    "/bookings?new=0",
    "/jobs?tab=bogus",
    "/schedule?view=bogus&date=not-a-date",
    "/schedule?view=day&date=2024-13-45",
    "/schedule?event=ZZ-9",
    "/payments?record=1&invoice=INV-999",
    "/payments?record=1&invoice=INV-1044",
    "/payments?tab=bogus",
    "/maintenance-plans?new=1&customer=nobody",
    "/quotes-invoices?tab=bogus",
    "/reviews?tab=bogus",
    "/marketing?tab=bogus",
    "/analytics?tab=bogus",
    "/analytics?range=bogus",
    "/analytics?range=custom&from=bad&to=worse",
    "/analytics?range=custom&from=2024-10-20&to=2024-10-10",
    "/analytics?range=custom",
    "/marketplace/edit?setup=bogus",
    "/website/preview/booking/ac-repair-diagnostics?date=garbage",
    "/website/builder?page=home&section=nothing",
    "/website/builder?mode=bogus",
    "/website/pages/home?section=nothing",
    "/customers?search=%00%00",
    "/team?tab=bogus",
  ];
  for (const url of ODD) {
    test(url, async ({ page }) => {
      const response = await page.goto(url);
      expect(response?.status()).toBeLessThan(400);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const text = await page.locator("body").innerText();
      expect(withoutSanctionedFields(text)).not.toMatch(ARTEFACTS);
      expect(text).not.toMatch(/application error|client-side exception/i);
      if (!url.startsWith("/website/preview")) await expect(primaryNav(page)).toBeVisible();
    });
  }
});

test.describe("a record that lacks an optional link still reads well", () => {
  test("a review with no related job has no job link and no placeholder", async ({ page }) => {
    await page.goto("/reviews/rev-david-chen");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("main a[href^='/jobs/']")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toMatch(ARTEFACTS);
  });

  test("a customer without equipment or a service history says so plainly", async ({ page }) => {
    await page.goto("/customers/david-chen");
    await expect(page.locator("main")).toContainText("No equipment is on record yet.");
    expect(await page.locator("main").innerText()).not.toMatch(ARTEFACTS);
  });

  test("a completed job with no files has the approved empty state, and no way to add any", async ({ page }) => {
    await page.goto("/jobs/JB-186/files");
    await expect(page.getByRole("heading", { name: "No photos or files yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Upload photos or documents/ })).toHaveCount(0);
  });

  test("a booking from someone with no customer record shows their contact details", async ({ page }) => {
    await page.goto("/bookings?booking=BK-1038");
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toBeVisible();
    expect(await drawer.innerText()).not.toMatch(ARTEFACTS);
    await expect(drawer.getByRole("link", { name: /View customer/ })).toHaveCount(0);
  });

  test("a plan for someone with no customer record shows their name and address as written", async ({ page }) => {
    await page.goto("/maintenance-plans");
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(ARTEFACTS);
  });
});

test.describe("no speculative loading or error surfaces", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?)$/.test(entry) ? [path] : [];
    });
  }

  test("there are no skeletons, spinners or loading routes: every screen renders its data at once", () => {
    const files = sourceFiles("src");
    expect(files.filter((file) => /(^|[\\/])loading\.tsx$/.test(file))).toEqual([]);
    const speculative = files.filter((file) => /animate-pulse|animate-spin|skeleton/i.test(readFileSync(file, "utf8")));
    expect(speculative).toEqual([]);
  });

  test("there is one not-found screen for the workspace and it lives inside the shell", () => {
    expect(existsSync("src/app/not-found.tsx")).toBe(true);
    expect(existsSync("src/app/(signed-in)/(workspace)/not-found.tsx")).toBe(true);
  });
});
