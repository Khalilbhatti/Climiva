import { expect, test } from "./fixtures";

const primaryNav = (page: import("playwright/test").Page) => page.getByRole("navigation", { name: "Primary" });

test.describe("Customers", () => {
  test("/customers renders the directory with its own search, not the global one", async ({ page }) => {
    await page.goto("/customers");

    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(page.getByText("People your business serves, and their service history.")).toBeVisible();

    const table = page.getByRole("table", { name: "Customers" });
    await expect(table.getByRole("columnheader")).toHaveText([
      "Customer",
      "Primary property",
      "Contact",
      "Last service",
      "Upcoming",
      "Maintenance plan",
      "Action",
    ]);
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(table.getByRole("row", { name: /Sarah Mitchell/ })).toContainText("1402 Kinney Ave");
    await expect(page.getByText("Showing 5 of 5 customers")).toBeVisible();

    // Module search is distinct from the global one in the top bar.
    await expect(page.getByPlaceholder("Search customer, phone, email, or address...")).toBeVisible();
    await expect(page.getByPlaceholder("Search customers, jobs, bookings, schedule...")).toBeVisible();

    await expect(primaryNav(page).getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
  });

  test("does not show CRM analytics", async ({ page }) => {
    await page.goto("/customers");
    const text = await page.locator("main").innerText();
    for (const phrase of ["lifetime value", "health score", "loyalty", "churn", "lead score"]) {
      expect(text.toLowerCase()).not.toContain(phrase);
    }
  });

  test("search and the maintenance plan filter narrow the list and can be cleared", async ({ page }) => {
    await page.goto("/customers");
    const rows = page.getByRole("table", { name: "Customers" }).locator("tbody tr");

    await page.getByRole("searchbox", { name: "Search customers", exact: true }).fill("mitchell");
    await expect(rows).toHaveCount(1);
    await expect(page.getByText("Showing 1 of 5 customers")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search customers", exact: true }).fill("512-nope");
    await expect(page.getByText("No customers match your search.")).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows).toHaveCount(5);

    await page.getByLabel("Maintenance plan").selectOption("none");
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole("table", { name: "Customers" })).toContainText("Elena Rodriguez");
    await page.getByLabel("Maintenance plan").selectOption("active");
    await expect(rows).toHaveCount(3);

    // Address is searchable too.
    await page.getByLabel("Maintenance plan").selectOption("all");
    await page.getByRole("searchbox", { name: "Search customers", exact: true }).fill("kinney");
    await expect(rows).toHaveCount(1);
  });

  test("View customer opens Sarah Mitchell with the shell still mounted, and Back returns to the list", async ({ page }) => {
    await page.goto("/customers");
    await page.evaluate(() => {
      (document.querySelector("header") as unknown as { __tag: string }).__tag = "mounted-once";
    });

    await page.getByRole("link", { name: "View customer Sarah Mitchell" }).click();
    await expect(page).toHaveURL("/customers/sarah-mitchell");
    await expect(page.getByRole("heading", { level: 1, name: "Sarah Mitchell" })).toBeVisible();
    await expect(page.getByRole("link", { name: "(512) 555-0194" })).toBeVisible();
    await expect(page.getByRole("link", { name: "sarah.m@gmail.com" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: "Back to Customers" }).click();
    await expect(page).toHaveURL("/customers");

    const shellStillMounted = await page.evaluate(() => (document.querySelector("header") as unknown as { __tag?: string }).__tag);
    expect(shellStillMounted).toBe("mounted-once");
  });

  test("Overview shows the approved sections and links to Properties & equipment", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");

    // JB-204 is completed, so Sarah has no service in progress: it is listed in her visit history instead.
    await expect(page.getByRole("heading", { name: "Current service" })).toHaveCount(0);
    for (const heading of [
      "Properties (1)",
      "Equipment",
      "Jobs",
      "Contact",
      "Customer notes",
      "Maintenance plan",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByText("Comfort Care", { exact: true }).first()).toBeVisible();
    // Service names come from the shared catalog.
    await expect(page.getByText("AC Repair & Diagnostics").first()).toBeVisible();
    await expect(page.getByText("Annual Cooling Tune-Up & Maintenance").first()).toBeVisible();
    const visits = page.locator("li").filter({ hasText: "Job #JB-204" });
    await expect(visits).toContainText("Completed");
    await expect(visits).not.toContainText("In progress");

    // Only approved tabs are offered.
    const tabs = page.getByRole("navigation", { name: "Sarah Mitchell sections" }).getByRole("link");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.first()).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: /View property details & equipment/ }).click();
    await expect(page).toHaveURL("/customers/sarah-mitchell/properties");
  });

  test("Properties & equipment shows the canonical Home property and equipment records", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    await page.getByRole("navigation", { name: "Sarah Mitchell sections" }).getByRole("link", { name: /Properties & equipment/ }).click();
    await expect(page).toHaveURL("/customers/sarah-mitchell/properties");

    await expect(page.getByRole("heading", { level: 2, name: "1402 Kinney Ave, Austin, TX 78704" })).toBeVisible();
    await expect(page.getByText("Home", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Gate code #4412")).toBeVisible();
    await expect(page.getByText("2 installed units")).toBeVisible();

    const heatPump = page.getByRole("article", { name: "Main Central Heat Pump & AC" });
    await expect(heatPump).toContainText("Carrier Infinity 19VS");
    await expect(heatPump).toContainText("1618E42109");
    await expect(heatPump).toContainText("May 2016");
    await expect(page.getByRole("article", { name: "Smart Thermostat" })).toContainText("Ecobee");

    // Records only: no monitoring concepts.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const phrase of ["telemetry", "health score", "predictive", "sensor status", "connectivity", "wi-fi"]) {
      expect(text).not.toContain(phrase);
    }
    expect(text).not.toContain("south lamar");

    await expect(page.getByRole("navigation", { name: "Sarah Mitchell sections" }).getByRole("link", { name: /Properties & equipment/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a customer without equipment or notes renders without empty cards", async ({ page }) => {
    await page.goto("/customers/hannah-wright");
    await expect(page.getByRole("heading", { level: 1, name: "Hannah Wright" })).toBeVisible();
    await expect(page.getByText("No equipment is on record yet.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Customer notes" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Maintenance plan" })).toHaveCount(0);

    await page.goto("/customers/hannah-wright/properties");
    await expect(page.getByText("No equipment is on record for this property yet.")).toBeVisible();
  });

  test("an unknown customer shows a not-found page inside the shell", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/); // the real HTTP 404 for the missing record
    await page.goto("/customers/nobody");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(primaryNav(page)).toBeVisible();
  });

  test("keyboard: a row can be opened with Tab and Enter", async ({ page }) => {
    await page.goto("/customers");
    const link = page.getByRole("link", { name: "View customer David Chen" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/customers/david-chen");
  });
});
