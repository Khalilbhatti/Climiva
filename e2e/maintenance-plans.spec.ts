import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const main = (page: Page) => page.getByRole("main");

/** Walks Schedule included visit for Sarah's Cooling visit to Nov 19, 10:00 AM – 12:00 PM with Marcus Vance, ending on Review. */
async function fillVisit(page: Page) {
  const wizard = page.getByRole("dialog", { name: "Schedule included visit" });
  await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
  await wizard.getByLabel("Service date").fill("2024-11-19");
  await wizard.getByRole("radio", { name: /^Midday/ }).check();
  await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
  await wizard.getByRole("radio", { name: /^Marcus Vance/ }).check();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  return wizard;
}

/** Create maintenance plan for Elena Rodriguez, stopping on Review. */
async function fillPlan(page: Page, name = "Comfort Care") {
  const wizard = page.getByRole("dialog", { name: "Create maintenance plan" });
  await wizard.getByRole("radio", { name: /^Elena Rodriguez/ }).check();
  await wizard.getByRole("button", { name: /^Next: Property/ }).click();
  await wizard.getByRole("button", { name: /^Next: Coverage/ }).click();
  await wizard.getByRole("button", { name: /^Next: Plan terms/ }).click();
  await wizard.getByLabel(/^Plan name/).fill(name);
  await wizard.getByLabel(/^Agreement price/).fill("189");
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  return wizard;
}

