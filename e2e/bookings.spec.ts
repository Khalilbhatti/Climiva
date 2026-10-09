import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";
import { SERVICES } from "./apex-data";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const bookingRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} bookings` }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const review = (page: Page, id: string) => page.getByRole("button", { name: new RegExp(`^Review booking ${id} `) });
const drawer = (page: Page) => page.getByRole("complementary", { name: "Booking details" });

/**
 * Walks the Create booking wizard for Sarah Mitchell → AC Repair & Diagnostics, stopping on the Review step.
 * Request-appointment services offer 2-hour arrival windows; "Midday" is 10:00 AM – 12:00 PM.
 */
async function fillBooking(page: Page, options: { technician?: string } = {}) {
  const wizard = page.getByRole("dialog", { name: "Create booking" });
  await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
  await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
  await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
  await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
  await wizard.getByRole("radio", { name: /^Midday/ }).check();
  await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
  await wizard.getByRole("radio", { name: new RegExp(`^${options.technician ?? "Marcus Vance"}`) }).check();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  return wizard;
}

test.describe("Bookings list", () => {
  test("renders the approved header, tabs with derived counts, columns and the Bookings sidebar state", async ({ page }) => {
    await page.goto("/bookings");
    await expect(page.getByRole("heading", { level: 1, name: "Bookings" })).toBeVisible();
    await expect(page.getByText("Review customer requests, confirm appointments and manage upcoming bookings.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Bookings/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Copy booking link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create booking" })).toBeVisible();

    const tabs = page.getByRole("tablist", { name: "Booking lists" });
    await expect(tabs.getByRole("tab")).toHaveText([/^Requests\s*2$/, /^Upcoming\s*5$/, /^Past\s*6$/, /^Cancelled\s*0$/]);
    await expect(tab(page, "Requests")).toHaveAttribute("aria-selected", "true");

    const table = page.getByRole("table", { name: "Requests bookings" });
    await expect(table.getByRole("columnheader")).toHaveText([
      "Customer",
      "Service",
      "Requested time",
      "Booking method",
      "Source",
      "Status",
      "Received",
      "Action",
    ]);
    await expect(bookingRows(page, "Requests")).toHaveCount(2);
  });

  test("the sidebar Bookings badge stays the Overview aggregate (24), not the number of fixtures", async ({ page }) => {
    await page.goto("/bookings");
    await expect(primaryNav(page).getByRole("link", { name: /^Bookings/ })).toContainText("24");
  });

  test("each tab shows only its status, from the shared status badges", async ({ page }) => {
    await page.goto("/bookings");
    const expected: [string, string, number, string][] = [
      ["Requests", "Requests", 2, "Pending confirmation"],
      ["Upcoming", "Upcoming", 5, "Confirmed"],
      ["Past", "Past", 6, "Completed"],
    ];
    for (const [tabName, tableName, count, status] of expected) {
      await tab(page, tabName).click();
      const rows = bookingRows(page, tableName);
      await expect(rows).toHaveCount(count);
      for (let index = 0; index < count; index += 1) await expect(rows.nth(index)).toContainText(status);
    }

    await tab(page, "Cancelled").click();
    await expect(page.getByText("No cancelled bookings.")).toBeVisible();
  });

  test("tabs are keyboard operable (arrow keys move and select) and the tab is deep-linkable", async ({ page }) => {
    await page.goto("/bookings");
    await tab(page, "Requests").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Upcoming")).toBeFocused();
    await expect(tab(page, "Upcoming")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/bookings\?tab=upcoming$/);

    await page.goto("/bookings?tab=past");
    await expect(tab(page, "Past")).toHaveAttribute("aria-selected", "true");
    await expect(bookingRows(page, "Past")).toHaveCount(6);
  });

  test("search narrows the list and explains an empty result", async ({ page }) => {
    // Sarah's AC repair (BK-1042) is completed, so her address is found under Past rather than Upcoming.
    await page.goto("/bookings?tab=past");
    const search = page.getByLabel("Search bookings");
    await search.fill("kinney");
    await expect(bookingRows(page, "Past")).toHaveCount(1);
    await expect(bookingRows(page, "Past").first()).toContainText("Sarah Mitchell");
    await expect(bookingRows(page, "Past").first()).toContainText("Completed");

    await page.goto("/bookings?tab=upcoming");
    await search.fill("kinney");
    await expect(page.getByText("No bookings match your search.")).toBeVisible();

    await search.fill("bradley");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(1);
    await expect(bookingRows(page, "Upcoming").first()).toContainText("Annual Cooling Tune-Up & Maintenance");

    await search.fill("zzz-no-match");
    await expect(page.getByText("No bookings match your search.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(bookingRows(page, "Upcoming")).toHaveCount(5);
  });

  test("service and source filters combine with the tab", async ({ page }) => {
    await page.goto("/bookings?tab=upcoming");
    await page.getByLabel("Service", { exact: true }).selectOption("ac-repair-diagnostics");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(2); // Elena, Hannah (Sarah's AC repair is completed)
    await page.getByLabel("Source", { exact: true }).selectOption("Website");
    await expect(page.getByText("No bookings match your search.")).toBeVisible();

    await page.getByLabel("Service", { exact: true }).selectOption("furnace-safety-inspection");
    await page.getByLabel("Source", { exact: true }).selectOption("Booking link");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(1);
    await expect(bookingRows(page, "Upcoming").first()).toContainText("Robert Ramirez");

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(bookingRows(page, "Upcoming")).toHaveCount(5);
  });

  test("snapshot names never show 'Elena Rostova'; Elena Rodriguez is the one name", async ({ page }) => {
    await page.goto("/bookings?tab=upcoming");
    await expect(bookingRows(page, "Upcoming").filter({ hasText: "Elena Rodriguez" })).toHaveCount(1);
    await expect(page.getByText("Rostova")).toHaveCount(0);
  });
});

test.describe("Booking details", () => {
  test("Review opens the details panel and closing returns focus to the Review button", async ({ page }) => {
    // BK-1042 (Sarah's AC repair, JB-204) is completed, so it is reviewed from the Past tab.
    await page.goto("/bookings?tab=past");
    await review(page, "BK-1042").click();

    await expect(page).toHaveURL(/booking=BK-1042/);
    const panel = drawer(page);
    await expect(panel.getByRole("heading", { level: 2, name: /Booking #BK-1042/ })).toBeVisible();
    await expect(panel).toContainText("Completed");
    await expect(panel).toContainText("Sarah Mitchell");
    await expect(panel).toContainText("1402 Kinney Ave");
    await expect(panel).toContainText("AC Repair & Diagnostics");
    await expect(panel).toContainText("Alex Morgan");
    await expect(panel.getByRole("link", { name: "View customer" })).toHaveAttribute("href", "/customers/sarah-mitchell");
    await expect(panel.getByRole("link", { name: /View job #JB-204/ })).toHaveAttribute("href", "/jobs/JB-204");

    await panel.getByRole("button", { name: "Close booking details" }).click();
    await expect(panel).toHaveCount(0);
    await expect(review(page, "BK-1042")).toBeFocused();
  });

  test("a requester without a customer record is shown honestly, with no invented contact details", async ({ page }) => {
    await page.goto("/bookings?booking=BK-1040");
    const panel = drawer(page);
    await expect(panel).toContainText("Claire Dubois");
    await expect(panel).toContainText("No customer record yet.");
    await expect(panel.getByRole("link", { name: "View customer" })).toHaveCount(0);
  });

  test("confirming a request moves it to Upcoming and then it can be assigned and given a job", async ({ page }) => {
    await page.goto("/bookings?booking=BK-1040");
    await drawer(page).getByRole("button", { name: "Confirm booking" }).click();

    await expect(tab(page, "Upcoming")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Upcoming")).toContainText("6");
    await expect(tab(page, "Requests")).toContainText("1");
    await expect(drawer(page)).toContainText("Confirmed");

    await drawer(page).getByRole("button", { name: "Assign technician" }).click();
    const assign = page.getByRole("dialog", { name: "Assign technician" });
    await assign.getByRole("radio", { name: /^Samira Patel/ }).check();
    await assign.getByRole("button", { name: "Save assignment" }).click();
    await expect(drawer(page).getByRole("button", { name: "Reassign" })).toBeVisible();
    await expect(drawer(page)).toContainText("Samira Patel");

    await drawer(page).getByRole("button", { name: "Create job" }).click();
    await expect(drawer(page).getByRole("link", { name: /View job #JB-205/ })).toHaveAttribute("href", "/jobs/JB-205");
  });

  test("declining a request needs a reason and files it under Cancelled", async ({ page }) => {
    await page.goto("/bookings?booking=BK-1038");
    await drawer(page).getByRole("button", { name: "Decline request" }).click();

    const dialog = page.getByRole("dialog", { name: "Decline this request?" });
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(dialog.getByText("Enter a reason.")).toBeVisible();

    await dialog.getByLabel("Reason").fill("Outside our service area.");
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(tab(page, "Cancelled")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Cancelled")).toContainText("1");
    await expect(drawer(page)).toContainText("Cancelled");
    await expect(drawer(page)).toContainText("Outside our service area.");
    await expect(tab(page, "Requests")).toContainText("1");
  });
});

test.describe("Create booking", () => {
  test("opens from Bookings with the five approved steps and nothing else", async ({ page }) => {
    await page.goto("/bookings");
    await page.getByRole("button", { name: "Create booking" }).click();

    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await expect(wizard).toBeVisible();
    await expect(page).toHaveURL(/\/bookings\?new=1$/);
    const steps = wizard.getByRole("list", { name: "Create booking steps" }).getByRole("listitem");
    await expect(steps).toHaveText([/Customer/, /Service & property/, /Date & time/, /Assignment/, /Review/]);
    await expect(steps.first()).toHaveAttribute("aria-current", "step");
  });

  test("validates each step with accessible errors and keeps focus moving forward", async ({ page }) => {
    await page.goto("/bookings?new=1");
    const wizard = page.getByRole("dialog", { name: "Create booking" });

    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await expect(wizard.getByRole("alert").filter({ hasText: "Select a customer." })).toBeVisible();

    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await expect(wizard.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(wizard.getByRole("heading", { level: 3 })).toContainText("step 2 of 5");

    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await expect(wizard.getByRole("alert").filter({ hasText: "Select a service." })).toBeVisible();

    await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
    await expect(wizard.getByRole("alert").filter({ hasText: "Select an available time." })).toBeVisible();

    // Back keeps what was entered.
    await wizard.getByRole("button", { name: "Back" }).click();
    await expect(wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ })).toBeChecked();
  });

  test("offers only the six canonical services and Sarah's single property", async ({ page }) => {
    await page.goto("/bookings?new=1");
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();

    const serviceGroup = wizard.getByRole("group", { name: "Service", exact: true });
    await expect(serviceGroup.getByRole("radio")).toHaveCount(6);
    for (const service of SERVICES) await expect(serviceGroup.getByRole("radio", { name: new RegExp(`^${service.name.replace(/[/&]/g, ".")}`) })).toBeVisible();

    const propertyGroup = wizard.getByRole("group", { name: "Property", exact: true });
    await expect(propertyGroup.getByRole("radio")).toHaveCount(1);
    await expect(propertyGroup.getByRole("radio", { name: /^1402 Kinney Ave/ })).toBeChecked();
    await expect(propertyGroup).toContainText("Home");
    await expect(wizard).not.toContainText("South Lamar");
  });

  test("time options follow the service's booking method", async ({ page }) => {
    await page.goto("/bookings?new=1");
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();

    const cases: [RegExp, string][] = [
      [/^Annual Cooling Tune-Up/, "Start time · Instant booking"],
      [/^AC Repair & Diagnostics/, "Arrival window (2 hours) · Request appointment"],
      [/^Ductless Mini-Split/, "Consultation slot · Request quote / assessment"],
    ];
    for (const [service, legend] of cases) {
      await wizard.getByRole("radio", { name: service }).check();
      await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
      await expect(wizard.getByRole("group", { name: legend })).toBeVisible();
      await wizard.getByRole("button", { name: "Back" }).click();
    }
  });

  test("business hours decide availability: Sunday is closed and Saturday afternoons are not offered", async ({ page }) => {
    await page.goto("/bookings?new=1");
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();

    await wizard.getByLabel("Select date").fill("2024-10-26"); // Saturday, closes 2 PM
    await expect(wizard.getByRole("radio", { name: /^Morning/ })).toBeEnabled();
    await expect(wizard.getByRole("radio", { name: /^Afternoon/ })).toBeDisabled();

    await wizard.getByLabel("Select date").fill("2024-10-27"); // Sunday, closed
    await expect(wizard.getByText(/closed on Sun/i)).toBeVisible();
    await expect(wizard.getByRole("radio", { name: /^Morning/ })).toHaveCount(0);
  });

  test("creates a stored booking, shows success and returns to Bookings with it visible", async ({ page }) => {
    await page.goto("/bookings");
    await page.getByRole("button", { name: "Create booking" }).click();
    const wizard = await fillBooking(page);

    await expect(wizard.getByRole("heading", { level: 3 })).toContainText("Review booking");
    await expect(wizard).toContainText("Sarah Mitchell");
    await expect(wizard).toContainText("1402 Kinney Ave, Austin, TX 78704");
    await expect(wizard).toContainText("AC Repair & Diagnostics");
    await expect(wizard).toContainText("Fri, Oct 25 · 10:00 AM – 12:00 PM");
    await expect(wizard).toContainText("Marcus Vance");

    await wizard.getByRole("button", { name: "Create booking" }).click();

    const success = page.getByRole("dialog", { name: "Booking created" });
    await expect(success).toBeVisible();
    await expect(success).toContainText("Appointment scheduled");
    await expect(success).toContainText("#BK-1043");
    await expect(success).toContainText("Sarah Mitchell");
    await expect(success).toContainText("Marcus Vance");

    await success.getByRole("button", { name: "View booking" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/bookings\?tab=upcoming&booking=BK-1043$/);
    await expect(tab(page, "Upcoming")).toContainText("6");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(6);
    await expect(drawer(page)).toContainText("Booking #BK-1043");
    await expect(drawer(page)).toContainText("Marcus Vance");

    // It is stored: a reload keeps it.
    await page.goto("/bookings?tab=upcoming");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(6);
    await expect(page.getByRole("button", { name: /^Review booking BK-1043 / })).toBeVisible();
  });

  test("the new booking appears on the Schedule and Cancel discards the draft", async ({ page }) => {
    await page.goto("/bookings?new=1");
    await fillBooking(page);
    await page.getByRole("dialog", { name: "Create booking" }).getByRole("button", { name: "Create booking" }).click();
    await page.getByRole("dialog", { name: "Booking created" }).getByRole("button", { name: "View in schedule" }).click();

    // Client-side navigation keeps this session's data.
    await expect(page).toHaveURL(/\/schedule\?view=day&date=2024-10-25&event=BK-1043$/);
    await expect(page.locator("#event-BK-1043")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Booking #BK-1043");

    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await page.getByRole("button", { name: "Create booking" }).click();
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await expect(wizard.getByRole("radio", { name: /^Sarah Mitchell/ })).not.toBeChecked(); // a fresh draft
    await wizard.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/bookings$/);
  });

  test("Escape closes the wizard and the opening button regains focus", async ({ page }) => {
    await page.goto("/bookings");
    const open = page.getByRole("button", { name: "Create booking" });
    await open.click();
    await expect(page.getByRole("dialog", { name: "Create booking" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(open).toBeFocused();
  });
});

test.describe("one Create booking flow, many entry points", () => {
  test("Overview 'New booking' (header action and quick action) opens the real flow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "New booking", exact: true }).click();
    await expect(page).toHaveURL(/\/bookings\?new=1$/);
    await expect(page.getByRole("dialog", { name: "Create booking" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Bookings" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: /New booking/ }).click();
    await expect(page).toHaveURL(/\/bookings\?new=1$/);
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await expect(wizard.getByRole("list", { name: "Create booking steps" }).getByRole("listitem")).toHaveCount(5);
  });

  test("the customer page's 'New booking' preselects that customer", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    await page.getByRole("link", { name: "New booking" }).click();
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await expect(wizard.getByRole("radio", { name: /^Sarah Mitchell/ })).toBeChecked();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await expect(wizard.getByRole("heading", { level: 3 })).toContainText("step 2 of 5");
  });
});
