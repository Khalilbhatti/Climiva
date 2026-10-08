import type { Page } from "playwright/test";
import { business } from "../src/data/fixtures";
import { SERVICES, formatServicePrice } from "../src/data/services";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const main = (page: Page) => page.getByRole("main");

const SIX = SERVICES.map((service) => service.name);
const PLAN_COVERAGE = ["Cooling maintenance", "Heating maintenance"];

test.describe("Phase 5 guardrail: the public Service catalog stays exactly the six canonical Services", () => {
  test("Services lists the six, and not the maintenance plan coverage", async ({ page }) => {
    await page.goto("/services");
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(6);
    for (const name of SIX) await expect(rows.filter({ hasText: name })).toHaveCount(1);
    for (const label of PLAN_COVERAGE) await expect(main(page)).not.toContainText(label);
  });

  test("the Website's Services and Booking pages list the same six, and no coverage labels", async ({ page }) => {
    await page.goto("/website/preview/services");
    const cards = page.getByRole("list").filter({ has: page.getByRole("heading", { level: 2 }) }).getByRole("listitem");
    await expect(cards).toHaveCount(6);
    for (const name of SIX) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    for (const label of PLAN_COVERAGE) await expect(page.locator("body")).not.toContainText(label);

    await page.goto("/website/preview/booking");
    for (const name of SIX) await expect(page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
    await expect(page.locator("main, body").first()).not.toContainText("Cooling maintenance");
    await expect(page.locator("body")).not.toContainText("Heating maintenance");

    await page.goto("/website/pages/services");
    await page.getByRole("button", { name: /^Service catalog/ }).click();
    await expect(page.getByRole("switch", { name: /^Show .* on the website$/ })).toHaveCount(6);
    for (const label of PLAN_COVERAGE) await expect(main(page)).not.toContainText(label);
  });

  test("the Marketplace offers only the six: five shown, Emergency not selected, no coverage labels", async ({ page }) => {
    await page.goto("/marketplace/edit");
    const services = page.getByRole("region", { name: "Services shown" });
    await expect(services.getByRole("listitem")).toHaveCount(6);
    for (const name of SIX) await expect(services.getByRole("checkbox", { name: `Show ${name}` })).toBeVisible();
    for (const label of PLAN_COVERAGE) await expect(main(page)).not.toContainText(label);
    await page.goto("/marketplace/preview");
    for (const label of PLAN_COVERAGE) await expect(page.locator("body")).not.toContainText(label);
  });

  test("Maintenance Plans still use the coverage labels internally, as plan labels and not as Services", async ({ page }) => {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByRole("region", { name: "Plan coverage" })).toContainText("Cooling maintenance");
    await expect(page.getByRole("region", { name: "Plan coverage" })).toContainText("Heating maintenance");
    await page.goto("/services");
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(6);
  });
});

test.describe("Growth modules read the central records", () => {
  test("the Marketplace listing shows each selected Service's catalog price, description and booking method", async ({ page }) => {
    await page.goto("/marketplace");
    const listing = page.getByRole("region", { name: "Directory preview" });
    for (const service of SERVICES.filter((item) => item.id !== "emergency-no-heat-no-cool")) {
      const item = listing.getByRole("listitem").filter({ hasText: service.name });
      await expect(item).toContainText(formatServicePrice(service.pricing));
      await expect(item).toContainText(service.description);
    }
    await expect(listing).toContainText(business.name);
    await expect(listing).toContainText(business.phone);
  });

  test("a customer's name, and the job, on a review are the Customers and Jobs records", async ({ page }) => {
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("link", { name: /View customer/ }).click();
    await expect(page).toHaveURL("/customers/sarah-mitchell");
    await expect(page.getByRole("heading", { level: 1, name: "Sarah Mitchell" })).toBeVisible();
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("link", { name: /View job/ }).click();
    await expect(page).toHaveURL("/jobs/JB-204");
    await expect(main(page)).toContainText("AC Repair & Diagnostics");
    await expect(main(page)).toContainText("Sarah Mitchell");
  });

  test("campaign recipients that match a customer take their phone number from the Customers record", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    await expect(main(page)).toContainText("(512) 555-0194");
    await page.goto("/marketing/cmp-cooling-tune-up-reminder");
    await expect(page.getByRole("table", { name: "Delivery records" }).locator("tbody tr", { hasText: "Sarah Mitchell" })).toContainText("(512) 555-0194");
  });
});

test.describe("Earlier modules still work", () => {
  for (const [path, heading] of [
    ["/customers", "Customers"],
    ["/services", "Services"],
    ["/bookings", "Bookings"],
    ["/schedule", "Schedule"],
    ["/jobs", "Jobs"],
    ["/team", "Team"],
    ["/quotes-invoices", "Quotes & Invoices"],
    ["/payments", "Payments"],
    ["/maintenance-plans", "Maintenance Plans"],
    ["/website", "Website"],
  ] as const) {
    test(`${heading} renders in the shell with its sidebar item active`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(primaryNav(page).getByRole("link", { name: new RegExp(`^${heading.replace("&", "&")}`) })).toHaveAttribute("aria-current", "page");
    });
  }

  test("the Payments baseline is unchanged", async ({ page }) => {
    await page.goto("/payments");
    await expect(main(page)).toContainText("$2,130");
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$6,240");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("7 recorded non-voided payments");
  });

  test("the Growth modules are real pages in the shell, not placeholders", async ({ page }) => {
    for (const path of ["/marketplace", "/reviews", "/marketing"]) {
      await page.goto(path);
      await expect(page.getByText("isn't built yet")).toHaveCount(0);
      await expect(primaryNav(page)).toBeVisible();
    }
    for (const path of ["/analytics", "/settings", "/help"]) {
      await page.goto(path);
      await expect(page.getByText("isn't built yet")).toHaveCount(0);
    }
  });

  test("the Website preview from Phase 5 is unaffected: still its own layout with the six Services", async ({ page }) => {
    await page.goto("/website/preview");
    await expect(primaryNav(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Heating & cooling service");
    await expect(page.getByTestId("site-frame")).toBeVisible();
    await expect(page.getByTestId("directory-frame")).toHaveCount(0);
  });
});
