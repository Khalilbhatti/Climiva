import type { Page } from "playwright/test";
import { BOOKING_METHOD_LABEL, formatServicePrice } from "../src/data/services";
import { expect, test } from "./fixtures";
import { SERVICES } from "./apex-data";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const catalogRows = (page: Page) => page.getByRole("table", { name: "Services" }).locator("tbody tr");

/** Fills and advances the Add Service wizard to the Review step. */
async function fillWizard(page: Page, name: string) {
  const wizard = page.getByRole("dialog", { name: "Add new service" });
  await wizard.getByLabel("Service name").fill(name);
  await wizard.getByLabel("Customer-facing description").fill("A demo service used by the browser tests.");
  await wizard.getByRole("button", { name: /^Next: Booking/ }).click();
  await wizard.getByRole("radio", { name: /^Instant booking/ }).check();
  await wizard.getByRole("button", { name: /^Next: Pricing/ }).click();
  await wizard.getByLabel("Fee amount (USD)").or(wizard.getByLabel("Price (USD)")).fill("75");
  await wizard.getByRole("button", { name: /^Next: Availability/ }).click();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  return wizard;
}

test.describe("Services catalog", () => {
  test("/services lists the six canonical services with prices and booking methods from the fixtures", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible();
    await expect(page.getByText("Manage the HVAC services customers can book and your team can perform.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");

    await expect(catalogRows(page)).toHaveCount(6);

    for (const [index, service] of SERVICES.entries()) {
      const row = catalogRows(page).nth(index);
      await expect(row.getByRole("link", { name: service.name, exact: true })).toBeVisible();
      await expect(row).toContainText(formatServicePrice(service.pricing));
      await expect(row).toContainText(BOOKING_METHOD_LABEL[service.bookingMethod]);
    }
  });

  test("approved prices and booking methods match the spec literally (independent of the fixtures)", async ({ page }) => {
    await page.goto("/services");
    const expected: [string, string, string][] = [
      ["AC Repair & Diagnostics", "$89 diagnostic fee", "Request appointment"],
      ["Annual Cooling Tune-Up & Maintenance", "$129 fixed price", "Instant booking"],
      ["Heat Pump Diagnostics & Repair", "$99 diagnostic fee", "Request appointment"],
      ["Emergency No-Heat / No-Cool Service", "$149 call fee", "Request appointment"],
      ["Ductless Mini-Split Installation & Estimate", "Free assessment", "Request quote / assessment"],
      ["Furnace Safety Inspection & Tune-Up", "$119 fixed price", "Instant booking"],
    ];
    for (const [index, [name, price, method]] of expected.entries()) {
      const row = catalogRows(page).nth(index);
      await expect(row).toContainText(name);
      await expect(row).toContainText(price);
      await expect(row).toContainText(method);
    }
    await expect(page.getByText("Emergency handling")).toHaveCount(0);
  });

  test("search and filters narrow the catalog", async ({ page }) => {
    await page.goto("/services");

    await page.getByRole("searchbox", { name: "Search services" }).fill("furnace");
    await expect(catalogRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();

    await page.getByLabel("Booking method").selectOption("instant");
    await expect(catalogRows(page)).toHaveCount(2);
    await page.getByLabel("Booking method").selectOption("all");

    await page.getByLabel("Category").selectOption("Cooling");
    await expect(catalogRows(page)).toHaveCount(2);

    await page.getByLabel("Status").selectOption("inactive");
    await expect(page.getByText("No services match your filters.")).toBeVisible();
  });

  test("empty state shows one primary action and can restore the standard catalog", async ({ page }) => {
    await page.goto("/services?state=empty");
    await expect(page.getByRole("heading", { name: "No services configured yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add service" })).toHaveCount(1);
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.getByRole("button", { name: "Load standard HVAC starter services" }).click();
    await expect(page).toHaveURL("/services");
    await expect(catalogRows(page)).toHaveCount(6);
  });
});

test.describe("Service detail", () => {
  test("opens from the catalog and every approved tab renders the same record", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("link", { name: "AC Repair & Diagnostics", exact: true }).click();
    await expect(page).toHaveURL("/services/ac-repair-diagnostics");
    await expect(page.getByRole("heading", { level: 1, name: "AC Repair & Diagnostics" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");

    const tabs = page.getByRole("navigation", { name: "AC Repair & Diagnostics sections" });
    await expect(tabs.getByRole("link")).toHaveText(["Overview", "Pricing", "Booking settings", /^Customer intake\s*4$/, "Availability & visibility"]);

    // Overview
    await expect(page.getByRole("heading", { name: "Core definitions" })).toBeVisible();
    await expect(page.getByLabel("Service name")).toHaveValue("AC Repair & Diagnostics");
    await expect(page.getByLabel("Category")).toHaveValue("Cooling");
    await expect(page.getByLabel("Customer-facing description")).toContainText("Comprehensive inspection of your air conditioning system");
    await expect(page.getByLabel("Internal description")).toContainText("Standard cooling diagnostic fee");

    // Pricing
    await tabs.getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL("/services/ac-repair-diagnostics/pricing");
    await expect(page.getByRole("radio", { name: /^Diagnostic \/ service-call fee/ })).toBeChecked();
    await expect(page.getByLabel("Fee amount (USD)")).toHaveValue("89");
    await expect(page.getByLabel("Price label")).toHaveValue("diagnostic fee");

    // Booking settings
    await tabs.getByRole("link", { name: "Booking settings" }).click();
    await expect(page).toHaveURL("/services/ac-repair-diagnostics/booking-settings");
    await expect(page.getByRole("radio", { name: /^Request appointment/ })).toBeChecked();
    await expect(page.getByLabel("Estimated service duration")).toHaveValue("90");

    // Customer intake
    await tabs.getByRole("link", { name: /Customer intake/ }).click();
    await expect(page).toHaveURL("/services/ac-repair-diagnostics/customer-intake");
    await expect(page.getByRole("list", { name: "Intake questions" }).locator(":scope > li")).toHaveCount(4);
    await expect(page.getByText("What is your primary cooling issue?", { exact: true })).toBeVisible();

    // Availability & visibility
    await tabs.getByRole("link", { name: "Availability & visibility" }).click();
    await expect(page).toHaveURL("/services/ac-repair-diagnostics/availability");
    await expect(page.getByRole("radio", { name: /^Public · Website & booking/ })).toBeChecked();
    await expect(page.getByLabel("Display order")).toHaveValue("1");

    await expect(tabs.getByRole("link", { name: "Availability & visibility" })).toHaveAttribute("aria-current", "page");
    await expect(primaryNav(page).getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");
  });

  test("each service's tabs read its own record", async ({ page }) => {
    await page.goto("/services/annual-cooling-tune-up/pricing");
    await expect(page.getByRole("radio", { name: /^Fixed price/ })).toBeChecked();
    await expect(page.getByLabel("Price (USD)")).toHaveValue("129");
    await expect(page.getByLabel("Price label")).toHaveCount(0);

    await page.goto("/services/annual-cooling-tune-up/booking-settings");
    await expect(page.getByRole("radio", { name: /^Instant booking/ })).toBeChecked();

    await page.goto("/services/ductless-mini-split-estimate/pricing");
    await expect(page.getByRole("radio", { name: /^Free estimate \/ inspection/ })).toBeChecked();
    await expect(page.getByLabel("Price (USD)")).toHaveCount(0);

    await page.goto("/services/furnace-safety-inspection/customer-intake");
    await expect(page.getByText("No intake questions for this service")).toBeVisible();
  });

  test("edits are shared across tabs; Save applies them and Discard reverts them", async ({ page }) => {
    await page.goto("/services/heat-pump-diagnostics-repair/pricing");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);

    await page.getByLabel("Fee amount (USD)").fill("109");
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await expect(bar).toBeVisible();

    // The draft survives switching tabs.
    await page.getByRole("navigation", { name: /sections/ }).getByRole("link", { name: "Booking settings" }).click();
    await expect(bar).toBeVisible();
    await page.getByLabel("Estimated service duration").selectOption("120");

    await bar.getByRole("button", { name: "Save changes" }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByText("$109 diagnostic fee · 2 hours")).toBeVisible();

    // Saved changes show in the catalog.
    await page.getByRole("link", { name: "Back to Services" }).click();
    await expect(catalogRows(page).filter({ hasText: "Heat Pump Diagnostics & Repair" })).toContainText("$109 diagnostic fee");

    // Discard.
    await page.getByRole("link", { name: "Heat Pump Diagnostics & Repair", exact: true }).click();
    await page.getByLabel("Service name").fill("Something else");
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByLabel("Service name")).toHaveValue("Heat Pump Diagnostics & Repair");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);

    // Discard saved nothing and Save is stored: a reload still shows the saved price and the original name.
    await page.goto("/services");
    await expect(catalogRows(page).filter({ hasText: "Heat Pump Diagnostics & Repair" })).toContainText("$109 diagnostic fee");
    await expect(catalogRows(page).filter({ hasText: "Something else" })).toHaveCount(0);
  });

  test("saving is blocked with an accessible error when required fields are empty", async ({ page }) => {
    await page.goto("/services/ac-repair-diagnostics");
    await page.getByLabel("Service name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Enter a service name." })).toBeVisible();
    const field = page.getByLabel("Service name");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription("Enter a service name.");
  });

  test("deactivate asks for confirmation, then updates the catalog; activate restores it", async ({ page }) => {
    await page.goto("/services/emergency-no-heat-no-cool");
    await page.getByRole("button", { name: "Deactivate" }).click();

    const dialog = page.getByRole("dialog", { name: "Deactivate Emergency No-Heat / No-Cool Service?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeFocused();

    await page.getByRole("button", { name: "Deactivate" }).click();
    await dialog.getByRole("button", { name: "Deactivate service" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Back to Services" }).click();
    await expect(catalogRows(page).filter({ hasText: "Emergency No-Heat / No-Cool Service" })).toContainText("Inactive");

    await page.getByRole("link", { name: "Emergency No-Heat / No-Cool Service", exact: true }).click();
    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  });

  test("an unknown service id shows a not-found page inside the shell", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/); // the real HTTP 404 for the missing record
    await page.goto("/services/not-a-service");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await expect(primaryNav(page)).toBeVisible();
  });
});

test.describe("Add Service", () => {
  test("validates each step, then stores the new service after the canonical six", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("button", { name: "Add service" }).click();

    const wizard = page.getByRole("dialog", { name: "Add new service" });
    await expect(wizard).toBeVisible();
    await expect(wizard.getByRole("list", { name: "Add service steps" }).getByRole("listitem")).toHaveCount(5);

    // Step 1 blocks on empty required fields and announces them.
    await wizard.getByRole("button", { name: /^Next: Booking/ }).click();
    await expect(wizard.getByLabel("Service name")).toHaveAttribute("aria-invalid", "true");
    await expect(wizard.getByText("Enter a service name.")).toBeVisible();
    await expect(wizard.getByText("Describe what the service includes.")).toBeVisible();

    // A duplicate of a canonical name is rejected.
    await wizard.getByLabel("Service name").fill("ac repair & diagnostics");
    await wizard.getByLabel("Customer-facing description").fill("Duplicate.");
    await wizard.getByRole("button", { name: /^Next: Booking/ }).click();
    await expect(wizard.getByText("A service with this name already exists.")).toBeVisible();

    // Cancel discards; reopening starts blank.
    await wizard.getByRole("button", { name: "Cancel" }).click();
    await expect(wizard).toBeHidden();
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByRole("dialog", { name: "Add new service" }).getByLabel("Service name")).toHaveValue("");
    await page.getByRole("dialog", { name: "Add new service" }).getByRole("button", { name: "Cancel" }).click();

    // Happy path through all steps.
    await page.getByRole("button", { name: "Add service" }).click();
    const filled = await fillWizard(page, "Demo Ductwork Check");
    await expect(filled.getByRole("heading", { name: /Review/ })).toBeVisible();
    await expect(filled).toContainText("Demo Ductwork Check");
    await expect(filled).toContainText("Instant booking");
    await expect(filled).toContainText("$75 fixed price");
    await filled.getByRole("button", { name: "Add service" }).click();

    await expect(filled).toBeHidden();
    await expect(catalogRows(page)).toHaveCount(7);
    await expect(catalogRows(page).last()).toContainText("Demo Ductwork Check");
    await expect(page.getByText("Showing 7 of 7 services")).toBeVisible();

    // The new service can be opened.
    await page.getByRole("link", { name: "Demo Ductwork Check", exact: true }).click();
    await expect(page).toHaveURL("/services/demo-ductwork-check");
    await expect(page.getByLabel("Service name")).toHaveValue("Demo Ductwork Check");

    // A full reload shows it still, after the canonical six, which are untouched.
    await page.goto("/services");
    await expect(catalogRows(page)).toHaveCount(7);
    for (const [index, service] of SERVICES.entries()) {
      await expect(catalogRows(page).nth(index)).toContainText(service.name);
    }
    await expect(catalogRows(page).last()).toContainText("Demo Ductwork Check");
  });

  test("the wizard traps focus and closes with Escape", async ({ page }) => {
    await page.goto("/services");
    const trigger = page.getByRole("button", { name: "Add service" });
    await trigger.click();
    const wizard = page.getByRole("dialog", { name: "Add new service" });
    await expect(wizard).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(wizard).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
