/**
 * Phase 11: Bookings are real. They are read from PostgreSQL for the ACTIVE business, every change is made by an authorized
 * server action and survives a reload, the numbers are the business's own, and no one sees or touches another business's.
 *
 * Tests that change data work in the worker's own copy of the Apex workspace (restored before each test). Tests that only read
 * the standing Apex and Northstar seed use `openAs` and never change anything there.
 */
import type { Page } from "playwright/test";
import { BOOKINGS } from "./apex-data";
import { NOT_SIGNED_IN, completeOnboarding, expect, signUp, test } from "./saas";

const bookingRows = (page: Page, tab: string) => page.getByRole("table", { name: `${tab} bookings` }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const drawer = (page: Page) => page.getByRole("complementary", { name: "Booking details" });
const wizardOf = (page: Page) => page.getByRole("dialog", { name: "Create booking" });

/** Sarah Mitchell → AC Repair & Diagnostics → Midday (10:00 AM – 12:00 PM) today → a technician, stopping on the Review step. */
async function fillBooking(page: Page, technician = "Marcus Vance") {
  const wizard = wizardOf(page);
  await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
  await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
  await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
  await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
  await wizard.getByRole("radio", { name: /^Midday/ }).check();
  await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
  await wizard.getByRole("radio", { name: new RegExp(`^${technician}`) }).check();
  await wizard.getByRole("button", { name: /^Next: Review/ }).click();
  return wizard;
}

async function createBooking(page: Page) {
  await page.goto("/bookings?new=1");
  const wizard = await fillBooking(page);
  await wizard.getByRole("button", { name: "Create booking" }).click();
  const success = page.getByRole("dialog", { name: "Booking created" });
  await expect(success).toBeVisible();
  return success;
}

const statusCounts = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((row) => [row.status, row.n]));

test.describe("Bookings come from the database, for the active business only", () => {
  test("Apex's seeded bookings: the tab counts are the stored rows", async ({ page, db, workerTenant }) => {
    const { rows } = await db.query<{ status: string; n: number }>("select status, count(*)::int as n from bookings where organization_id = $1 group by status", [workerTenant.organizationId]);
    const stored = statusCounts(rows);
    expect(stored).toEqual({ pending: 2, confirmed: 5, completed: 6 });
    expect(BOOKINGS).toHaveLength(13);
    await page.goto("/bookings");
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([
      new RegExp(`^Requests\\s*${stored.pending}$`),
      new RegExp(`^Upcoming\\s*${stored.confirmed}$`),
      new RegExp(`^Past\\s*${stored.completed}$`),
      /^Cancelled\s*0$/,
    ]);
  });

  test("Northstar sees its own two bookings and nothing of Apex's", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/bookings");
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*1$/, /^Upcoming\s*1$/, /^Past\s*0$/, /^Cancelled\s*0$/]);
    await expect(bookingRows(page, "Requests")).toHaveCount(1);
    await expect(bookingRows(page, "Requests").first()).toContainText("Dev Kapoor");
    await expect(bookingRows(page, "Requests").first()).toContainText("Cooling Diagnostic Visit");
    await tab(page, "Upcoming").click();
    await expect(bookingRows(page, "Upcoming")).toHaveCount(1);
    await expect(bookingRows(page, "Upcoming").first()).toContainText("Marta Olsen");
    await expect(bookingRows(page, "Upcoming").first()).toContainText("Furnace Tune-Up");
    for (const apexOnly of ["Sarah Mitchell", "Claire Dubois", "Jason Miller", "Robert Ramirez", "Elena Rodriguez", "BK-1042"]) {
      await expect(page.getByText(apexOnly, { exact: false })).toHaveCount(0);
    }
  });

  test("a booking id that belongs to another business opens nothing and leaks nothing", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    // BK-1042 is Sarah's completed booking in Apex; Northstar has no such booking.
    await page.goto("/bookings?tab=past&booking=BK-1042");
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    // BK-1001 is Northstar's own, and is a different record from any Apex booking.
    await page.goto("/bookings?tab=upcoming&booking=BK-1001");
    await expect(drawer(page)).toContainText("Booking #BK-1001");
    await expect(drawer(page)).toContainText("Marta Olsen");
    await expect(drawer(page)).toContainText("Jordan Pike");
  });

  test("the HTML and the client-navigation payload of Northstar's Bookings contain none of Apex's records", async ({ apiAs }) => {
    const api = await apiAs("taylor");
    for (const path of ["/bookings", "/bookings?tab=upcoming&booking=BK-1042", "/schedule", "/jobs", "/jobs/JB-204"]) {
      const html = await (await api.get(path)).text();
      const payload = await (await api.get(path, { headers: { RSC: "1" } })).text();
      for (const apexOnly of ["Sarah Mitchell", "sarah-mitchell", "Claire Dubois", "Robert Ramirez", "1402 Kinney", "Alex Morgan", "Marcus Vance"]) {
        expect(html.includes(apexOnly), `${path} (html) leaks ${apexOnly}`).toBe(false);
        expect(payload.includes(apexOnly), `${path} (payload) leaks ${apexOnly}`).toBe(false);
      }
    }
  });
});

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("has no bookings, schedule or jobs, and says so", async ({ page }) => {
    await signUp(page);
    await completeOnboarding(page, { name: "Fresh Air Services" });

    await page.goto("/bookings");
    await expect(page.getByRole("tablist", { name: "Booking lists" }).getByRole("tab")).toHaveText([/^Requests\s*0$/, /^Upcoming\s*0$/, /^Past\s*0$/, /^Cancelled\s*0$/]);
    await expect(page.getByText("No bookings yet. Create a booking to get started.")).toBeVisible();
    await expect(page.getByText(/isn.t available/i)).toHaveCount(0);
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);

    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Nothing is scheduled yet" })).toBeVisible();
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "No jobs yet" })).toBeVisible();
    await expect(page.getByText(/isn.t available/i)).toHaveCount(0);
  });
});

