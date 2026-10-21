/**
 * Phase 7, Part 0. The baseline Job #JB-204 (Sarah Mitchell, AC Repair & Diagnostics, 1402 Kinney Ave) is Completed.
 * The Phase 3 fixture had it In progress, which contradicted Sarah's last service, her approved quote and paid invoice
 * and the Reviews module. The one operational fixture was corrected; nothing special-cases it elsewhere, so every
 * module below simply reads the same record.
 */
import type { Page } from "playwright/test";
import { PROTOTYPE_NOW } from "../src/lib/prototype-clock";
import { getBookingById, getJobById } from "../src/data/operations";
import { BOOKINGS, JOBS, OPERATIONS, OVERVIEW_TOTALS } from "./apex-data";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const jobRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} jobs` }).locator("tbody tr");
const bookingRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} bookings` }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });

test.describe("JB-204 is Completed in the one operational fixture", () => {
  test("the Job and its Booking are Completed, with a completion record, and nothing in the fixture is in progress", () => {
    const job = getJobById("JB-204", OPERATIONS)!;
    expect(job.status).toBe("completed");
    expect(job.completion?.at).toBe(PROTOTYPE_NOW);
    expect(job.completion?.notes.length).toBeGreaterThan(20);
    expect(job.bookingId).toBe("BK-1042");
    expect(getBookingById("BK-1042", OPERATIONS)).toMatchObject({ status: "completed", jobId: "JB-204", customerId: "sarah-mitchell" });
    expect(JOBS.filter((item) => item.status === "in-progress")).toEqual([]);
  });

  test("the global Completed Jobs aggregate stays 18: fixtures are a sample of it, not the number", () => {
    expect(OVERVIEW_TOTALS.completedJobs).toBe(18);
    expect(JOBS.filter((item) => item.status === "completed").length).toBe(7);
    expect(BOOKINGS.filter((item) => item.status === "completed").length).toBe(6);
  });
});

test.describe("every module shows JB-204 as completed work", () => {
  test("Jobs: it is in Completed and no longer in Active, with the same details as before", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByRole("tablist").getByRole("tab")).toHaveText([/^Active\s*4$/, /^Upcoming\s*2$/, /^Completed\s*7$/]);
    await expect(jobRows(page, "Active").filter({ hasText: "JB-204" })).toHaveCount(0);
    await tab(page, "Completed").click();
    const row = jobRows(page, "Completed").filter({ hasText: "JB-204" });
    await expect(row).toContainText("Completed");
    await expect(row).toContainText("Sarah Mitchell");
    await expect(row).toContainText("AC Repair & Diagnostics");
    await expect(row).toContainText("1402 Kinney Ave");
    await expect(row).not.toContainText("In progress");
  });

  test("Job detail: Completed, with the completion time, and nothing left to start, complete or reassign", async ({ page }) => {
    await page.goto("/jobs/JB-204");
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
    await expect(page.getByText("In progress")).toHaveCount(0);
    for (const action of ["Start job", "Complete job", "Reassign"]) await expect(page.getByRole("button", { name: action })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Linked from Booking #BK-1042" })).toHaveAttribute("href", "/bookings?tab=past&booking=BK-1042");
  });

  test("Customers: Sarah has no service in progress, and JB-204 is in her visit history as Completed", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    await expect(page.getByRole("heading", { name: "Current service" })).toHaveCount(0);
    const visit = page.locator("li").filter({ hasText: "Job #JB-204" });
    await expect(visit).toContainText("Completed");
    await expect(visit).toContainText("AC Repair & Diagnostics");
  });

  test("Bookings: BK-1042 is under Past, Completed, and no longer under Upcoming", async ({ page }) => {
    await page.goto("/bookings?tab=upcoming");
    // Sarah's only upcoming booking is her scheduled maintenance visit (BK-1048); BK-1042 is not there.
    await expect(bookingRows(page, "Upcoming").filter({ hasText: "Sarah Mitchell" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Review booking BK-1048/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Review booking BK-1042/ })).toHaveCount(0);
    await page.goto("/bookings?tab=past&booking=BK-1042");
    await expect(bookingRows(page, "Past").filter({ hasText: "Sarah Mitchell" })).toContainText("Completed");
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Completed");
  });

  test("Schedule: the Friday event is Completed, not in progress and not unassigned or upcoming work", async ({ page }) => {
    await page.goto("/schedule");
    const event = page.locator("#event-JB-204");
    await expect(event).toContainText("Completed");
    await expect(event).toContainText("10:00 AM – 12:00 PM");
    await expect(event).not.toContainText("In progress");
    await expect(page.getByRole("region", { name: "Unassigned work" })).not.toContainText("Sarah Mitchell");
  });

  test("Reviews: Sarah's review still links to JB-204", async ({ page }) => {
    await page.goto("/reviews/rev-sarah-mitchell");
    await expect(page.getByRole("link", { name: /#JB-204 · AC Repair & Diagnostics/ })).toHaveAttribute("href", "/jobs/JB-204");
  });

  test("Request Review offers JB-204 at once, already selected, with no 'complete the job first' message", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    const jobs = dialog.getByLabel("Related job (optional)");
    await expect(jobs).toHaveValue("JB-204");
    await expect(jobs.locator("option")).toHaveText([
      /^No related job$/,
      /^#JB-204 · AC Repair & Diagnostics · Completed Oct 25, 2024$/,
      /^#JB-142 · .* · Completed May 14, 2024$/,
    ]);
    await expect(dialog).not.toContainText(/isn.t available yet|complete the job first|in progress/i);
  });
});

test.describe("the Completed Jobs aggregate is the approved 18 plus what has happened since", () => {
  test("Overview and Analytics say 18, and the sidebar carries no count beside Jobs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("18");
    await expect(primaryNav(page).getByRole("link", { name: /^Jobs/ })).not.toContainText(/\d/);
    await page.goto("/analytics");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("18");
  });

  test("completing another job moves the aggregate by exactly one (18 → 19), and the list counts follow the records", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Heat pump repaired.");
    await dialog.getByRole("button", { name: "Complete job" }).click();

    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText(/Completed Jobs\s*19/);
    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await expect(tab(page, "Completed")).toContainText("8");
  });
});