test.describe("Maintenance Plans list", () => {
  test("renders the approved header, totals and the Maintenance Plans sidebar state", async ({ page }) => {
    await page.goto("/maintenance-plans");
    await expect(page.getByRole("heading", { level: 1, name: "Maintenance Plans" })).toBeVisible();
    await expect(page.getByText("Manage recurring HVAC service agreements, included visits, and upcoming maintenance.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Maintenance Plans/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();

    const totals = page.getByRole("region", { name: "Maintenance plan totals" });
    await expect(totals.getByText("Active plans")).toBeVisible();
    await expect(totals).toContainText("14");
    await expect(totals).toContainText("Visits due");
    await expect(totals).toContainText("Upcoming renewals");
    await expect(totals).toContainText("Paused or ended");
    await expect(totals).toContainText("1 paused · 1 ended");
    // The approved totals are aggregates, not a count of the sample records below them.
    await expect(totals.getByText("14", { exact: true })).toBeVisible();
    await expect(totals.getByText("5", { exact: true })).toBeVisible();
    await expect(totals.getByText("3", { exact: true })).toBeVisible();
    await expect(totals.getByText("2", { exact: true })).toBeVisible();
  });

  test("Active, Upcoming service and All plans are one accessible tab list over one dataset", async ({ page }) => {
    await page.goto("/maintenance-plans");
    const tabs = page.getByRole("tablist", { name: "Maintenance plan views" });
    await expect(tabs.getByRole("tab")).toHaveText([/^Active\s*14$/, /^Upcoming service\s*5$/, /^All plans\s*16$/]);
    await expect(tab(page, "Active")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Active plans" })).toBeVisible();

    await tab(page, "Active").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Upcoming service")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/view=upcoming/);
    await expect(page.getByRole("table", { name: "Upcoming service" })).toBeVisible();
    await expect(page.getByText("Showing 3 of 5 visits due")).toBeVisible();

    await tab(page, "All plans").click();
    await expect(page).toHaveURL(/view=all/);
    await expect(page.getByRole("table", { name: "All plans" })).toBeVisible();
    await expect(page.getByText("Showing 6 of 16 total plans")).toBeVisible();
    // The view is deep-linkable.
    await page.goto("/maintenance-plans?view=all");
    await expect(tab(page, "All plans")).toHaveAttribute("aria-selected", "true");
  });

  test("Sarah Mitchell's Comfort Care row carries the approved values", async ({ page }) => {
    await page.goto("/maintenance-plans");
    const row = page.getByRole("table", { name: "Active plans" }).locator("tbody tr", { hasText: "Sarah Mitchell" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("1402 Kinney Ave");
    await expect(row).toContainText("Austin, TX 78704");
    await expect(row).toContainText("Comfort Care");
    await expect(row).toContainText("$189 / year");
    await expect(row).toContainText("2 visits / year");
    await expect(row).toContainText("1 of 2 used");
    await expect(row).toContainText("May 14, 2025");
    await expect(row).toContainText("Active");
    await expect(page.getByText("Comfort Plus")).toHaveCount(0);
  });

  test("search and the plan filter narrow the list and can be cleared", async ({ page }) => {
    await page.goto("/maintenance-plans");
    const rows = page.getByRole("table", { name: "Active plans" }).locator("tbody tr");
    await expect(rows).toHaveCount(4);

    await page.getByRole("searchbox", { name: "Search plans" }).fill("mitchell");
    await expect(rows).toHaveCount(1);
    await expect(page.getByText("Showing 1 of 14 active plans")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search plans" }).fill("zzz-none");
    await expect(page.getByText("No plans match your filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows).toHaveCount(4);

    await page.getByLabel("Plan", { exact: true }).selectOption("Seasonal Maintenance");
    await expect(rows).toHaveCount(2);
  });

  test("All plans filters by status and shows paused and ended plans with their notes", async ({ page }) => {
    await page.goto("/maintenance-plans?view=all");
    const rows = page.getByRole("table", { name: "All plans" }).locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await page.getByLabel("Status", { exact: true }).selectOption("paused");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Paused");
    await page.getByLabel("Status", { exact: true }).selectOption("ended");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Ended");
  });

  test("Upcoming service lists visits to schedule and filters by booking status", async ({ page }) => {
    await page.goto("/maintenance-plans?view=upcoming");
    const rows = page.getByRole("table", { name: "Upcoming service" }).locator("tbody tr");
    await expect(rows).toHaveCount(3);
    const sarah = rows.filter({ hasText: "Sarah Mitchell" });
    await expect(sarah).toContainText("Comfort Care");
    await expect(sarah).toContainText("Cooling maintenance");
    await expect(sarah).toContainText("Due November 2024");
    await expect(sarah.getByRole("button", { name: "Schedule visit for Sarah Mitchell" })).toBeVisible();

    await page.getByLabel("Booking status", { exact: true }).selectOption("scheduled");
    await expect(page.getByText("No visits match your filters.")).toBeVisible();
  });

  test("the empty state offers one primary action and no promotional cards", async ({ page }) => {
    await page.goto("/maintenance-plans?state=empty");
    await expect(page.getByRole("heading", { name: "No maintenance plans yet" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Create plan" })).toHaveCount(2); // header action + the empty state's own
    await expect(page.getByRole("table")).toHaveCount(0);
    for (const promo of [/upgrade/i, /learn more/i, /free trial/i, /unlock/i]) await expect(main(page).getByText(promo)).toHaveCount(0);
  });
});

test.describe("Maintenance plan detail", () => {
  test("Comfort Care shows the canonical agreement, coverage and visit history", async ({ page }) => {
    await page.goto("/maintenance-plans");
    await page.getByRole("link", { name: "View plan: Comfort Care for Sarah Mitchell" }).click();
    await expect(page).toHaveURL("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByRole("heading", { level: 1, name: "Comfort Care" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Maintenance Plans/ })).toHaveAttribute("aria-current", "page");

    const facts = page.getByRole("main").locator("dl").first();
    await expect(facts).toContainText("Sarah Mitchell");
    await expect(facts).toContainText("1402 Kinney Ave");
    await expect(facts).toContainText("$189 / year");
    await expect(facts).toContainText("2 visits / yr");
    await expect(facts).toContainText("May 14, 2024");
    await expect(facts).toContainText("May 14, 2025");

    // Coverage is cooling and heating maintenance only.
    const coverage = page.getByRole("region", { name: "Plan coverage" });
    await expect(coverage).toContainText("Cooling maintenance");
    await expect(coverage).toContainText("Heating maintenance");
    for (const other of ["Furnace Safety", "AC Repair", "Heat Pump", "Emergency", "Mini-Split", "Duct"]) await expect(coverage).not.toContainText(other);

    const history = page.getByRole("table", { name: "Plan service history" });
    // History lists visits that happened or are booked; the visit still to schedule is the upcoming service.
    await expect(history.locator("tbody tr")).toHaveCount(1);
    await expect(history).toContainText("Heating maintenance");
    await expect(history).toContainText("Completed");
    const upcoming = page.getByRole("region", { name: "Upcoming included service" });
    await expect(upcoming).toContainText("Cooling maintenance");
    await expect(upcoming).toContainText("Due November 2024");

    await page.getByRole("link", { name: "Back to Maintenance Plans" }).click();
    await expect(page).toHaveURL("/maintenance-plans");
  });

  test("an unknown plan shows a not-found state inside the shell", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/maintenance-plans/plan-nobody");
    await expect(page.getByRole("heading", { name: "Plan not found" })).toBeVisible();
    await expect(primaryNav(page)).toBeVisible();
    await page.getByRole("link", { name: "Back to Maintenance Plans" }).click();
    await expect(page).toHaveURL("/maintenance-plans");
  });
});

test.describe("Create maintenance plan", () => {
  test("opens from Create plan and from the Overview quick action as the same five-step flow", async ({ page }) => {
    await page.goto("/maintenance-plans");
    await page.getByRole("button", { name: "Create plan" }).click();
    const wizard = page.getByRole("dialog", { name: "Create maintenance plan" });
    await expect(wizard.getByRole("list", { name: "Create maintenance plan steps" }).getByRole("listitem")).toHaveText([
      /Customer/,
      /Property/,
      /Coverage/,
      /Plan terms/,
      /Review/,
    ]);
    await page.keyboard.press("Escape");
    await expect(wizard).toBeHidden();

    await page.goto("/");
    await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: /Create maintenance plan/ }).click();
    await expect(page.getByRole("dialog", { name: "Create maintenance plan" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    // Other quick actions are unaffected.
    await page.goto("/");
    await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: /Record payment/ }).click();
    await expect(page).toHaveURL("/payments?record=1");
  });

  test("each step validates with an error tied to what is missing", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = page.getByRole("dialog", { name: "Create maintenance plan" });
    await wizard.getByRole("button", { name: /^Next: Property/ }).click();
    await expect(wizard.getByRole("alert")).toContainText("Select a customer.");

    await wizard.getByRole("radio", { name: /^Elena Rodriguez/ }).check();
    await wizard.getByRole("button", { name: /^Next: Property/ }).click();
    await wizard.getByRole("button", { name: /^Next: Coverage/ }).click();
    // Zero visits cannot be created.
    await wizard.getByRole("button", { name: "Fewer cooling maintenance visits" }).click();
    await wizard.getByRole("button", { name: "Fewer heating maintenance visits" }).click();
    await wizard.getByRole("button", { name: /^Next: Plan terms/ }).click();
    await expect(wizard.getByRole("alert")).toContainText("Include at least one maintenance visit.");
    await wizard.getByRole("button", { name: "More cooling maintenance visits" }).click();
    await wizard.getByRole("button", { name: /^Next: Plan terms/ }).click();

    await wizard.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(wizard.getByText("Enter a plan name.")).toBeVisible();
    await expect(wizard.getByText("Enter the agreement price as an amount above $0.")).toBeVisible();
    await wizard.getByLabel(/^Plan name/).fill("Comfort Care");
    await wizard.getByLabel(/^Agreement price/).fill("189");
    await wizard.getByLabel("Start date").fill("2024-10-25");
    await wizard.getByLabel("Renewal / end date").fill("2024-10-01");
    await wizard.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(wizard.getByText("The renewal / end date must be after the start date.")).toBeVisible();
  });

  test("uses the shared customers and properties: Sarah offers only her canonical Home", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = page.getByRole("dialog", { name: "Create maintenance plan" });
    await expect(wizard.getByRole("radio")).toHaveCount(5);
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Property/ }).click();
    const properties = wizard.getByRole("radio");
    await expect(properties).toHaveCount(1);
    await expect(properties.first()).toBeChecked();
    await expect(wizard).toContainText("1402 Kinney Ave");
    await expect(wizard).toContainText("Home · Austin, TX 78704");
    // She already has a plan: noted, never blocked.
    await expect(wizard.getByRole("status")).toContainText("already has an active plan (Comfort Care)");
  });

  test("coverage is cooling and heating maintenance, separate from the public Services", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = page.getByRole("dialog", { name: "Create maintenance plan" });
    await wizard.getByRole("radio", { name: /^Elena Rodriguez/ }).check();
    await wizard.getByRole("button", { name: /^Next: Property/ }).click();
    await wizard.getByRole("button", { name: /^Next: Coverage/ }).click();
    await expect(wizard.getByText("Cooling maintenance", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Heating maintenance", { exact: true })).toBeVisible();
    await expect(wizard.getByRole("group")).toHaveCount(2);
    for (const service of ["AC Repair & Diagnostics", "Emergency", "Mini-Split"]) await expect(wizard).not.toContainText(service);
    await expect(wizard).toContainText("2 included visits per year");
  });

  test("creating a plan shows the success state and adds it to the list, with no plan number and no other records", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page);
    await expect(wizard).toContainText("Elena Rodriguez");
    await expect(wizard).toContainText("Creating this Maintenance Plan does not automatically create a Booking, Job, Invoice or Payment.");
    await wizard.getByRole("button", { name: "Create plan" }).click();

    const done = page.getByRole("dialog", { name: "Maintenance plan created" });
    await expect(done).toContainText("Comfort Care is ready");
    await expect(done).toContainText("2 included visits / year");
    await expect(done).not.toContainText(/\b(MP|PLN|PLAN)-\d+/);
    await expect(done.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await expect(done.getByRole("button", { name: "Schedule first visit" })).toBeVisible();
    await expect(done.getByRole("link", { name: "View plan" })).toBeVisible();
    await done.getByRole("button", { name: "Close", exact: true }).click();

    await expect(page).toHaveURL("/maintenance-plans");
    const totals = page.getByRole("region", { name: "Maintenance plan totals" });
    await expect(totals).toContainText("15");
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("Elena Rodriguez");
    await expect(page.getByText("Showing 5 of 15 active plans")).toBeVisible();

    // Nothing else was created: Bookings still shows the approved lists.
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*2$/, /^Upcoming\s*5$/, /^Past\s*6$/, /^Cancelled\s*0$/]);
  });

  test("a created plan lasts for the session and resets on reload; View plan opens it", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page, "Peace of Mind");
    await wizard.getByRole("button", { name: "Create plan" }).click();
    await page.getByRole("dialog", { name: "Maintenance plan created" }).getByRole("link", { name: "View plan" }).click();
    await expect(page).toHaveURL(/\/maintenance-plans\/plan-elena-rodriguez-peace-of-mind$/);
    await expect(page.getByRole("heading", { level: 1, name: "Peace of Mind" })).toBeVisible();

    // Client navigation keeps the session...
    await primaryNav(page).getByRole("link", { name: /^Customers/ }).click();
    await primaryNav(page).getByRole("link", { name: /^Maintenance Plans/ }).click();
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("Peace of Mind");
    // ...and a reload restores the baseline.
    await page.reload();
    await expect(page.getByRole("table", { name: "Active plans" })).not.toContainText("Peace of Mind");
  });

  test("Schedule first visit leads straight into the Schedule included visit flow", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page);
    await wizard.getByRole("button", { name: "Create plan" }).click();
    await page.getByRole("dialog", { name: "Maintenance plan created" }).getByRole("button", { name: "Schedule first visit" }).click();
    const visit = page.getByRole("dialog", { name: "Schedule included visit" });
    await expect(visit).toBeVisible();
    await expect(visit).toContainText("Visit 1 of 2");
    await expect(visit).toContainText("Elena Rodriguez");
  });
});