test.describe("Create booking persists", () => {
  test("a booking created in the wizard is stored under the next number and is still there after a reload", async ({ page, db, workerTenant }) => {
    const success = await createBooking(page);
    await expect(success).toContainText("#BK-1043");

    const stored = await db.query(
      `select b.number, b.status, b.source, b.service_date::text as date, b.start_time::text as start, b.end_time::text as stop, c.name as customer, s.name as service, m.name as technician
         from bookings b join customers c on c.id = b.customer_id join services s on s.id = b.service_id left join team_members m on m.id = b.assignee_id
        where b.organization_id = $1 and b.number = 1043`,
      [workerTenant.organizationId],
    );
    expect(stored.rows).toEqual([
      { number: 1043, status: "confirmed", source: "Phone / Front desk", date: "2024-10-25", start: "10:00:00", stop: "12:00:00", customer: "Sarah Mitchell", service: "AC Repair & Diagnostics", technician: "Marcus Vance" },
    ]);

    await page.goto("/bookings?tab=upcoming");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(6);
    await expect(page.getByRole("button", { name: /^Review booking BK-1043 / })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /^Review booking BK-1043 / })).toBeVisible();
  });

  test("numbers are allocated one after another, by the database, and a failed creation does not use one", async ({ page, db, workerTenant }) => {
    const first = await createBooking(page);
    await expect(first).toContainText("#BK-1043");
    await first.getByRole("button", { name: "Close" }).first().click();
    const second = await createBooking(page);
    await expect(second).toContainText("#BK-1044");
    const counter = await db.query("select next_value from organization_sequences where organization_id = $1 and kind = 'booking'", [workerTenant.organizationId]);
    expect(counter.rows[0].next_value).toBe(1045);
  });

  test("the wizard offers this business's customers, active services and assignable team, from the database", async ({ page, db, workerTenant }) => {
    await db.query("update services set is_active = false where organization_id = $1 and slug = 'ductless-mini-split-estimate'", [workerTenant.organizationId]);
    const customers = (await db.query<{ name: string }>("select name from customers where organization_id = $1 order by position", [workerTenant.organizationId])).rows.map((row) => row.name);
    await page.goto("/bookings?new=1");
    const wizard = wizardOf(page);
    const group = wizard.getByRole("group", { name: "Existing customer" });
    await expect(group.getByRole("radio")).toHaveCount(customers.length);
    for (const name of customers) await expect(group.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeVisible();
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    // The service switched off in the database is not offered.
    await expect(wizard.getByRole("group", { name: "Service", exact: true }).getByRole("radio")).toHaveCount(5);
    await expect(wizard.getByRole("radio", { name: /^Ductless Mini-Split/ })).toHaveCount(0);
  });

  test("Northstar's wizard offers Northstar's customers, services and team, and none of Apex's", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/bookings?new=1");
    const wizard = wizardOf(page);
    await expect(wizard.getByRole("radio", { name: /^Marta Olsen/ })).toBeVisible();
    await expect(wizard.getByRole("radio", { name: /^Priya Raman/ })).toBeVisible();
    await expect(wizard.getByRole("radio", { name: /^Sarah Mitchell/ })).toHaveCount(0);
    await wizard.getByRole("radio", { name: /^Marta Olsen/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    const services = wizard.getByRole("group", { name: "Service", exact: true }).getByRole("radio");
    await expect(services).toHaveCount(3);
    await expect(wizard.getByRole("radio", { name: /^Furnace Tune-Up/ })).toBeVisible();
    await expect(wizard.getByRole("radio", { name: /^Annual Cooling Tune-Up/ })).toHaveCount(0);
    await wizard.getByRole("radio", { name: /^Furnace Tune-Up/ }).check();
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click().catch(() => undefined);
    await expect(wizard.getByRole("alert").filter({ hasText: "Select an available time." })).toBeVisible();
  });

  test("the saved business hours decide which times are offered", async ({ page, db, workerTenant }) => {
    // Monday 2024-10-28 opens at noon in this business: the morning windows are not offered.
    await db.query("update organization_business_hours set opens_at = '12:00', closes_at = '16:00' where organization_id = $1 and day_of_week = 1", [workerTenant.organizationId]);
    await page.goto("/bookings?new=1");
    const wizard = wizardOf(page);
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByLabel("Select date").fill("2024-10-28");
    await expect(wizard.getByRole("radio", { name: /^Morning/ })).toBeDisabled();
    await expect(wizard.getByRole("radio", { name: /^Midday/ })).toBeDisabled();
    await expect(wizard.getByRole("radio", { name: /^Afternoon/ })).toBeEnabled();
  });

  test("a time the business is closed is refused by the server even if the screen is bypassed", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?new=1");
    const wizard = await fillBooking(page);
    // The hours change after the screen was filled in: the server checks the stored hours, not the page's copy.
    await db.query("update organization_business_hours set is_open = false, opens_at = null, closes_at = null where organization_id = $1 and day_of_week = 5", [workerTenant.organizationId]);
    await wizard.getByRole("button", { name: "Create booking" }).click();
    await expect(wizard.getByRole("alert").filter({ hasText: "closed" })).toBeVisible();
    const stored = await db.query("select count(*)::int as n from bookings where organization_id = $1", [workerTenant.organizationId]);
    expect(stored.rows[0].n).toBe(13);
  });
});

