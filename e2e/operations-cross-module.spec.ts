/**
 * Phase 11: the modules that read operations agree with the stored records, and the active business's operations come and go
 * with the workspace: Customers, global search, Reviews, Maintenance Plans, switching workspace, logging out, Back.
 */
import type { Page } from "playwright/test";
import { REVIEWS } from "./apex-data";
import { signInOverHttp } from "./fixtures";
import { expect, switchWorkspace, test, waitsForHydration } from "./saas";

const bookingRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} bookings` }).locator("tbody tr");
const box = (page: Page) => page.getByRole("combobox", { name: "Search customers, jobs, bookings and schedule" });
const results = (page: Page) => page.getByRole("listbox", { name: "Search results" });
const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

async function createBooking(page: Page) {
  await page.goto("/bookings?new=1");
  const wizard = page.getByRole("dialog", { name: "Create booking" });
  await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
  await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
  await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
  await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
  await wizard.getByRole("radio", { name: /^Midday/ }).check();
  await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  await wizard.getByRole("button", { name: "Create booking" }).click();
  const success = page.getByRole("dialog", { name: "Booking created" });
  await expect(success).toBeVisible();
  return success;
}

test.describe("Customers read the stored bookings and jobs", () => {
  test("Sarah's page shows JB-204 in her visit history and her booking, from the database", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    const visit = page.locator("li").filter({ hasText: "Job #JB-204" });
    await expect(visit).toContainText("Completed");
    await expect(visit).toContainText("AC Repair & Diagnostics");
    await expect(page.getByRole("heading", { name: "Current service" })).toHaveCount(0);
  });

  test("a Northstar customer shows Northstar's own work, and Apex customers do not exist there", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/customers/marta-olsen");
    await expect(page.locator("main")).toContainText("Marta Olsen");
    await expect(page.getByText("JB-1001").first()).toBeVisible();
    await expect(page.getByText("JB-204")).toHaveCount(0);
    const gone = await page.goto("/customers/sarah-mitchell");
    expect(gone?.status()).toBe(404);
  });

  test("a job completed now is in the customer's visit history, and still is after a reload", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Replaced the capacitor.");
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByText("Job #JB-201 completed.")).toBeVisible();
    await page.goto("/customers/david-chen");
    const visit = page.locator("li").filter({ hasText: "Job #JB-201" });
    await expect(visit).toContainText("Completed");
    await page.reload();
    await expect(page.locator("li").filter({ hasText: "Job #JB-201" })).toContainText("Completed");
    await expect(page.getByRole("heading", { name: "Current service" })).toHaveCount(0);
  });
});

test.describe("global search reads the active business's stored records", () => {
  test("Apex finds Sarah, JB-204 and BK-1042", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("sarah");
    await expect(results(page).getByRole("option", { name: /#JB-204 · Sarah Mitchell/ })).toBeVisible();
    await expect(results(page).getByRole("option", { name: /#BK-1042 · Sarah Mitchell/ })).toBeVisible();
  });

  test("Northstar never finds Apex's customer, job or booking, whatever is typed", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/");
    for (const query of ["sarah", "mitchell", "JB-204", "BK-1042", "kinney", "claire", "512 555 0194"]) {
      await box(page).fill(query);
      await expect(page.locator("[role=search]").getByRole("status")).toHaveText(`No matches for “${query}”.`);
    }
    await box(page).fill("marta");
    await expect(results(page).getByRole("group", { name: "Customers" })).toContainText("Marta Olsen");
    await expect(results(page).getByRole("group", { name: "Jobs" })).toContainText("#JB-1001 · Marta Olsen");
    await expect(results(page).getByRole("group", { name: "Bookings" })).toContainText("#BK-1001 · Marta Olsen");
  });

  test("a booking just created is found, and is found again after a reload", async ({ page }) => {
    await createBooking(page);
    await page.goto("/");
    await box(page).fill("BK-1043");
    await expect(results(page).getByRole("option", { name: /#BK-1043 · Sarah Mitchell/ })).toBeVisible();
  });
});

test.describe("Reviews read the stored job", () => {
  test("Sarah's review links to JB-204, which opens as the stored completed job", async ({ page }) => {
    const review = REVIEWS.find((item) => item.relatedJobId === "JB-204")!;
    await page.goto(`/reviews/${review.id}`);
    const chip = page.getByRole("link", { name: /^#JB-204 · AC Repair & Diagnostics/ });
    await expect(chip).toHaveAttribute("href", "/jobs/JB-204");
    await chip.click();
    await expect(page).toHaveURL(/\/jobs\/JB-204$/);
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
  });

  test("Request review offers JB-204 among Sarah's completed jobs", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await expect(dialog.getByLabel("Related job (optional)").locator("option")).toHaveText([/^No related job$/, /^#JB-204 · AC Repair & Diagnostics · Completed Oct 25, 2024$/, /^#JB-142 · .* · Completed May 14, 2024$/]);
  });

  test("a job completed now becomes available to a review request without a reload", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Replaced the capacitor.");
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByText("Job #JB-201 completed.")).toBeVisible();
    await primaryNav(page).getByRole("link", { name: /^Reviews/ }).click();
    await page.getByRole("button", { name: "Request review" }).click();
    const request = page.getByRole("dialog", { name: "Request a review" });
    await request.getByLabel("Customer").selectOption("david-chen");
    await expect(request.getByLabel("Related job (optional)").locator("option").filter({ hasText: "#JB-201" })).toHaveCount(1);
  });
});

test.describe("Maintenance Plans: the visit is a real booking", () => {
  async function scheduleVisit2(page: Page) {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = page.getByRole("dialog", { name: "Schedule included visit" });
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByLabel("Service date").fill("2024-11-19");
    await wizard.getByRole("radio", { name: /^Midday/ }).check();
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
    await wizard.getByRole("radio", { name: /^Marcus Vance/ }).check();
    await wizard.getByRole("button", { name: /^Next: Review/ }).click();
    await wizard.getByRole("button", { name: "Create booking" }).click();
    return page.getByRole("dialog", { name: "Maintenance visit scheduled" });
  }

  test("scheduling visit 2 stores BK-1048 for Sarah on Nov 19, 10:00 AM – 12:00 PM with Marcus Vance, and no job", async ({ page, db, workerTenant }) => {
    const done = await scheduleVisit2(page);
    await expect(done).toContainText("Booking #BK-1048 confirmed");

    const stored = await db.query(
      `select b.number, b.status, b.source, b.service_date::text as date, b.start_time::text as start, b.end_time::text as stop,
              c.name as customer, m.name as technician, p.slug as plan_id, v.ref as plan_visit_id, v.status as visit_status,
              (select count(*)::int from jobs j where j.booking_id = b.id) as jobs
         from bookings b join customers c on c.id = b.customer_id join team_members m on m.id = b.assignee_id
         join maintenance_plan_visits v on v.booking_id = b.id join maintenance_plans p on p.id = v.plan_id
        where b.organization_id = $1 and b.number = 1048`,
      [workerTenant.organizationId],
    );
    expect(stored.rows).toEqual([
      {
        number: 1048,
        status: "confirmed",
        source: "Maintenance plan",
        date: "2024-11-19",
        start: "10:00:00",
        stop: "12:00:00",
        customer: "Sarah Mitchell",
        technician: "Marcus Vance",
        plan_id: "plan-sarah-comfort-care",
        plan_visit_id: "plan-sarah-comfort-care-v2",
        visit_status: "scheduled",
        jobs: 0,
      },
    ]);
    expect((await db.query("select count(*)::int as n from jobs where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(11);
  });

  test("the plan reads the visit's state from the stored booking: Scheduled after a reload, and open again once the booking is cancelled", async ({ page }) => {
    const done = await scheduleVisit2(page);
    await done.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByRole("button", { name: "Schedule visit" })).toHaveCount(0);
    await expect(page.locator("main")).toContainText("Scheduled");

    await page.goto("/bookings?tab=upcoming&booking=BK-1048");
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("Comfort Care");
    await drawer.getByRole("button", { name: "Cancel booking" }).click();
    const cancel = page.getByRole("dialog", { name: "Cancel this booking?" });
    await cancel.getByLabel("Reason").fill("Customer asked to rebook.");
    await cancel.getByRole("button", { name: "Cancel booking" }).click();
    await expect(cancel).toBeHidden();

    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByRole("button", { name: "Schedule visit" }).first()).toBeVisible();
  });

  test("BK-1048 is held for the visit: other bookings walk past it, and the visit takes it whenever it is scheduled", async ({ page, db, workerTenant }) => {
    // Move the booking counter up to the held number, so the next ordinary booking would be BK-1048.
    await db.query("update organization_sequences set next_value = 1048 where organization_id = $1 and kind = 'booking'", [workerTenant.organizationId]);
    const success = await createBooking(page);
    await expect(success).toContainText("#BK-1049");
    await success.getByRole("button", { name: "Close" }).first().click();
    const visit = await scheduleVisit2(page);
    await expect(visit).toContainText("Booking #BK-1048 confirmed");
  });

  test("scheduling a visit creates no quote, invoice or payment", async ({ page }) => {
    const done = await scheduleVisit2(page);
    await done.getByRole("button", { name: "Close", exact: true }).click();
    await primaryNav(page).getByRole("link", { name: /^Payments/ }).click();
    await expect(page.getByRole("main")).toContainText("$2,130");
    await expect(page.getByRole("main")).not.toContainText("Comfort Care");
  });
});

test.describe("operations follow the workspace and the session", () => {
  test("a booking survives moving through the other modules and a reload", async ({ page }) => {
    const success = await createBooking(page);
    await success.getByRole("button", { name: "View booking" }).click();
    await primaryNav(page).getByRole("link", { name: /^Schedule/ }).click();
    await expect(page.locator("#event-BK-1043")).toBeVisible();
    await primaryNav(page).getByRole("link", { name: /^Jobs/ }).click();
    await primaryNav(page).getByRole("link", { name: /^Bookings/ }).click();
    await page.getByRole("tab", { name: /^Upcoming/ }).click();
    await expect(bookingRows(page, "Upcoming")).toHaveCount(6);
    await page.reload();
    await expect(bookingRows(page, "Upcoming")).toHaveCount(6);
  });

  test("switching workspace replaces every booking, job and event with the other business's", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/bookings?tab=past");
    await expect(page.getByText("Sarah Mitchell").first()).toBeVisible();
    await switchWorkspace(page, /Northstar/);
    await page.goto("/bookings");
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    await expect(page.getByText("Dev Kapoor").first()).toBeVisible();
    await page.goto("/jobs");
    await expect(page.getByText("JB-1001").first()).toBeVisible();
    await expect(page.getByText("JB-204")).toHaveCount(0);
    await switchWorkspace(page, /Apex/);
    await page.goto("/jobs?tab=completed");
    await expect(page.getByText("JB-204").first()).toBeVisible();
    await expect(page.getByText("JB-1001")).toHaveCount(0);
  });

  test("going Back after switching workspace never shows the other business's bookings", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/bookings?tab=past");
    await expect(page.getByText("Sarah Mitchell").first()).toBeVisible();
    await switchWorkspace(page, /Northstar/);
    await page.goBack();
    await expect(page).toHaveURL(/\/bookings/);
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
  });

  test("after Log out no booking is reachable, and Back does not bring any back", async ({ browser, workerTenant, clientAddresses }) => {
    const storageState = await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses());
    const context = await browser.newContext({ storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    await page.goto("/bookings?tab=past&booking=BK-1042");
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Sarah Mitchell");
    await page.getByRole("button", { name: /Alex Morgan/ }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    for (const path of ["/bookings", "/jobs/JB-204", "/schedule"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    }
    await context.close();
  });
});