test.describe("Schedule an included visit", () => {
  test("creates BK-1048 for Sarah's Cooling visit and shows it in Bookings, Schedule and the plan", async ({ page }) => {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = page.getByRole("dialog", { name: "Schedule included visit" });
    await expect(wizard).toContainText("Cooling maintenance");
    await expect(wizard).toContainText("Visit 2 of 2");
    await expect(wizard).toContainText("No new Invoice or Payment is created");
    await fillVisit(page);
    await expect(wizard).toContainText("Nov 19, 2024");
    await expect(wizard).toContainText("10:00 AM – 12:00 PM");
    await expect(wizard).toContainText("Marcus Vance (Technician)");
    await expect(wizard).toContainText("Cooling maintenance");
    await wizard.getByRole("button", { name: "Create booking" }).click();

    const done = page.getByRole("dialog", { name: "Maintenance visit scheduled" });
    await expect(done).toContainText("Booking #BK-1048 confirmed");
    await expect(done).toContainText("2 of 2");
    await expect(done).toContainText("No Job, Invoice or Payment is created");
    await done.getByRole("button", { name: "Close", exact: true }).click();

    // The plan now points at the booking.
    const history = page.getByRole("table", { name: "Plan service history" });
    await expect(history).toContainText("BK-1048");
    await expect(history).toContainText("Scheduled");
    await expect(page.getByRole("region", { name: "Upcoming included service" })).toContainText("BK-1048");

    // Bookings: one more upcoming booking, labelled as the plan's visit.
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*2$/, /^Upcoming\s*6$/, /^Past\s*6$/, /^Cancelled\s*0$/]);
    await tab(page, "Upcoming").click();
    const row = page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr", { hasText: "Comfort Care" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Sarah Mitchell");
    await expect(row).toContainText("Annual Cooling Tune-Up & Maintenance");
    await expect(row).toContainText("Visit 2 of 2");
    await expect(row).toContainText("Maintenance plan");
    await row.getByRole("button", { name: /^Review booking BK-1048/ }).click();
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("Nov 19");
    await expect(drawer).toContainText("Marcus Vance");
    await expect(drawer.getByRole("link", { name: /Comfort Care/ })).toBeVisible();
    // No job came with it.
    await expect(drawer.getByRole("link", { name: /View job/ })).toHaveCount(0);

    // Schedule: the visit is on Marcus Vance's day.
    await drawer.getByRole("link", { name: "View in schedule" }).click();
    await expect(page).toHaveURL(/\/schedule\?view=day&date=2024-11-19&event=BK-1048/);
    const event = page.getByRole("complementary", { name: "Booking details" });
    await expect(event).toContainText("Booking #BK-1048");
    await expect(event).toContainText("Sarah Mitchell");
    await expect(event).toContainText("Marcus Vance");
    await expect(event).toContainText("Tue, Nov 19 · 10:00 AM – 12:00 PM");
  });

  test("scheduling an included visit leaves Jobs, Quotes, Invoices and Payments exactly as approved", async ({ page }) => {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    await wizard.getByRole("button", { name: "Create booking" }).click();
    await page.getByRole("dialog", { name: "Maintenance visit scheduled" }).getByRole("button", { name: "Close", exact: true }).click();

    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await expect(main(page)).not.toContainText("BK-1048");
    await expect(main(page)).not.toContainText("Nov 19");

    await primaryNav(page).getByRole("link", { name: /^Overview/ }).click();
    const metrics = page.getByRole("region", { name: "Key metrics" });
    await expect(metrics).toContainText("$6,240");
    await expect(metrics).toContainText("$2,130");
    await expect(metrics).toContainText("7 recorded non-voided payments");

    await primaryNav(page).getByRole("link", { name: /^Payments/ }).click();
    await expect(main(page)).toContainText("$2,130");
    await expect(main(page)).not.toContainText("Comfort Care");
  });

  test("the visit date must fall inside the visit's target window", async ({ page }) => {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = page.getByRole("dialog", { name: "Schedule included visit" });
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
    await expect(wizard.getByText("Select a service date.")).toBeVisible();
    await wizard.getByLabel("Service date").fill("2024-12-10");
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
    await expect(wizard.getByText(/Select a date between Nov 1, 2024 and Nov 30, 2024/)).toBeVisible();
    // A closed day offers no arrival windows.
    await wizard.getByLabel("Service date").fill("2024-11-17");
    await expect(wizard.getByText("The business is closed on Suns.")).toBeVisible();
  });

  test("cancelling the booking reopens the visit for scheduling", async ({ page }) => {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    await wizard.getByRole("button", { name: "Create booking" }).click();
    await page.getByRole("dialog", { name: "Maintenance visit scheduled" }).getByRole("link", { name: "View booking" }).click();
    await expect(page).toHaveURL(/booking=BK-1048/);
    await page.getByRole("complementary", { name: "Booking details" }).getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await dialog.getByLabel("Reason").fill("Customer asked to rebook.");
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(dialog).toBeHidden();

    await primaryNav(page).getByRole("link", { name: /^Maintenance Plans/ }).click();
    await page.getByRole("link", { name: "View plan: Comfort Care for Sarah Mitchell" }).click();
    await expect(page.getByRole("button", { name: "Schedule visit" }).first()).toBeVisible();
  });
});

