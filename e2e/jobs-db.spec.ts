/**
 * Phase 11: Jobs are real. They are read from PostgreSQL for the ACTIVE business; work details, starting, completing,
 * assignment and photos' visibility are made by authorized server actions and survive a reload; completing a job is one
 * atomic change; a job id from another business is "not found"; and no job is ever created twice for one booking.
 *
 * Tests that change data work in the worker's own copy of the Apex workspace (restored before each test).
 */
import type { Page } from "playwright/test";
import { expect, test, waitsForHydration } from "./saas";

const jobRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} jobs` }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const bookingTab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const drawer = (page: Page) => page.getByRole("complementary", { name: "Booking details" });
const notesBox = (page: Page) => page.getByLabel("Internal office & tech notes");

async function completeJob201(page: Page, notes = "Replaced the reversing valve; system heating normally.") {
  await page.goto("/jobs/JB-201");
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByRole("button", { name: "Complete job" })).toBeVisible();
  await page.getByRole("button", { name: "Complete job" }).click();
  const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
  await dialog.getByLabel("Technician debrief & resolution notes").fill(notes);
  return dialog;
}

test.describe("Jobs come from the database, for the active business only", () => {
  test("Apex's seeded jobs: the tab counts are the stored rows", async ({ page, db, workerTenant }) => {
    const { rows } = await db.query<{ status: string; n: number }>("select status, count(*)::int as n from jobs where organization_id = $1 group by status", [workerTenant.organizationId]);
    const stored = Object.fromEntries(rows.map((row) => [row.status, row.n]));
    expect(stored).toEqual({ scheduled: 4, completed: 7 });
    await page.goto("/jobs");
    await expect(page.getByRole("tablist", { name: "Job lists" }).getByRole("tab")).toHaveText([/^Active\s*4$/, /^Upcoming\s*2$/, /^Completed\s*7$/]);
  });

  test("Northstar sees its own job and nothing of Apex's", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/jobs");
    await expect(jobRows(page, "Active")).toHaveCount(1);
    await expect(jobRows(page, "Active").first()).toContainText("JB-1001");
    await expect(jobRows(page, "Active").first()).toContainText("Marta Olsen");
    await expect(jobRows(page, "Active").first()).toContainText("Furnace Tune-Up");
    await expect(jobRows(page, "Active").first()).toContainText("Jordan Pike");
    await tab(page, "Completed").click();
    await expect(page.getByText("No completed jobs.")).toBeVisible();
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    await expect(page.getByText("JB-204")).toHaveCount(0);
  });

  test("JB-204 is stored as Sarah Mitchell's completed AC Repair & Diagnostics job at 1402 Kinney Ave, linked to BK-1042", async ({ page, db, workerTenant }) => {
    const stored = await db.query(
      `select j.status, b.number as booking, c.name as customer, s.name as service, p.address_line1 as street, p.city, p.postal_code
         from jobs j join bookings b on b.id = j.booking_id join customers c on c.id = j.customer_id join services s on s.id = j.service_id
         join customer_properties p on p.id = j.property_id where j.organization_id = $1 and j.number = 204`,
      [workerTenant.organizationId],
    );
    expect(stored.rows[0]).toMatchObject({ status: "completed", booking: 1042, customer: "Sarah Mitchell", service: "AC Repair & Diagnostics", street: "1402 Kinney Ave", city: "Austin", postal_code: "78704" });

    await page.goto("/jobs/JB-204");
    await expect(page.getByRole("heading", { level: 1, name: /Job #JB-204/ })).toBeVisible();
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
    const facts = page.locator("dl").first();
    await expect(facts).toContainText("Sarah Mitchell");
    await expect(facts).toContainText("AC Repair & Diagnostics");
    await expect(facts).toContainText("1402 Kinney Ave");
    await expect(page.getByRole("link", { name: "Linked from Booking #BK-1042" })).toBeVisible();
  });

  test("another business's job id is simply not found, whichever side asks", async ({ openAs, page }) => {
    const taylor = (await openAs("taylor")).page;
    await taylor.goto("/jobs/JB-204");
    await expect(taylor.getByText("Job not found")).toBeVisible();
    await expect(taylor.getByText("Sarah Mitchell")).toHaveCount(0);
    await expect(taylor.getByRole("heading", { name: /Job #JB-204/ })).toHaveCount(0);
    // And the other way round: Northstar's JB-1001 does not exist in Apex.
    await page.goto("/jobs/JB-1001");
    await expect(page.getByText("Job not found")).toBeVisible();
    await expect(page.getByText("Marta Olsen")).toHaveCount(0);
    // Northstar's own is there.
    await taylor.goto("/jobs/JB-1001");
    await expect(taylor.getByRole("heading", { level: 1, name: /Job #JB-1001/ })).toBeVisible();
    await expect(taylor.locator("dl").first()).toContainText("Marta Olsen");
  });

  test("job ids that are not job ids are not found either", async ({ page }) => {
    for (const bad of ["jb-204", "204", "JB-0", "JB-999999999999", "BK-1042", "JB-204%20OR%201=1"]) {
      await page.goto(`/jobs/${bad}`);
      await expect(page.getByText("Job not found"), bad).toBeVisible();
    }
  });
});

test.describe("work details persist", () => {
  test("Save writes the details; they are there after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-201/work-details");
    await notesBox(page).fill("Contactor pitted; replace next visit.");
    await page.getByLabel("Technician field diagnosis").fill("Weak start capacitor.");
    await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);

    const stored = await db.query("select internal_notes, technician_diagnosis from jobs where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    expect(stored.rows[0]).toEqual({ internal_notes: "Contactor pitted; replace next visit.", technician_diagnosis: "Weak start capacitor." });
    await page.reload();
    await expect(notesBox(page)).toHaveValue("Contactor pitted; replace next visit.");
    await expect(page.getByLabel("Technician field diagnosis")).toHaveValue("Weak start capacitor.");
  });

  test("Discard writes nothing", async ({ page, db, workerTenant }) => {
    const before = await db.query("select internal_notes, updated_at from jobs where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    await page.goto("/jobs/JB-201/work-details");
    await notesBox(page).fill("A draft nobody saved.");
    await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    await page.reload();
    const after = await db.query("select internal_notes, updated_at from jobs where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    await expect(notesBox(page)).not.toHaveValue("A draft nobody saved.");
  });

  test("a completed job's details cannot be changed, on the screen or at the server", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-204/work-details");
    await expect(notesBox(page)).toHaveAttribute("readonly", "");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
    // Even a stale page that still offered the edit is refused by the server.
    await page.goto("/jobs/JB-201/work-details");
    await notesBox(page).fill("Edited too late.");
    await db.query("update jobs set status = 'in-progress' where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    await db.query("update jobs set status = 'completed', completion_notes = 'Done.', completed_at = now() where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Unsaved changes" }).getByRole("alert")).toContainText("final");
    const stored = await db.query("select internal_notes from jobs where organization_id = $1 and number = 201", [workerTenant.organizationId]);
    expect(stored.rows[0].internal_notes).not.toBe("Edited too late.");
  });

  test("a member of the business can read a job but not change it", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/jobs/JB-201/work-details");
    await expect(notesBox(page)).toHaveAttribute("readonly", "");
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reassign" })).toHaveCount(0);
    await page.goto("/jobs");
    await expect(page.getByRole("button", { name: /Assign technician to job/ })).toHaveCount(0);
  });
});

test.describe("starting and completing a job", () => {
  test("starting is stored: the job is still in progress after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await expect(page.getByRole("button", { name: "Complete job" })).toBeVisible();
    expect((await db.query("select status from jobs where organization_id = $1 and number = 201", [workerTenant.organizationId])).rows[0].status).toBe("in-progress");
    await page.reload();
    await expect(page.getByText("In progress").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
  });

  test("completing stores the job and completes its booking in the same step; both are completed after a reload", async ({ page, db, workerTenant }) => {
    const dialog = await completeJob201(page);
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByText("Job #JB-201 completed.")).toBeVisible();

    const stored = await db.query(
      `select j.status as job, j.completion_notes, j.completed_at is not null as stamped, b.status as booking
         from jobs j join bookings b on b.id = j.booking_id where j.organization_id = $1 and j.number = 201`,
      [workerTenant.organizationId],
    );
    expect(stored.rows[0]).toEqual({ job: "completed", completion_notes: "Replaced the reversing valve; system heating normally.", stamped: true, booking: "completed" });

    await page.reload();
    await expect(page.getByText("Completed Oct 25, 10:45 AM").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);
    await page.goto("/bookings?tab=past&booking=BK-1039");
    await expect(drawer(page)).toContainText("Completed");
    await expect(bookingTab(page, "Past")).toContainText("7");
    await expect(bookingTab(page, "Upcoming")).toContainText("4");
    await page.goto("/jobs");
    await expect(tab(page, "Completed")).toContainText("8");
    await expect(tab(page, "Active")).toContainText("3");
  });

  test("completing is all or nothing: if the booking cannot be completed, the job is not completed either", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const name = `fail_${org.replace(/-/g, "")}`;
    await db.query(`create function ${name}() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
    await db.query(`create trigger ${name} before update on bookings for each row when (new.organization_id = '${org}' and new.status = 'completed') execute function ${name}()`);
    try {
      const dialog = await completeJob201(page);
      await dialog.getByRole("button", { name: "Complete job" }).click();
      await expect(dialog.getByRole("alert")).toContainText("could not be saved");
      await expect(dialog.getByRole("alert")).not.toContainText(/injected|trigger|exception/i);
      const stored = await db.query(
        `select j.status as job, j.completion_notes, j.completed_at, b.status as booking
           from jobs j join bookings b on b.id = j.booking_id where j.organization_id = $1 and j.number = 201`,
        [org],
      );
      expect(stored.rows[0]).toEqual({ job: "in-progress", completion_notes: null, completed_at: null, booking: "confirmed" });
    } finally {
      await db.query(`drop trigger if exists ${name} on bookings`);
      await db.query(`drop function if exists ${name}()`);
    }
  });

  test("completing creates no quote, invoice or payment, and does not touch the money screens", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByText("Sum of active recorded payments")).toBeVisible();
    const before = await page.getByRole("main").innerText();
    const dialog = await completeJob201(page);
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByText("Job #JB-201 completed.")).toBeVisible();
    await expect(page.getByRole("main").getByText(/invoice|quote|payment/i)).toHaveCount(0);
    await page.goto("/payments");
    await expect(page.getByText("Sum of active recorded payments")).toBeVisible();
    expect(await page.getByRole("main").innerText()).toBe(before);
  });

  test("a job cannot be completed before it is started, or twice", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await expect(page.getByRole("button", { name: "Complete job" })).toBeVisible();
    // Another window completes it first.
    await db.query(
      "update jobs set status = 'completed', completion_notes = 'Done elsewhere.', completed_at = now() where organization_id = $1 and number = 201",
      [workerTenant.organizationId],
    );
    await page.getByRole("button", { name: "Complete job" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Finished.");
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(dialog.getByRole("alert")).toContainText("already completed");
    expect((await db.query("select completion_notes from jobs where organization_id = $1 and number = 201", [workerTenant.organizationId])).rows[0].completion_notes).toBe("Done elsewhere.");
  });
});