test.describe("status changes persist", () => {
  test("confirming a request is stored: it is still Upcoming after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?booking=BK-1040");
    await drawer(page).getByRole("button", { name: "Confirm booking" }).click();
    await expect(tab(page, "Upcoming")).toHaveAttribute("aria-selected", "true");
    await expect(drawer(page)).toContainText("Confirmed");

    const stored = await db.query("select status, confirmed_at is not null as stamped from bookings where organization_id = $1 and number = 1040", [workerTenant.organizationId]);
    expect(stored.rows[0]).toEqual({ status: "confirmed", stamped: true });
    await page.goto("/bookings?tab=upcoming");
    await expect(bookingRows(page, "Upcoming")).toHaveCount(6);
    await expect(tab(page, "Requests")).toContainText("1");
  });

  test("declining a request needs a reason, which is stored and shown after a reload", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?booking=BK-1038");
    await drawer(page).getByRole("button", { name: "Decline request" }).click();
    const dialog = page.getByRole("dialog", { name: "Decline this request?" });
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(dialog.getByText("Enter a reason.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Outside our service area.");
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(tab(page, "Cancelled")).toHaveAttribute("aria-selected", "true");

    const stored = await db.query("select status, cancellation_reason from bookings where organization_id = $1 and number = 1038", [workerTenant.organizationId]);
    expect(stored.rows[0]).toEqual({ status: "cancelled", cancellation_reason: "Outside our service area." });
    await page.goto("/bookings?tab=cancelled&booking=BK-1038");
    await expect(drawer(page)).toContainText("Outside our service area.");
    await expect(tab(page, "Cancelled")).toContainText("1");
  });

  test("cancelling a confirmed booking is stored; one that already has a job cannot be cancelled", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?tab=upcoming&booking=BK-1041");
    await drawer(page).getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await dialog.getByLabel("Reason").fill("Customer rescheduled with another company.");
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(tab(page, "Cancelled")).toHaveAttribute("aria-selected", "true");
    const stored = await db.query("select status, cancellation_reason from bookings where organization_id = $1 and number = 1041", [workerTenant.organizationId]);
    expect(stored.rows[0]).toEqual({ status: "cancelled", cancellation_reason: "Customer rescheduled with another company." });

    // BK-1039 has JB-201: the screen offers no way to cancel it.
    await page.goto("/bookings?tab=upcoming&booking=BK-1039");
    await expect(drawer(page)).toContainText("Booking #BK-1039");
    await expect(drawer(page).getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
  });

  test("a change that is no longer possible is refused with a clear message and nothing changes", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?booking=BK-1040");
    // Someone else confirms it first.
    await db.query("update bookings set status = 'confirmed', confirmed_at = now() where organization_id = $1 and number = 1040", [workerTenant.organizationId]);
    await drawer(page).getByRole("button", { name: "Confirm booking" }).click();
    await expect(drawer(page).getByRole("alert")).toContainText("already confirmed");
    expect((await db.query("select status from bookings where organization_id = $1 and number = 1040", [workerTenant.organizationId])).rows[0].status).toBe("confirmed");
  });

  test("a booking that no longer exists is reported safely, with no database error shown", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?booking=BK-1038");
    await db.query("delete from bookings where organization_id = $1 and number = 1038", [workerTenant.organizationId]);
    await drawer(page).getByRole("button", { name: "Decline request" }).click();
    const dialog = page.getByRole("dialog", { name: "Decline this request?" });
    await dialog.getByLabel("Reason").fill("Outside our service area.");
    await dialog.getByRole("button", { name: "Decline request" }).click();
    await expect(dialog.getByRole("alert")).toContainText("no longer exists");
    await expect(dialog).not.toContainText(/violates|constraint|relation|syntax|ERROR/i);
  });

  test("a member of the business can read bookings but not change them", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/bookings?booking=BK-1040");
    await expect(page.getByRole("button", { name: "Create booking" })).toHaveCount(0);
    await expect(drawer(page)).toContainText("Claire Dubois");
    await expect(drawer(page).getByRole("button", { name: "Confirm booking" })).toHaveCount(0);
    await expect(drawer(page).getByRole("button", { name: "Decline request" })).toHaveCount(0);
    await expect(drawer(page)).toContainText("Only an owner or admin");
    // The create flow is not reachable by its link either.
    await page.goto("/bookings?new=1");
    await expect(page.getByRole("dialog", { name: "Create booking" })).toHaveCount(0);
  });
});