test.describe("Customers show the plan record", () => {
  test("Sarah's agreement and David's final plan label come from Maintenance Plans", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    const agreement = page.getByRole("region", { name: "Maintenance agreement" });
    await expect(agreement).toContainText("Comfort Care");
    await expect(agreement).toContainText("$189");

    await page.goto("/customers");
    const david = page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "David Chen" });
    await expect(david).toContainText("Seasonal Maintenance");
    await expect(page.getByText("Comfort Plus")).toHaveCount(0);
  });

  test("a plan created in the session shows on that customer's records", async ({ page }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page);
    await wizard.getByRole("button", { name: "Create plan" }).click();
    await page.getByRole("dialog", { name: "Maintenance plan created" }).getByRole("button", { name: "Close", exact: true }).click();
    await primaryNav(page).getByRole("link", { name: /^Customers/ }).click();
    await expect(page.getByRole("table", { name: "Customers" }).locator("tbody tr", { hasText: "Elena Rodriguez" })).toContainText("Comfort Care");
    await page.getByRole("searchbox", { name: "Search customers", exact: true }).fill("elena");
    await page.getByRole("link", { name: /^View customer/ }).first().click();
    await expect(page.getByRole("region", { name: "Maintenance agreement" })).toContainText("Comfort Care");
  });
});