test.describe("creating a job from a booking", () => {
  test("the job gets the next job number (JB-205 after JB-204), links to its booking, and is there after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?booking=BK-1041");
    await drawer(page).getByRole("button", { name: "Create job" }).click();
    await expect(drawer(page).getByRole("link", { name: /View job #JB-205/ })).toHaveAttribute("href", "/jobs/JB-205");

    const stored = await db.query(
      `select j.number, j.status, b.number as booking, j.contact_name, j.service_date::text as date
         from jobs j join bookings b on b.id = j.booking_id where j.organization_id = $1 and b.number = 1041`,
      [workerTenant.organizationId],
    );
    expect(stored.rows).toEqual([{ number: 205, status: "scheduled", booking: 1041, contact_name: "Robert Ramirez", date: "2024-10-28" }]);

    await page.goto("/jobs/JB-205");
    await expect(page.getByRole("heading", { level: 1, name: /Job #JB-205/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Linked from Booking #BK-1041" })).toBeVisible();
  });

  test("confirming a request does not create a job by itself", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?booking=BK-1040");
    await drawer(page).getByRole("button", { name: "Confirm booking" }).click();
    await expect(drawer(page)).toContainText("Confirmed");
    const jobs = await db.query("select count(*)::int as n from jobs where organization_id = $1", [workerTenant.organizationId]);
    expect(jobs.rows[0].n).toBe(11);
  });

  test("a second job cannot be created for the same booking, even from a stale window", async ({ page, db, workerTenant }) => {
    const second = waitsForHydration(await page.context().newPage());
    await page.goto("/bookings?booking=BK-1041");
    await second.goto("/bookings?booking=BK-1041");
    await expect(second.getByRole("complementary", { name: "Booking details" }).getByRole("button", { name: "Create job" })).toBeVisible();

    await drawer(page).getByRole("button", { name: "Create job" }).click();
    await expect(drawer(page).getByRole("link", { name: /View job #JB-205/ })).toBeVisible();

    // The other window has not heard: it still offers the button. The server refuses and says why.
    await second.getByRole("complementary", { name: "Booking details" }).getByRole("button", { name: "Create job" }).click();
    await expect(second.getByRole("complementary", { name: "Booking details" }).getByRole("alert")).toContainText("already has a job");
    const stored = await db.query("select count(*)::int as n from jobs j join bookings b on b.id = j.booking_id where j.organization_id = $1 and b.number = 1041", [workerTenant.organizationId]);
    expect(stored.rows[0].n).toBe(1);
    await second.close();
  });
});

test.describe("assignment", () => {
  test("reassigning a job is stored on the job and its booking, and every screen agrees after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Reassign" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Alex Morgan/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(dialog).toBeHidden();

    const stored = await db.query(
      `select m.name as job_tech, bm.name as booking_tech from jobs j join bookings b on b.id = j.booking_id
         join team_members m on m.id = j.assignee_id join team_members bm on bm.id = b.assignee_id where j.organization_id = $1 and j.number = 201`,
      [workerTenant.organizationId],
    );
    expect(stored.rows[0]).toEqual({ job_tech: "Alex Morgan", booking_tech: "Alex Morgan" });

    await page.goto("/jobs/JB-201");
    await expect(page.locator("dl").first()).toContainText("Alex Morgan");
    await page.goto("/bookings?tab=upcoming&booking=BK-1039");
    await expect(drawer(page)).toContainText("Alex Morgan");
    await page.goto("/schedule");
    await expect(page.locator("#event-JB-201")).toContainText("Alex");
  });

  test("a team member who has been deactivated is not offered, and is refused if a stale window still offers them", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-198");
    await page.getByRole("button", { name: "Assign technician" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await expect(dialog.getByRole("radio", { name: /^Marcus Vance/ })).toBeVisible();
    await dialog.getByRole("radio", { name: /^Marcus Vance/ }).check();
    // Marcus is deactivated while the dialog is open.
    await db.query("update team_members set status = 'inactive' where organization_id = $1 and slug = 'marcus-vance'", [workerTenant.organizationId]);
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(dialog.getByRole("alert")).toContainText("can't be given new work");
    const stored = await db.query("select assignee_id from jobs where organization_id = $1 and number = 198", [workerTenant.organizationId]);
    expect(stored.rows[0].assignee_id).toBeNull();

    await page.reload();
    await page.getByRole("button", { name: "Assign technician" }).click();
    await expect(page.getByRole("dialog", { name: "Assign technician" }).getByRole("radio", { name: /^Marcus Vance/ })).toHaveCount(0);
  });

  test("history is not rewritten: a completed job keeps its deactivated technician", async ({ page, db, workerTenant }) => {
    await db.query("update team_members set status = 'inactive' where organization_id = $1 and slug = 'marcus-vance'", [workerTenant.organizationId]);
    await page.goto("/jobs/JB-186");
    await expect(page.locator("dl").first()).toContainText("Marcus Vance");
  });
});

test.describe("photos and files", () => {
  test("file metadata is listed from the database; a file chosen in the browser is session-only and honest about it", async ({ page, db, workerTenant }) => {
    await page.goto("/jobs/JB-204/files");
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(4);

    await page.goto("/jobs/JB-201/files");
    await page.getByLabel("Choose photos or documents to upload").setInputFiles({ name: "condenser.png", mimeType: "image/png", buffer: Buffer.from("not-a-real-image") });
    await expect(page.getByText("This browser only: not saved, gone when the page reloads.")).toBeVisible();
    await expect(page.getByText(/File storage is not set up yet/).first()).toBeVisible();
    // Nothing reaches the database, and nothing is claimed to.
    const stored = await db.query("select count(*)::int as n from job_files where organization_id = $1", [workerTenant.organizationId]);
    expect(stored.rows[0].n).toBe(4);
    await page.reload();
    await expect(page.getByRole("list", { name: "Photos and files" }).getByRole("listitem")).toHaveCount(0);
    expect((await db.query("select count(*)::int as n from job_files where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(4);
  });
});
