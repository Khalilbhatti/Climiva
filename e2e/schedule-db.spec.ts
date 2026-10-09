/**
 * Phase 11: the Schedule is real, and derived. It has no events of its own: it is Bookings and Jobs (and the business's
 * blocked time) laid out by day, so an assignment made on the Schedule is the same stored change as one made on a Booking
 * or a Job. Dates and times are the business's own wall-clock values and read the same in every browser time zone.
 */
import type { Page } from "playwright/test";
import { addDays, startOfWeek, weekDates } from "../src/lib/dates";
import { signInOverHttp } from "./fixtures";
import { expect, test, waitsForHydration } from "./saas";

const heading = (page: Page) => page.locator("main h2[aria-live=polite]");
const weekColumn = (page: Page, label: string) => page.getByRole("list", { name: "Week schedule" }).getByRole("listitem", { name: label });
const drawer = (page: Page) => page.getByRole("complementary", { name: "Booking details" });

test.describe("the Schedule is derived from the stored records", () => {
  test("each day's item count is exactly the stored jobs, un-jobbed bookings and blocks on that day", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const week = weekDates("2024-10-25");
    const stored = await db.query<{ day: string; items: number }>(
      `select d::text as day,
              (select count(*)::int from jobs j where j.organization_id = $1 and j.service_date = d)
            + (select count(*)::int from bookings b where b.organization_id = $1 and b.service_date = d and b.status in ('confirmed', 'completed')
                 and not exists (select 1 from jobs j where j.booking_id = b.id))
            + (select count(*)::int from schedule_blocks s where s.organization_id = $1 and s.service_date = d) as items
         from unnest($2::date[]) as d order by d`,
      [org, week],
    );
    expect(stored.rows.map((row) => row.day)).toEqual(week);
    await page.goto("/schedule");
    for (const row of stored.rows) {
      const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${row.day}T00:00:00Z`));
      const column = weekColumn(page, label);
      if (row.items === 0) await expect(column).toContainText(/Closed|0 items/);
      else await expect(column).toContainText(`${row.items} ${row.items === 1 ? "item" : "items"}`);
    }
  });

  test("a change made straight to the stored records shows on the Schedule: there is no second copy to disagree", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await page.goto("/schedule");
    await expect(page.getByRole("region", { name: "Unassigned work" })).toContainText("Elena Rodriguez");
    await db.query(
      `update jobs set assignee_id = (select id from team_members where organization_id = $1 and slug = 'samira-patel') where organization_id = $1 and number = 198`,
      [org],
    );
    await db.query(
      `update bookings set assignee_id = (select id from team_members where organization_id = $1 and slug = 'samira-patel') where organization_id = $1 and number = 1035`,
      [org],
    );
    await page.reload();
    await expect(page.locator("#event-JB-198")).toContainText("Samira");
    await expect(page.getByRole("region", { name: "Unassigned work" })).not.toContainText("Elena Rodriguez");
  });

  test("Day view shows the same events with the same times, and technician and service filters narrow them", async ({ page }) => {
    await page.goto("/schedule?view=day&date=2024-10-25");
    await expect(heading(page)).toContainText("Today, Friday, October 25, 2024");
    await expect(page.locator("#event-JB-204")).toContainText("10:00 AM – 12:00 PM");
    await page.getByLabel("Technician", { exact: true }).selectOption({ label: "Marcus Vance" });
    await expect(page.locator("#event-JB-201")).toBeVisible();
    await expect(page.locator("#event-JB-204")).toHaveCount(0);
    await page.getByLabel("Technician", { exact: true }).selectOption("all");
    await page.getByLabel("Service", { exact: true }).selectOption("ac-repair-diagnostics");
    await expect(page.locator("#event-JB-204")).toBeVisible();
    await expect(page.locator("#event-JB-201")).toHaveCount(0);
  });
});

test.describe("assigning from the Schedule", () => {
  test("is stored on the booking and the job, and Bookings, Jobs and the Schedule all agree after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/schedule");
    await page.getByRole("button", { name: "Assign technician to Elena Rodriguez" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Samira Patel/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(dialog).toBeHidden();

    const stored = await db.query(
      `select m.name as job_tech, bm.name as booking_tech from jobs j join bookings b on b.id = j.booking_id
         join team_members m on m.id = j.assignee_id join team_members bm on bm.id = b.assignee_id where j.organization_id = $1 and j.number = 198`,
      [workerTenant.organizationId],
    );
    expect(stored.rows[0]).toEqual({ job_tech: "Samira Patel", booking_tech: "Samira Patel" });

    await page.reload();
    await expect(page.locator("#event-JB-198")).toContainText("Samira");
    await page.goto("/jobs/JB-198");
    await expect(page.locator("dl").first()).toContainText("Samira Patel");
    await page.goto("/bookings?tab=upcoming&booking=BK-1035");
    await expect(drawer(page)).toContainText("Samira Patel");
  });

  test("taking an assignment back is stored too", async ({ page, db, workerTenant }) => {
    await page.goto("/schedule?view=day&date=2024-10-25&event=JB-201");
    await drawer(page).getByRole("button", { name: "Reassign" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Leave unassigned/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(dialog).toBeHidden();
    const stored = await db.query(
      "select j.assignee_id as job_tech, b.assignee_id as booking_tech from jobs j join bookings b on b.id = j.booking_id where j.organization_id = $1 and j.number = 201",
      [workerTenant.organizationId],
    );
    expect(stored.rows[0]).toEqual({ job_tech: null, booking_tech: null });
    await page.goto("/schedule");
    await expect(page.getByRole("region", { name: "Unassigned work" })).toContainText("David Chen");
  });

  test("a completed job cannot be reassigned: the screen does not offer it and a stale window is refused", async ({ page, db, workerTenant }) => {
    await page.goto("/schedule?view=day&date=2024-10-25&event=JB-201");
    await drawer(page).getByRole("button", { name: "Reassign" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Alex Morgan/ }).check();
    await db.query("update jobs set status = 'in-progress' where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    await db.query("update jobs set status = 'completed', completion_notes = 'Done.', completed_at = now() where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(dialog.getByRole("alert")).toContainText("can't be reassigned");
  });
});

test.describe("the Schedule belongs to one business", () => {
  test("Northstar's Schedule shows Northstar's work and none of Apex's, on any day", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/schedule?view=week&date=2024-10-29");
    // Northstar's saved date and time style is applied after the page loads, which re-draws the page once: wait for it to settle.
    await expect(page.locator("#event-JB-1001")).toHaveCount(1);
    await expect(page.locator("#event-JB-1001")).toContainText("Marta Olsen");
    await expect(page.locator("#event-JB-1001")).toContainText("Jordan");
    for (const day of ["2024-10-22", "2024-10-25", "2024-10-28"]) {
      await page.goto(`/schedule?view=day&date=${day}`);
      await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
      await expect(page.getByText("Team Safety Training")).toHaveCount(0);
      await expect(page.locator("[id^=event-]")).toHaveCount(0);
    }
    // Apex's own event ids are not events here.
    await page.goto("/schedule?view=day&date=2024-10-25&event=JB-204");
    await expect(page.getByRole("complementary", { name: /details/i })).toHaveCount(0);
  });

  test("blocked time is the business's own: Apex's training day is Apex's alone", async ({ page, openAs }) => {
    await page.goto("/schedule?view=week&date=2024-10-22");
    await expect(page.locator("#event-BLK-1")).toContainText("Team Safety Training");
    const taylor = (await openAs("taylor")).page;
    await taylor.goto("/schedule?view=week&date=2024-10-22");
    await expect(taylor.locator("#event-BLK-1")).toHaveCount(0);
  });
});

test.describe("dates and times do not depend on the browser's time zone", () => {
  test("Apex reads the same in Auckland, Los Angeles and Kiritimati", async ({ browser, workerTenant, clientAddresses }) => {
    const readings: string[] = [];
    for (const timezoneId of ["Pacific/Auckland", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      const context = await browser.newContext({ storageState: workerTenant.storageState, timezoneId, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
      const page = waitsForHydration(await context.newPage());
      await page.goto("/schedule");
      const week = await heading(page).innerText();
      const friday = await page.locator("#event-JB-204").innerText();
      await page.goto("/bookings?tab=past&booking=BK-1042");
      const received = await drawer(page).innerText();
      await page.goto("/jobs/JB-204");
      const completed = await page.getByText(/^Completed /).first().innerText();
      readings.push(JSON.stringify({ week, friday, received: received.match(/Received [^\n]*/)?.[0], completed }));
      await context.close();
    }
    expect(new Set(readings).size).toBe(1);
    const [reading] = readings;
    expect(reading).toContain("Oct 21");
    expect(reading).toContain("10:00 AM – 12:00 PM");
    expect(reading).toContain("Received Oct 24, 9:42 AM");
    expect(reading).toContain("Completed Oct 25, 10:45 AM");
  });

  test("a real-clock business's 'today' is computed in its own zone, the same for every browser zone", async ({ browser, clientAddresses }) => {
    // Northstar lives in Denver. Whatever zone the browser is in, this week is the week it is in Denver.
    const denverToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    // Northstar shows ISO dates (its own preference), so the week reads "2026-10-05 – 2026-10-11".
    const expectedWeek = `${startOfWeek(denverToday)} – ${addDays(startOfWeek(denverToday), 6)}`;
    const headings: string[] = [];
    for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const storageState = await signInOverHttp("taylor.brooks@northstar.test", process.env.SEED_PASSWORD ?? "", clientAddresses());
      const context = await browser.newContext({ storageState, timezoneId, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
      const page = waitsForHydration(await context.newPage());
      await page.goto("/schedule");
      headings.push(await heading(page).innerText());
      await page.goto(`/schedule?view=day`);
      await expect(heading(page)).toContainText(`Today, `);
      await context.close();
    }
    expect(headings[0]).toBe(headings[1]);
    expect(headings[0]).toContain(expectedWeek);
  });
});
