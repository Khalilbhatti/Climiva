import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const viewTab = (page: Page, name: "Day" | "Week") => page.getByRole("tab", { name });
const heading = (page: Page) => page.locator("main h2[aria-live=polite]");
const details = (page: Page) => page.getByRole("complementary", { name: "Event details" }).or(page.getByRole("complementary", { name: "Booking details" }));
const weekColumn = (page: Page, label: string) => page.getByRole("list", { name: "Week schedule" }).getByRole("listitem", { name: label });
const technicianRow = (page: Page, name: string) => page.getByRole("list", { name: "Technician timelines" }).getByRole("listitem").filter({ hasText: name });

test.describe("Schedule", () => {
  test("renders the approved header and opens on the current week with Week selected", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(page.getByText("See upcoming work, assign technicians and manage appointment times.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");

    await expect(page.getByRole("tablist", { name: "Schedule view" }).getByRole("tab")).toHaveText(["Day", "Week"]);
    await expect(viewTab(page, "Week")).toHaveAttribute("aria-selected", "true");
    await expect(heading(page)).toContainText("Oct 21");
    await expect(heading(page)).toContainText("Oct 27, 2024");
    await expect(heading(page)).toContainText("Current");
    await expect(page.getByText("Central Time (CT)")).toBeVisible();
    await expect(page.getByLabel("Technician", { exact: true })).toHaveValue("all");
    await expect(page.getByLabel("Service", { exact: true })).toHaveValue("all");
  });

  test("does not offer drag-and-drop, maps, travel estimates or optimisation features", async ({ page }) => {
    for (const path of ["/schedule", "/schedule?view=day"]) {
      await page.goto(path);
      const text = (await page.locator("main").innerText()).toLowerCase();
      for (const term of ["drag", "route", "travel", "gps", "heatmap", "capacity", "optimiz", "smart"]) {
        expect(text, `${path} mentions “${term}”`).not.toContain(term);
      }
      await expect(page.locator("[draggable='true']")).toHaveCount(0);
    }
  });

  test("Week view lays out Monday–Sunday with today highlighted and Sunday closed", async ({ page }) => {
    await page.goto("/schedule");
    const columns = page.getByRole("list", { name: "Week schedule" }).getByRole("listitem");
    await expect(columns).toHaveCount(7);
    for (const label of ["Mon, Oct 21", "Tue, Oct 22", "Wed, Oct 23", "Thu, Oct 24", "Fri, Oct 25", "Sat, Oct 26", "Sun, Oct 27"]) {
      await expect(weekColumn(page, label)).toBeVisible();
    }
    await expect(weekColumn(page, "Fri, Oct 25")).toContainText("Today");
    await expect(weekColumn(page, "Fri, Oct 25")).toContainText("5 items");
    await expect(weekColumn(page, "Sun, Oct 27")).toContainText("Closed");
    await expect(weekColumn(page, "Tue, Oct 22")).toContainText("Team Safety Training");
  });

  test("events come from bookings and jobs and show customer, service, status and technician", async ({ page }) => {
    await page.goto("/schedule");
    const friday = weekColumn(page, "Fri, Oct 25");
    const sarah = friday.locator("#event-JB-204");
    await expect(sarah).toContainText("10:00 AM – 12:00 PM");
    await expect(sarah).toContainText("Completed"); // JB-204 is finished work, not in progress
    await expect(sarah).toContainText("Sarah Mitchell");
    await expect(sarah).toContainText("AC Repair & Diagnostics");
    await expect(sarah).toContainText("Alex");

    await expect(friday.locator("#event-JB-201")).toContainText("David Chen");
    await expect(friday.locator("#event-JB-201")).toContainText("Marcus");
    await expect(friday.locator("#event-JB-186")).toContainText("Completed");
    await expect(friday.locator("#event-JB-198")).toContainText("Elena Rodriguez");
    await expect(friday.locator("#event-JB-198")).toContainText("Unassigned");
    await expect(friday.locator("#event-BLK-2")).toContainText("Training / Off duty");

    // Pending requests are not on the calendar.
    await expect(page.getByText("Claire Dubois")).toHaveCount(0);
    await expect(page.getByText("Jason Miller")).toHaveCount(0);
    // The stale name appears nowhere.
    await expect(page.getByText("Rostova")).toHaveCount(0);
  });

  test("the unassigned banner lists confirmed work without a technician", async ({ page }) => {
    await page.goto("/schedule");
    const banner = page.getByRole("region", { name: "Unassigned work" });
    await expect(banner).toContainText("Unassigned · 2");
    await expect(banner).toContainText("Elena Rodriguez");
    await expect(banner).toContainText("Robert Ramirez");
  });

  test("an event can be opened with the keyboard alone, and closing returns focus to it", async ({ page }) => {
    await page.goto("/schedule");
    const event = page.locator("#event-JB-204");
    await event.focus();
    await page.keyboard.press("Enter");

    // The selected event lives in the address, and the page is rendered on the server per request now, so changing the address is a round trip.
    await expect(page).toHaveURL(/event=JB-204/, { timeout: 15_000 });
    const panel = details(page);
    await expect(panel).toContainText("Booking #BK-1042");
    await expect(panel).toContainText("Sarah Mitchell");
    await expect(panel).toContainText("1402 Kinney Ave");
    await expect(panel.getByRole("link", { name: /View job #JB-204/ })).toHaveAttribute("href", "/jobs/JB-204");
    // Like every completed booking, it offers its job rather than the confirmed-booking actions.
    await expect(panel).toContainText("Completed");
    await expect(panel.getByRole("link", { name: "View booking" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /Reassign|Assign technician|Create job/ })).toHaveCount(0);
    await expect(event).toHaveAttribute("aria-pressed", "true");

    await panel.getByRole("button", { name: "Close booking details" }).click();
    await expect(panel).toHaveCount(0);
    await expect(event).toBeFocused();
  });

  test("internal blocks open a simple details panel", async ({ page }) => {
    await page.goto("/schedule");
    await page.locator("#event-BLK-2").click();
    const panel = page.getByRole("complementary", { name: "Event details" });
    await expect(panel).toContainText("Training / Off duty");
    await expect(panel).toContainText("Samira Patel");
    await expect(panel).toContainText("Internal blocked time");
  });
});

test.describe("Schedule navigation and views", () => {
  test("previous, next and Today move through weeks and return to the current one", async ({ page }) => {
    await page.goto("/schedule");
    const today = page.getByRole("button", { name: "Today", exact: true });
    await expect(today).toBeDisabled();

    await page.getByRole("button", { name: "Next week" }).click();
    await expect(heading(page)).toContainText("Oct 28");
    await expect(heading(page)).toContainText("Nov 3, 2024");
    await expect(heading(page)).not.toContainText("Current");
    await expect(page.locator("#event-BK-1041")).toBeVisible(); // Robert Ramirez, Mon Oct 28
    await expect(page.locator("#event-JB-204")).toHaveCount(0);

    await page.getByRole("button", { name: "Previous week" }).click();
    // Let the first step land before the second: the date lives in the URL, which updates asynchronously.
    await expect(heading(page)).toContainText("Oct 21");
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(heading(page)).toContainText("Oct 14");
    await expect(page.locator("#event-JB-204")).toHaveCount(0);

    await today.click();
    await expect(heading(page)).toContainText("Oct 21");
    await expect(heading(page)).toContainText("Current");
    await expect(page.locator("#event-JB-204")).toBeVisible();
  });

  test("the Day/Week switcher is an accessible tab list and the view is deep-linkable", async ({ page }) => {
    await page.goto("/schedule");
    await viewTab(page, "Week").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(viewTab(page, "Day")).toBeFocused();
    await expect(viewTab(page, "Day")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/view=day/);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(heading(page)).toHaveText("Today, Friday, October 25, 2024");

    await page.goto("/schedule?view=day&date=2024-10-26");
    await expect(heading(page)).toHaveText("Saturday, October 26, 2024");
    await expect(page.locator("#event-JB-195")).toBeVisible(); // Bradley Cooper, Samira
    await expect(page.locator("#event-JB-204")).toHaveCount(0);

    await page.getByRole("button", { name: "Next day" }).click();
    await expect(heading(page)).toHaveText("Sunday, October 27, 2024");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(heading(page)).toHaveText("Today, Friday, October 25, 2024");
  });

  test("Day view shows one timeline row per technician with that technician's work", async ({ page }) => {
    await page.goto("/schedule?view=day");
    await expect(page.getByRole("list", { name: "Technician timelines" }).getByRole("listitem")).toHaveCount(3);

    const alex = technicianRow(page, "Alex Morgan");
    await expect(alex).toContainText("Operations Lead");
    await expect(alex.locator("#event-JB-204")).toBeVisible();

    const marcus = technicianRow(page, "Marcus Vance");
    await expect(marcus).toContainText("Technician");
    await expect(marcus.locator("#event-JB-186")).toBeVisible();
    await expect(marcus.locator("#event-JB-201")).toBeVisible();

    const samira = technicianRow(page, "Samira Patel");
    await expect(samira.locator("#event-BLK-2")).toContainText("Training / Off duty");

    const unassigned = page.getByRole("region", { name: /^Unassigned/ });
    await expect(unassigned).toContainText("Elena Rodriguez");
    await expect(unassigned).toContainText("Robert Ramirez");
  });

  test("Day view opens details beside the timeline and moving to another day clears them", async ({ page }) => {
    await page.goto("/schedule?view=day");
    await page.locator("#event-JB-201").click();
    await expect(details(page)).toContainText("Booking #BK-1039");
    await expect(details(page)).toContainText("Heat Pump Diagnostics & Repair");

    await page.getByRole("button", { name: "Next day" }).click();
    await expect(details(page)).toHaveCount(0);
  });

  test("technician and service filters narrow the board, and Clear resets them", async ({ page }) => {
    await page.goto("/schedule");
    await page.getByLabel("Technician", { exact: true }).selectOption("marcus-vance");
    await expect(page.locator("#event-JB-201")).toBeVisible();
    await expect(page.locator("#event-JB-186")).toBeVisible();
    await expect(page.locator("#event-JB-204")).toHaveCount(0);
    await expect(page.locator("#event-BLK-2")).toHaveCount(0); // Samira's block
    await expect(page.locator("#event-BLK-1")).toBeVisible(); // team-wide training

    await page.getByLabel("Service", { exact: true }).selectOption("annual-cooling-tune-up");
    await expect(page.locator("#event-JB-201")).toHaveCount(0);

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.locator("#event-JB-204")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  });

  test("assigning unassigned work updates the board and the banner", async ({ page }) => {
    await page.goto("/schedule");
    const banner = page.getByRole("region", { name: "Unassigned work" });
    await page.getByRole("button", { name: "Assign technician to Elena Rodriguez" }).click();

    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await expect(dialog).toContainText("AC Repair & Diagnostics for Elena Rodriguez");
    await dialog.getByRole("radio", { name: /^Samira Patel/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();

    await expect(banner).toContainText("Unassigned · 1");
    await expect(banner).not.toContainText("Elena Rodriguez");
    await expect(page.locator("#event-JB-198")).toContainText("Samira");
  });

  test("creating a job swaps the event id but keeps the selection (booking → job)", async ({ page }) => {
    await page.goto("/schedule?view=week&date=2024-10-28&event=BK-1041");
    await expect(details(page)).toContainText("Booking #BK-1041");
    await details(page).getByRole("button", { name: "Create job" }).click();
    await expect(details(page).getByRole("link", { name: /View job #JB-205/ })).toBeVisible();
    await expect(page.locator("#event-JB-205")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("deterministic dates", () => {
  for (const timezoneId of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata", "America/Chicago"]) {
    test(`renders the same days and times when the browser timezone is ${timezoneId}`, async ({ browser, baseURL, storageState }) => {
      const context = await browser.newContext({ baseURL, timezoneId, storageState, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      try {
        await page.goto("/schedule");
        await expect(heading(page)).toContainText("Oct 21");
        await expect(weekColumn(page, "Fri, Oct 25")).toContainText("Today");
        await expect(weekColumn(page, "Fri, Oct 25").locator("#event-JB-204")).toContainText("10:00 AM – 12:00 PM");
        await expect(weekColumn(page, "Sun, Oct 27")).toContainText("Closed");

        await page.goto("/schedule?view=day");
        await expect(heading(page)).toHaveText("Today, Friday, October 25, 2024");

        await page.goto("/bookings?tab=past");
        const sarahRow = page.getByRole("table", { name: "Past bookings" }).locator("tbody tr").filter({ hasText: "Sarah Mitchell" });
        await expect(sarahRow).toContainText("Fri, Oct 25");
        await expect(sarahRow).toContainText("10:00 AM – 12:00 PM");
      } finally {
        await context.close();
      }
    });
  }
});
