import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const jobRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} jobs` }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const jobTabs = (page: Page, id: string) => page.getByRole("navigation", { name: `Job ${id} sections` });
const main = (page: Page) => page.locator("main");

/**
 * Starts JB-201 (David Chen's heat pump job, the next scheduled job) and opens its Complete Job dialog.
 * JB-204 is already completed in the baseline, so it cannot be used for the start and complete flow.
 */
async function openCompleteDialog(page: Page) {
  await page.goto("/jobs/JB-201");
  await page.getByRole("button", { name: "Start job" }).click();
  await page.getByRole("button", { name: "Complete job" }).click();
  return page.getByRole("dialog", { name: "Complete job #JB-201" });
}

test.describe("Jobs list", () => {
  test("renders the approved header, Active tab with derived counts and the Jobs sidebar state", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
    await expect(page.getByText("The work for your bookings, from assigning a technician to completing the visit.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Jobs/ })).toHaveAttribute("aria-current", "page");
    // Jobs carry no count beside the link: the month's completed jobs are on the Overview.
    await expect(primaryNav(page).getByRole("link", { name: /^Jobs/ })).not.toContainText(/\d/);

    await expect(page.getByRole("tablist", { name: "Job lists" }).getByRole("tab")).toHaveText([/^Active\s*4$/, /^Upcoming\s*2$/, /^Completed\s*7$/]);
    await expect(tab(page, "Active")).toHaveAttribute("aria-selected", "true");

    await expect(page.getByRole("table", { name: "Active jobs" }).getByRole("columnheader")).toHaveText([
      "Job",
      "Customer",
      "Service",
      "Scheduled window",
      "Technician",
      "Status",
      "Property",
      "Action",
    ]);
    await expect(jobRows(page, "Active")).toHaveCount(4);
  });

  test("JB-204 is Sarah Mitchell's AC Repair & Diagnostics job at 1402 Kinney Ave, and it is Completed", async ({ page }) => {
    await page.goto("/jobs");
    // It is finished work, so it is not among the active jobs.
    await expect(jobRows(page, "Active").filter({ hasText: "JB-204" })).toHaveCount(0);
    await tab(page, "Completed").click();
    const row = jobRows(page, "Completed").filter({ hasText: "JB-204" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("#BK-1042");
    await expect(row).toContainText("Sarah Mitchell");
    await expect(row).toContainText("(512) 555-0194");
    await expect(row).toContainText("AC Repair & Diagnostics");
    await expect(row).toContainText("Today, Fri, Oct 25");
    await expect(row).toContainText("10:00 AM – 12:00 PM");
    await expect(row).toContainText("Alex Morgan");
    await expect(row).toContainText("Completed");
    await expect(row).not.toContainText("In progress");
    await expect(row).toContainText("1402 Kinney Ave");
    await expect(page.getByText("Rostova")).toHaveCount(0);
  });

  test("tabs split active, upcoming and completed work with the shared status badges", async ({ page }) => {
    await page.goto("/jobs");
    await tab(page, "Upcoming").click();
    await expect(jobRows(page, "Upcoming")).toHaveCount(2);
    for (const row of await jobRows(page, "Upcoming").all()) await expect(row).toContainText("Scheduled");

    await tab(page, "Completed").click();
    await expect(page).toHaveURL(/\/jobs\?tab=completed$/);
    await expect(jobRows(page, "Completed")).toHaveCount(7);
    for (const row of await jobRows(page, "Completed").all()) await expect(row).toContainText("Completed");

    await page.goto("/jobs?tab=upcoming");
    await expect(tab(page, "Upcoming")).toHaveAttribute("aria-selected", "true");
  });

  test("search and filters narrow the list; unassigned work can be assigned from it", async ({ page }) => {
    await page.goto("/jobs");
    await page.getByLabel("Search jobs").fill("elena");
    await expect(jobRows(page, "Active")).toHaveCount(1);
    await expect(jobRows(page, "Active").first()).toContainText("Elena Rodriguez");

    await page.getByLabel("Search jobs").fill("zzz-no-match");
    await expect(page.getByText("No jobs match your search.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(jobRows(page, "Active")).toHaveCount(4);

    await page.getByLabel("Technician", { exact: true }).selectOption("marcus-vance");
    await expect(jobRows(page, "Active")).toHaveCount(1);
    await expect(jobRows(page, "Active").first()).toContainText("David Chen");
    await page.getByRole("button", { name: "Clear filters" }).click();

    // Nothing is in progress at the baseline: JB-204 is completed.
    await page.getByLabel("Status", { exact: true }).selectOption("in-progress");
    await expect(page.getByText("No jobs match your search.")).toBeVisible();
    await page.getByLabel("Status", { exact: true }).selectOption("scheduled");
    await expect(jobRows(page, "Active")).toHaveCount(4);
    await page.getByRole("button", { name: "Clear filters" }).click();

    await page.getByRole("button", { name: "Assign technician to job JB-198" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Marcus Vance/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(jobRows(page, "Active").filter({ hasText: "JB-198" })).toContainText("Marcus Vance");
    await expect(page.getByRole("button", { name: "Assign technician to job JB-198" })).toHaveCount(0);
  });

  test("shows the approved empty state when there are no jobs", async ({ page }) => {
    await page.goto("/jobs?state=empty");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
    await expect(page.getByText("No jobs yet")).toBeVisible();
    await expect(page.getByText("A job is the work you do for a confirmed booking. Open a booking and choose Create job, start it when the technician arrives, and complete it when the work is done.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.getByRole("link", { name: "View bookings" }).click();
    await expect(page).toHaveURL("/bookings");
    await expect(page.getByRole("heading", { level: 1, name: "Bookings" })).toBeVisible();
  });

  test("job numbers and customers link to the job and the customer", async ({ page }) => {
    await page.goto("/jobs?tab=completed");
    const row = jobRows(page, "Completed").filter({ hasText: "JB-204" });
    await expect(row.getByRole("link", { name: "Sarah Mitchell" })).toHaveAttribute("href", "/customers/sarah-mitchell");
    await row.getByRole("link", { name: "#JB-204" }).click();
    await expect(page).toHaveURL("/jobs/JB-204");
    await expect(page.getByRole("heading", { level: 1, name: "Job #JB-204" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Jobs/ })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Job detail", () => {
  test("Overview shows the job header, facts, linked booking and approved sections", async ({ page }) => {
    await page.goto("/jobs/JB-204");
    await expect(page.getByRole("heading", { level: 1, name: "Job #JB-204" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Jobs" })).toHaveAttribute("href", "/jobs");
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
    await expect(page.getByText("In progress")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Linked from Booking #BK-1042" })).toHaveAttribute("href", "/bookings?tab=past&booking=BK-1042");

    const facts = main(page).locator("dl").first();
    await expect(facts).toContainText("Sarah Mitchell");
    await expect(facts).toContainText("AC Repair & Diagnostics");
    await expect(facts).toContainText("Today, Fri, Oct 25");
    await expect(facts).toContainText("Alex Morgan");
    await expect(facts).toContainText("1402 Kinney Ave");

    for (const title of ["Property & access details", "HVAC equipment file", "Work summary", "Customer information", "Booking origin", "Safety & protocol notes"]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(page.getByText("Gate code #4412")).toBeVisible();
    await expect(page.getByText("Main Central Heat Pump & AC")).toBeVisible();
    await expect(page.getByText("Diagnostics checklist: 8 of 8 passed")).toBeVisible();
    // Finished work: nothing left to start or complete.
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
  });

  test("the three tabs are real, accessible routes and the shell never remounts", async ({ page }) => {
    await page.goto("/jobs/JB-204");
    await page.evaluate(() => {
      (document.querySelector("header") as unknown as { __tag: string }).__tag = "mounted-once";
    });

    const tabs = jobTabs(page, "JB-204");
    await expect(tabs.getByRole("link")).toHaveText(["Overview", /^Work details$/, /^Photos & files\s*4$/]);
    await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    await tabs.getByRole("link", { name: "Work details" }).click();
    await expect(page).toHaveURL("/jobs/JB-204/work-details");
    await expect(tabs.getByRole("link", { name: "Work details" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Technician field diagnosis")).toContainText("Dual capacitor failure");
    await expect(page.getByRole("heading", { name: "Diagnostics checklist" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Jobs/ })).toHaveAttribute("aria-current", "page");

    await tabs.getByRole("link", { name: /Photos & files/ }).click();
    await expect(page).toHaveURL("/jobs/JB-204/files");
    await expect(tabs.getByRole("link", { name: /Photos & files/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(4);

    await tabs.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL("/jobs/JB-204");

    expect(await page.evaluate(() => (document.querySelector("header") as unknown as { __tag?: string }).__tag)).toBe("mounted-once");
  });

  test("each tab route can be opened directly", async ({ page }) => {
    await page.goto("/jobs/JB-204/work-details");
    await expect(page.getByRole("textbox", { name: "Work performed" })).toContainText("Isolated high-voltage disconnect switch");
    await page.goto("/jobs/JB-204/files");
    await expect(page.getByRole("heading", { name: "Photos & attachments" })).toBeVisible();
  });

  test("Work details edits show an unsaved-changes bar that can be saved or discarded, across tabs", async ({ page }) => {
    // JB-204 is completed and so read-only; JB-201 is still open.
    await page.goto("/jobs/JB-201/work-details");
    const notes = page.getByLabel("Internal office & tech notes");
    const original = await notes.inputValue();
    await notes.fill(`${original} Follow up on contactor in spring.`);

    const bar = page.getByRole("region", { name: "Unsaved changes" });
    await expect(bar).toBeVisible();

    // The draft survives switching tabs.
    await jobTabs(page, "JB-201").getByRole("link", { name: "Overview" }).click();
    await expect(bar).toBeVisible();
    await jobTabs(page, "JB-201").getByRole("link", { name: "Work details" }).click();
    await expect(page.getByLabel("Internal office & tech notes")).toHaveValue(`${original} Follow up on contactor in spring.`);

    await bar.getByRole("button", { name: "Discard changes" }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByLabel("Internal office & tech notes")).toHaveValue(original);

    await page.getByLabel("Internal office & tech notes").fill("Saved note.");
    await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    await expect(page.getByLabel("Internal office & tech notes")).toHaveValue("Saved note.");
  });

  test("Photos & files lists a completed job's four photos by category, read-only", async ({ page }) => {
    await page.goto("/jobs/JB-204/files");
    await expect(page.getByText("3 customer visible")).toBeVisible();
    await expect(page.getByText("1 internal")).toBeVisible();

    await page.getByRole("button", { name: /^Equipment serial/ }).click();
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(4);
    // A completed job keeps its record: nothing can be added or changed.
    await expect(page.getByRole("button", { name: /Upload photos or documents/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make internal only: IMG_4820.jpg" })).toHaveCount(0);
  });

  test("Photos & files on an open job accepts a local upload and toggles customer visibility", async ({ page }) => {
    await page.goto("/jobs/JB-201/files");
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(0);

    await page.getByLabel("Choose photos or documents to upload").setInputFiles({
      name: "condenser-after.png",
      mimeType: "image/png",
      buffer: Buffer.from("not-a-real-image"),
    });
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("condenser-after.png")).toBeVisible();
    await expect(page.getByText("1 file added to job #JB-201.")).toBeVisible();
    await expect(jobTabs(page, "JB-201").getByRole("link", { name: /Photos & files/ })).toContainText("1");
    // New files start internal.
    await page.getByRole("button", { name: "Show to customer: condenser-after.png" }).click();
    await expect(page.getByText("1 customer visible")).toBeVisible();
    await expect(page.getByRole("button", { name: "Make internal only: condenser-after.png" })).toBeVisible();

    // Unsupported types are refused with an explanation.
    await page.getByLabel("Choose photos or documents to upload").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByText("Only JPG, PNG and PDF files up to 25 MB can be added.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(1);

    // The demo upload is local: a reload returns to the fixture.
    await page.reload();
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(0);
  });

  test("the files screen has no developer or prototype wording", async ({ page }) => {
    await page.goto("/jobs/JB-204/files");
    const text = (await main(page).innerText()).toLowerCase();
    for (const term of ["prototype", "demo only", "mock", "placeholder", "not saved", "lorem"]) expect(text).not.toContain(term);
  });

  test("an unknown job shows a not-found state inside the shell", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    await page.goto("/jobs/JB-999");
    await expect(page.getByText("Job not found")).toBeVisible();
    await expect(primaryNav(page)).toBeVisible();
  });
});

test.describe("Start and complete a job", () => {
  test("a scheduled job can be started, then completed", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await expect(page.getByText("Scheduled").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);

    await page.getByRole("button", { name: "Start job" }).click();
    await expect(page.getByText("In progress").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Complete job" })).toBeVisible();
  });

  test("Complete Job opens a labelled dialog, Cancel keeps the job in progress", async ({ page }) => {
    const dialog = await openCompleteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("David Chen");
    await expect(dialog).toContainText("Heat Pump Diagnostics & Repair");
    await expect(dialog).toContainText("Technician: Marcus Vance");
    await expect(dialog).toContainText("Customer-visible photos (0)");
    await expect(dialog.getByLabel("Technician debrief & resolution notes")).toHaveValue("");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Complete job" })).toBeFocused(); // focus returns to the trigger
    await expect(page.getByText("In progress").first()).toBeVisible();
    await expect(page).toHaveURL("/jobs/JB-201");
  });

  test("Escape closes the dialog without completing", async ({ page }) => {
    const dialog = await openCompleteDialog(page);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Complete job" })).toBeVisible();
  });

  test("resolution notes are required", async ({ page }) => {
    const dialog = await openCompleteDialog(page);
    await dialog.getByLabel("Technician debrief & resolution notes").fill("   ");
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(dialog.getByText("Enter the resolution notes.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Completed Oct")).toHaveCount(0);
  });

  test("completing the job updates the job, booking, schedule, list and customer consistently", async ({ page }) => {
    const dialog = await openCompleteDialog(page);
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Replaced the reversing valve; system heating normally.");
    await dialog.getByRole("button", { name: "Complete job" }).click();

    // Job: completed, read-only, no further actions.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reassign" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
    await expect(page.getByText("Job #JB-201 completed.")).toBeVisible();

    // Nothing financial is created by completing a job.
    await expect(main(page).getByText(/invoice|quote|payment/i)).toHaveCount(0);

    // Linked booking moved to Past (client navigation keeps the session's data).
    await page.getByRole("link", { name: "Linked from Booking #BK-1039" }).click();
    await expect(page).toHaveURL(/\/bookings\?tab=past&booking=BK-1039$/);
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Completed");
    await expect(tab(page, "Past")).toContainText("7");
    await expect(tab(page, "Upcoming")).toContainText("5");

    // Schedule shows the work as completed.
    await primaryNav(page).getByRole("link", { name: "Schedule" }).click();
    await expect(page.locator("#event-JB-201")).toContainText("Completed");

    // Jobs list: no longer active, now completed.
    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await expect(tab(page, "Active")).toContainText("3");
    await expect(tab(page, "Completed")).toContainText("8");
    await expect(jobRows(page, "Active").filter({ hasText: "JB-201" })).toHaveCount(0);
    await tab(page, "Completed").click();
    await expect(jobRows(page, "Completed").filter({ hasText: "JB-201" })).toContainText("Completed");

    // Customer record reads the same job.
    await primaryNav(page).getByRole("link", { name: "Customers" }).click();
    await page.getByRole("link", { name: "David Chen" }).first().click();
    await expect(page.getByRole("heading", { name: "Current service" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
    const visits = page.locator("li").filter({ hasText: "Job #JB-201" });
    await expect(visits).toContainText("Completed");

    // It was stored: after a reload the job is still completed, with nothing left to start.
    await page.goto("/jobs/JB-201");
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
  });

  test("unsaved Work details edits are kept when the job is completed", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await jobTabs(page, "JB-201").getByRole("link", { name: "Work details" }).click();
    await page.getByLabel("Internal office & tech notes").fill("Check the contactor next visit.");
    await page.getByRole("button", { name: "Complete job" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Finished.");
    await dialog.getByRole("button", { name: "Complete job" }).click();

    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    await expect(page.getByLabel("Internal office & tech notes")).toHaveValue("Check the contactor next visit.");
    await expect(page.getByLabel("Internal office & tech notes")).toHaveAttribute("readonly", "");
  });

  test("completed jobs are read-only and keep their approved details", async ({ page }) => {
    await page.goto("/jobs/JB-186");
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reassign" })).toHaveCount(0);
    await page.goto("/jobs/JB-186/files");
    await expect(page.getByRole("heading", { name: "No photos or files yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Upload photos or documents/ })).toHaveCount(0);
  });

  test("reassigning a job updates the Schedule and the booking", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Reassign" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Alex Morgan/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(main(page).locator("dl").first()).toContainText("Alex Morgan");

    await primaryNav(page).getByRole("link", { name: "Schedule" }).click();
    await expect(page.locator("#event-JB-201")).toContainText("Alex");
    await page.locator("#event-JB-201").click();
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Alex Morgan");
  });

  test("a completed job cannot be reassigned, started or completed again", async ({ page }) => {
    await page.goto("/jobs/JB-204");
    for (const action of ["Reassign", "Start job", "Complete job"]) await expect(page.getByRole("button", { name: action })).toHaveCount(0);
  });
});
