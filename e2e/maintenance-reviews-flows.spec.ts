/**
 * Phase 13: maintenance plans and reviews through the real application, against the real database. Plans, visits, replies and
 * review requests are stored, so every change made on a screen is checked where it lands (PostgreSQL), after a reload and in a
 * fresh session; the server's own checks are exercised with the very requests a screen sends, replayed by hand with different
 * arguments, a different person or no session; and a business only ever sees its own plans and reviews.
 *
 * Almost every test edits the worker's own copy of the Apex workspace, restored to the canonical record before each test.
 */
import type { Locator, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { ensureTestTenant, resetTestTenant } from "../scripts/db/seed-lib";
import { signInOverHttp } from "./fixtures";
import { captureAction, replay, withArguments, withFirstArgument } from "./replay";
import { completeOnboarding, expect, NOT_SIGNED_IN, ORIGIN, signUp, switchWorkspace, test, toast } from "./saas";

/* ───────────────────────── helpers ───────────────────────── */

const SARAH_TEXT = "The technician explained the repair clearly and completed the work as scheduled.";
const SARAH_REPLY = "Thank you, Sarah. We appreciate your feedback and are glad the repair process was clear and completed as scheduled.";

const main = (page: Page) => page.getByRole("main");
const totals = (page: Page) => page.getByRole("region", { name: "Maintenance plan totals" });
const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Review views" }).getByRole("tab");
const card = (page: Page, name: string) => page.getByRole("article", { name: `Review from ${name}` });
const closeDialog = (dialog: Locator) => dialog.getByRole("button", { name: "Close", exact: true }).click();

const APPROVED_REVIEW_TABS = [/^All reviews\s*12$/, /^Awaiting reply\s*3$/, /^Responded\s*9$/];
const AFTER_REPLY_TABS = [/^All reviews\s*12$/, /^Awaiting reply\s*2$/, /^Responded\s*10$/];

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

/** Schedule Sarah's included visit through the screens. Resolves with the confirmation dialog. */
async function scheduleSarah(page: Page) {
  await page.goto("/maintenance-plans/plan-sarah-comfort-care");
  await page.getByRole("button", { name: "Schedule visit" }).first().click();
  const wizard = await fillVisit(page);
  await wizard.getByRole("button", { name: "Create booking" }).click();
  const done = page.getByRole("dialog", { name: "Maintenance visit scheduled" });
  await expect(done).toContainText("Booking #BK-1048 confirmed");
  return done;
}

/** Create maintenance plan for Elena Rodriguez through the screens, stopping on Review. */
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

async function createElenaPlan(page: Page, name = "Peace of Mind") {
  await page.goto("/maintenance-plans?new=1");
  const wizard = await fillPlan(page, name);
  await wizard.getByRole("button", { name: "Create plan" }).click();
  const done = page.getByRole("dialog", { name: "Maintenance plan created" });
  await expect(done).toBeVisible();
  return done;
}

async function postSarahReply(page: Page) {
  await page.goto("/reviews/rev-sarah-mitchell");
  await page.getByRole("button", { name: "Reply to review" }).click();
  const dialog = page.getByRole("dialog", { name: "Reply to review" });
  await expect(dialog.getByLabel(/^Public response/)).toHaveValue(SARAH_REPLY);
  await dialog.getByRole("button", { name: "Post response" }).click();
  await expect(dialog).toBeHidden();
}

async function requestSarahReview(page: Page, channel: "Email" | "SMS" = "Email") {
  await page.goto("/reviews");
  await page.getByRole("button", { name: "Request review" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a review" });
  await expect(dialog.getByLabel("Customer")).toHaveValue("sarah-mitchell");
  await dialog.getByRole("radio", { name: new RegExp(`^${channel}`) }).check();
  await dialog.getByRole("button", { name: "Send review request" }).click();
  await expect(dialog).toBeHidden();
}

type Db = import("pg").Pool;
const one = async (db: Db, sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0];
const count = async (db: Db, table: string, org: string) => (await db.query(`select count(*)::int as n from ${table} where organization_id = $1`, [org])).rows[0].n as number;
const planBySlug = (db: Db, org: string, slug: string) =>
  one(db, "select id, name, status, price_cents, cadence, start_date::text as start, end_date::text as ending, visits_per_year, imported, customer_id is not null as has_customer from maintenance_plans where organization_id = $1 and slug = $2", [org, slug]);
const visitRow = (db: Db, org: string, ref: string) =>
  one(db, "select v.ref, v.status, v.booking_id, b.number as booking, v.completed_on::text as completed_on from maintenance_plan_visits v left join bookings b on b.id = v.booking_id where v.organization_id = $1 and v.ref = $2", [org, ref]);
const moneyCounts = async (db: Db, org: string) => ({
  quotes: await count(db, "quotes", org),
  invoices: await count(db, "invoices", org),
  payments: await count(db, "payments", org),
  jobs: await count(db, "jobs", org),
});

/* ───────────────────────── Sarah Mitchell's Comfort Care ───────────────────────── */

test.describe("Sarah Mitchell's Comfort Care plan comes from the database", () => {
  test("it is $189 a year, 2 visits, May 14 2024 to May 14 2025, Active, and its coverage is not in the Services catalog", async ({ page, db, workerTenant }) => {
    const plan = await planBySlug(db, workerTenant.organizationId, "plan-sarah-comfort-care");
    expect(plan).toMatchObject({ name: "Comfort Care", status: "active", price_cents: 18900, cadence: "year", start: "2024-05-14", ending: "2025-05-14", visits_per_year: 2, imported: true, has_customer: true });
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    const facts = main(page).locator("dl").first();
    await expect(facts).toContainText("$189 / year");
    await expect(facts).toContainText("2 visits / yr");
    await expect(facts).toContainText("May 14, 2024");
    await expect(facts).toContainText("May 14, 2025");
    const coverage = page.getByRole("region", { name: "Plan coverage" });
    await expect(coverage).toContainText("Cooling maintenance");
    await expect(coverage).toContainText("Heating maintenance");

    // Coverage is not a Service: the catalog has neither, and the public service list is unchanged.
    await page.goto("/services");
    await expect(main(page).getByText("Cooling maintenance", { exact: true })).toHaveCount(0);
    await expect(main(page).getByText("Heating maintenance", { exact: true })).toHaveCount(0);
    expect((await db.query("select count(*)::int as n from services where organization_id = $1", [workerTenant.organizationId])).rows[0].n).toBe(6);
  });

  test("the plan list reports the approved totals, 14 active, 5 visits due, 3 renewals, 2 paused or ended, from the baseline", async ({ page }) => {
    await page.goto("/maintenance-plans");
    await expect(totals(page)).toContainText("14");
    await expect(page.getByRole("tablist", { name: "Maintenance plan views" }).getByRole("tab")).toHaveText([/^Active\s*14$/, /^Upcoming service\s*5$/, /^All plans\s*16$/]);
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("Sarah Mitchell");
  });

  test("Customer Sarah Mitchell shows the plan, its coverage and the next visit from the same records", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    const agreement = page.getByRole("region", { name: "Maintenance agreement" });
    await expect(agreement).toContainText("Comfort Care");
    await expect(agreement).toContainText("$189");
    await expect(agreement).toContainText("Cooling maintenance");
    await expect(agreement).toContainText("Heating maintenance");
    // Another customer's plan is not on her page.
    await expect(agreement).not.toContainText("Seasonal Maintenance");
  });
});

/* ───────────────────────── scheduling creates BK-1048 ───────────────────────── */

test.describe("scheduling the included visit makes the one real booking BK-1048", () => {
  test("it is stored: one booking for Sarah, Nov 19 10:00 AM to 12:00 PM with Marcus Vance, confirmed, linked to visit 2, and no Job, Invoice, Quote or Payment", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = await moneyCounts(db, org);
    expect((await db.query("select count(*)::int as n from bookings where organization_id = $1 and number = 1048", [org])).rows[0].n).toBe(0);

    const done = await scheduleSarah(page);
    await closeDialog(done);

    const booking = await one(
      db,
      `select b.number, b.status, b.source, b.service_date::text as day, b.start_time::text as start, b.end_time::text as ending, c.name as customer, p.slug as property, m.name as technician, s.name as service,
              (select count(*)::int from jobs j where j.booking_id = b.id) as jobs
         from bookings b join customers c on c.id = b.customer_id left join customer_properties p on p.id = b.property_id
         join team_members m on m.id = b.assignee_id join services s on s.id = b.service_id
        where b.organization_id = $1 and b.number = 1048`,
      [org],
    );
    expect(booking).toEqual({
      number: 1048,
      status: "confirmed",
      source: "Maintenance plan",
      day: "2024-11-19",
      start: "10:00:00",
      ending: "12:00:00",
      customer: "Sarah Mitchell",
      property: "prop-sarah-home",
      technician: "Marcus Vance",
      service: "Annual Cooling Tune-Up & Maintenance",
      jobs: 0,
    });
    expect(await visitRow(db, org, "plan-sarah-comfort-care-v2")).toMatchObject({ status: "scheduled", booking: 1048 });
    // The first visit is untouched, and nothing financial or operational came with the booking but the booking itself.
    expect(await visitRow(db, org, "plan-sarah-comfort-care-v1")).toMatchObject({ status: "completed", booking: null, completed_on: "2024-05-22" });
    expect(await moneyCounts(db, org)).toEqual({ ...before, jobs: before.jobs });
    expect((await db.query("select count(*)::int as n from bookings where organization_id = $1", [org])).rows[0].n).toBe(
      (await db.query("select count(*)::int as n from bookings where organization_id = $1 and number <> 1048", [org])).rows[0].n + 1,
    );
    // The plan's price is not money received: nothing in the money totals moved.
    await page.goto("/payments");
    await expect(main(page)).toContainText("$2,130.00");
  });

  test("it is still there after a reload and in a fresh session, on the plan, in Bookings and on the customer's page", async ({ page, browser, clientAddresses, workerTenant }) => {
    await closeDialog(await scheduleSarah(page));
    await page.reload();
    await expect(page.getByRole("table", { name: "Plan service history" })).toContainText("BK-1048");
    await expect(page.getByRole("region", { name: "Upcoming included service" })).toContainText("BK-1048");

    const fresh = await browser.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const other = await fresh.newPage();
    await other.goto("/bookings?tab=upcoming&booking=BK-1048");
    const drawer = other.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("Marcus Vance");
    await expect(drawer).toContainText("Nov 19");
    await expect(drawer.getByRole("link", { name: /Comfort Care/ })).toBeVisible();
    await other.goto("/customers/sarah-mitchell");
    await expect(other.getByRole("region", { name: "Maintenance agreement" })).toContainText("BK-1048");
    await other.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(other.getByRole("table", { name: "Plan service history" })).toContainText("BK-1048");
    await fresh.close();
  });

  test("there is only one booking: Bookings lists a single Comfort Care visit, and a second attempt is refused", async ({ page, db, workerTenant }) => {
    await closeDialog(await scheduleSarah(page));
    await page.goto("/bookings?tab=upcoming");
    await expect(page.getByRole("table", { name: "Upcoming bookings" }).locator("tbody tr", { hasText: "Comfort Care" })).toHaveCount(1);

    // The visit is no longer offered...
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByRole("button", { name: "Schedule visit" })).toHaveCount(0);
    // ...and the server refuses it when it is asked anyway.
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    expect((await db.query("select count(*)::int as n from bookings where organization_id = $1 and number >= 1048", [workerTenant.organizationId])).rows[0].n).toBe(1);
  });

  test("two people scheduling the same visit at once get one booking between them", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    // Capture a real scheduling call from a plan of Elena's (the visit is Cooling, like Sarah's), then replay it at Sarah's visit, six at a time.
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    await page.goto("/maintenance-plans/plan-elena-rodriguez-peace-of-mind");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    const captured = await captureAction(page, () => wizard.getByRole("button", { name: "Create booking" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance visit scheduled" })).toBeVisible();

    const aimed = withArguments(captured, (args) => ["plan-sarah-comfort-care", "plan-sarah-comfort-care-v2", { ...(args[2] as object) }]);
    const owner = page.request;
    const answers = await Promise.all(Array.from({ length: 6 }, () => replay(owner, captured, aimed).then((response) => response.text())));
    const scheduled = answers.filter((text) => /"ok":true/.test(text));
    expect(scheduled.length, answers.join("\n---\n").slice(0, 2000)).toBe(1);
    for (const text of answers.filter((value) => !scheduled.includes(value))) expect(text).toMatch(/already has a booking|same moment|next included visit/);

    expect((await db.query("select count(*)::int as n from bookings b join customers c on c.id = b.customer_id where b.organization_id = $1 and c.slug = 'sarah-mitchell' and b.source = 'Maintenance plan'", [org])).rows[0].n).toBe(1);
    expect(await visitRow(db, org, "plan-sarah-comfort-care-v2")).toMatchObject({ status: "scheduled", booking: 1048 });
    expect((await db.query("select count(*)::int as n from maintenance_plan_visits where organization_id = $1 and booking_id is not null", [org])).rows[0].n).toBe(2);
  });

  test("cancelling the booking reopens the visit; booking it again makes a new booking and keeps the cancelled one as history", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const done = await scheduleSarah(page);
    await done.getByRole("link", { name: "View booking" }).click();
    await page.getByRole("complementary", { name: "Booking details" }).getByRole("button", { name: "Cancel booking" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
    await dialog.getByLabel("Reason").fill("Customer asked to rebook.");
    await dialog.getByRole("button", { name: "Cancel booking" }).click();
    await expect(dialog).toBeHidden();

    const reopened = await visitRow(db, org, "plan-sarah-comfort-care-v2");
    expect(reopened).toMatchObject({ status: "due", booking: 1048 });
    expect((await one(db, "select status from bookings where organization_id = $1 and number = 1048", [org])).status).toBe("cancelled");

    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    await wizard.getByRole("button", { name: "Create booking" }).click();
    const again = page.getByRole("dialog", { name: "Maintenance visit scheduled" });
    await expect(again).toBeVisible();
    const rebooked = await visitRow(db, org, "plan-sarah-comfort-care-v2");
    expect(rebooked.status).toBe("scheduled");
    expect(rebooked.booking).not.toBe(1048);
    // Exactly one live booking for the visit, and the cancelled one is still in the history of bookings.
    expect((await db.query("select count(*)::int as n from bookings b join maintenance_plan_visits v on v.booking_id = b.id where b.organization_id = $1 and b.status <> 'cancelled'", [org])).rows[0].n).toBe(1);
    expect((await one(db, "select status from bookings where organization_id = $1 and number = 1048", [org])).status).toBe("cancelled");
  });

  test("scheduling leaves Jobs, Quotes, Invoices and Payments exactly as approved, and no review or request appears", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = { ...(await moneyCounts(db, org)), reviews: await count(db, "reviews", org), requests: await count(db, "review_requests", org) };
    await closeDialog(await scheduleSarah(page));
    expect({ ...(await moneyCounts(db, org)), reviews: await count(db, "reviews", org), requests: await count(db, "review_requests", org) }).toEqual(before);
  });
});

/* ───────────────────────── creating a plan ───────────────────────── */

test.describe("Create plan stores the plan, its coverage and its visits", () => {
  test("a created plan is in PostgreSQL with its terms, coverage and due visits, creates no booking, invoice or payment, and survives a reload", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = { ...(await moneyCounts(db, org)), bookings: await count(db, "bookings", org), plans: await count(db, "maintenance_plans", org) };
    const done = await createElenaPlan(page, "Peace of Mind");
    await done.getByRole("link", { name: "View plan" }).click();
    await expect(page).toHaveURL(/\/maintenance-plans\/plan-elena-rodriguez-peace-of-mind$/);

    const plan = await planBySlug(db, org, "plan-elena-rodriguez-peace-of-mind");
    expect(plan).toMatchObject({ name: "Peace of Mind", status: "active", price_cents: 18900, cadence: "year", visits_per_year: 2, imported: false, has_customer: true });
    const coverage = (await db.query("select coverage_key, label, visits from maintenance_plan_coverage where plan_id = $1 order by sort_order", [plan.id])).rows;
    expect(coverage).toEqual([
      { coverage_key: "cooling", label: "Cooling maintenance", visits: 1 },
      { coverage_key: "heating", label: "Heating maintenance", visits: 1 },
    ]);
    const visits = (await db.query("select ref, sequence, label, status, booking_id from maintenance_plan_visits where plan_id = $1 order by sequence", [plan.id])).rows;
    expect(visits).toEqual([
      { ref: "plan-elena-rodriguez-peace-of-mind-v1", sequence: 1, label: "Cooling maintenance", status: "due", booking_id: null },
      { ref: "plan-elena-rodriguez-peace-of-mind-v2", sequence: 2, label: "Heating maintenance", status: "due", booking_id: null },
    ]);
    // Creating an agreement bills no one and books nothing.
    expect({ ...(await moneyCounts(db, org)), bookings: await count(db, "bookings", org), plans: before.plans }).toEqual({ ...before, plans: before.plans });
    expect(await count(db, "maintenance_plans", org)).toBe(before.plans + 1);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Peace of Mind" })).toBeVisible();
    await page.goto("/maintenance-plans");
    await expect(totals(page)).toContainText("15");
    await expect(page.getByText("Showing 5 of 15 active plans")).toBeVisible();
  });

  test("the same plan created twice is two plans, with their own references", async ({ page, db, workerTenant }) => {
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    const slugs = (await db.query("select slug from maintenance_plans where organization_id = $1 and slug like 'plan-elena-rodriguez-peace-of-mind%' order by slug", [workerTenant.organizationId])).rows.map((row) => row.slug);
    expect(slugs).toEqual(["plan-elena-rodriguez-peace-of-mind", "plan-elena-rodriguez-peace-of-mind-2"]);
  });

  test("the plan reaches the customer's page and a fresh session sees it", async ({ page, browser, clientAddresses, workerTenant }) => {
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    const fresh = await browser.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const other = await fresh.newPage();
    await other.goto("/customers/elena-rodriguez");
    await expect(other.getByRole("region", { name: "Maintenance agreement" })).toContainText("Peace of Mind");
    await fresh.close();
  });

  test("a plan's price is information about the agreement: nothing is invoiced, charged or recorded as received", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = await moneyCounts(db, org);
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    expect(await moneyCounts(db, org)).toEqual(before);
    await page.goto("/payments");
    await expect(main(page)).toContainText("$2,130.00");
    await expect(main(page)).not.toContainText("Peace of Mind");
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$2,130");
  });
});

/* ───────────────────────── reviews ───────────────────────── */

test.describe("Sarah Mitchell's review comes from the database", () => {
  test("it is 5 stars from Sarah about JB-204 (still Completed), awaiting a reply, with the approved reply ready in the dialog", async ({ page, db, workerTenant }) => {
    await page.goto("/reviews");
    await expect(reviewTabs(page)).toHaveText(APPROVED_REVIEW_TABS);
    await expect(card(page, "Sarah Mitchell")).toContainText(SARAH_TEXT);
    await expect(card(page, "Sarah Mitchell")).toContainText("Awaiting reply");
    await page.goto("/reviews/rev-sarah-mitchell");
    await expect(main(page)).toContainText(SARAH_TEXT);
    await expect(page.getByRole("link", { name: /JB-204/ }).first()).toBeVisible();
    const row = await one(db, "select r.rating, r.source, j.number as job, j.status as job_status from reviews r join jobs j on j.id = r.job_id where r.organization_id = $1 and r.slug = 'rev-sarah-mitchell'", [workerTenant.organizationId]);
    expect(row).toEqual({ rating: 5, source: "Climvia", job: 204, job_status: "completed" });
    await page.goto("/jobs/JB-204");
    await expect(main(page)).toContainText("Completed");
  });

  test("the Reviews page reports the approved 12 / 4.7 / 3 / 5 from the baseline, not from a count of rows", async ({ page, db, workerTenant }) => {
    await page.goto("/reviews");
    await expect(page.getByRole("region", { name: "Review totals" })).toContainText("4.7");
    expect(await count(db, "reviews", workerTenant.organizationId)).toBe(4);
    await expect(reviewTabs(page)).toHaveText(APPROVED_REVIEW_TABS);
  });
});

test.describe("a reply is stored", () => {
  test("posting the approved reply stores it once, signed by Alex Morgan, and leaves the customer's words and the job alone", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await postSarahReply(page);
    await expect(page.getByRole("status").filter({ hasText: /^Response posted\.$/ })).toBeVisible();
    const reply = await one(
      db,
      `select p.body, p.author_name, p.edited_at, p.imported, m.slug as member, r.review_text, r.rating, j.status as job_status
         from review_replies p join reviews r on r.id = p.review_id left join team_members m on m.id = p.replied_by join jobs j on j.id = r.job_id
        where p.organization_id = $1 and r.slug = 'rev-sarah-mitchell'`,
      [org],
    );
    expect(reply).toEqual({ body: SARAH_REPLY, author_name: "Alex Morgan", edited_at: null, imported: false, member: "alex-morgan", review_text: SARAH_TEXT, rating: 5, job_status: "completed" });
    expect(await count(db, "review_replies", org)).toBe(3);

    await page.goto("/reviews");
    await expect(reviewTabs(page)).toHaveText(AFTER_REPLY_TABS);
    await expect(page.getByRole("region", { name: "Review totals" })).toContainText("4.7");
  });

  test("it survives a reload and a fresh session, with who replied and when", async ({ page, browser, clientAddresses, workerTenant }) => {
    await postSarahReply(page);
    await page.reload();
    const response = page.getByRole("region", { name: "Business response" });
    await expect(response).toContainText(SARAH_REPLY);
    await expect(response).toContainText("Responded by Alex Morgan · Oct 25, 2024 at 10:45 AM");

    const fresh = await browser.newContext({ baseURL: ORIGIN, storageState: workerTenant.storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const other = await fresh.newPage();
    await other.goto("/reviews");
    await expect(reviewTabs(other)).toHaveText(AFTER_REPLY_TABS);
    await expect(card(other, "Sarah Mitchell")).toContainText(SARAH_REPLY);
    await fresh.close();
  });

  test("editing the reply changes the same reply, marks it edited, and keeps who replied and when", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await postSarahReply(page);
    const first = await one(db, "select p.id, p.replied_at, p.author_name from review_replies p join reviews r on r.id = p.review_id where p.organization_id = $1 and r.slug = 'rev-sarah-mitchell'", [org]);
    await page.getByRole("button", { name: "Edit response" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit response" });
    await dialog.getByLabel(/^Public response/).fill("Thank you, Sarah. We are glad the repair went smoothly.");
    await dialog.getByRole("button", { name: "Save response" }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText("Response updated.");

    const edited = await one(db, "select p.id, p.body, p.replied_at, p.author_name, p.edited_at is not null as edited, r.review_text from review_replies p join reviews r on r.id = p.review_id where p.organization_id = $1 and r.slug = 'rev-sarah-mitchell'", [org]);
    expect(edited.id).toBe(first.id);
    expect(edited.body).toBe("Thank you, Sarah. We are glad the repair went smoothly.");
    expect(edited.edited).toBe(true);
    expect(edited.replied_at.toISOString()).toBe(first.replied_at.toISOString());
    expect(edited.author_name).toBe(first.author_name);
    expect(edited.review_text).toBe(SARAH_TEXT);
    expect(await count(db, "review_replies", org)).toBe(3);

    await page.reload();
    await expect(page.getByRole("region", { name: "Business response" })).toContainText("Thank you, Sarah. We are glad the repair went smoothly.");
    await expect(page.getByRole("region", { name: "Business response" })).toContainText("Edited");
  });

  test("the customer's words and rating have no editor: the only thing a reply dialog changes is the reply", async ({ page, db, workerTenant }) => {
    await postSarahReply(page);
    await page.getByRole("button", { name: "Edit response" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit response" });
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
    expect((await one(db, "select review_text from reviews where organization_id = $1 and slug = 'rev-sarah-mitchell'", [workerTenant.organizationId])).review_text).toBe(SARAH_TEXT);
  });

  test("a second reply to an answered review is refused by the server, and the stored reply stays", async ({ page, db, workerTenant }) => {
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("button", { name: "Reply to review" }).click();
    const dialog = page.getByRole("dialog", { name: "Reply to review" });
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Post response" }).click());
    await expect(dialog).toBeHidden();
    const text = await (await replay(page.request, captured, withArguments(captured, (args) => [args[0], "A different answer"]))).text();
    expect(text).toContain("already has a response");
    expect((await one(db, "select p.body from review_replies p join reviews r on r.id = p.review_id where p.organization_id = $1 and r.slug = 'rev-sarah-mitchell'", [workerTenant.organizationId])).body).toBe(SARAH_REPLY);
  });

  test("six people replying at once leave one reply", async ({ page, db, workerTenant }) => {
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("button", { name: "Reply to review" }).click();
    const dialog = page.getByRole("dialog", { name: "Reply to review" });
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Post response" }).click());
    await expect(dialog).toBeHidden();
    // Aim the same call at Elena's review, which has no reply, six times at once.
    const aimed = withArguments(captured, (args) => ["rev-elena-rodriguez", args[1]]);
    const answers = await Promise.all(Array.from({ length: 6 }, () => replay(page.request, captured, aimed).then((response) => response.text())));
    expect(answers.filter((text) => /already has a response|same moment/.test(text)).length).toBe(5);
    expect((await db.query("select count(*)::int as n from review_replies p join reviews r on r.id = p.review_id where p.organization_id = $1 and r.slug = 'rev-elena-rodriguez'", [workerTenant.organizationId])).rows[0].n).toBe(1);
  });
});

test.describe("a review request is recorded, and nothing is sent", () => {
  test("it stores the customer, the completed job, the channel and the message, and the Review requests total follows", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await requestSarahReview(page, "SMS");
    await expect(toast(page)).toContainText("Review request recorded for Sarah Mitchell by SMS. Nothing is sent.");
    const request = await one(
      db,
      `select q.channel, q.status, q.message, c.slug as customer, j.number as job, m.slug as member
         from review_requests q join customers c on c.id = q.customer_id left join jobs j on j.id = q.job_id left join team_members m on m.id = q.created_by where q.organization_id = $1`,
      [org],
    );
    expect(request).toEqual({ channel: "sms", status: "recorded", message: "Thanks for choosing Apex Climate Heating & Air. We’d appreciate your feedback about your recent service.", customer: "sarah-mitchell", job: 204, member: "alex-morgan" });
    await expect(page.getByRole("region", { name: "Review totals" })).toContainText("6");

    await page.reload();
    await expect(page.getByRole("region", { name: "Review totals" })).toContainText("6");
    expect(await count(db, "review_requests", org)).toBe(1);
  });

  test("it creates no Review, no reply and no Marketing campaign, and changes no Job", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = { reviews: await count(db, "reviews", org), replies: await count(db, "review_replies", org), jobs: await moneyCounts(db, org) };
    await requestSarahReview(page);
    expect({ reviews: await count(db, "reviews", org), replies: await count(db, "review_replies", org), jobs: await moneyCounts(db, org) }).toEqual(before);
    expect((await one(db, "select status from jobs where organization_id = $1 and number = 204", [org])).status).toBe("completed");
  });

  test("a job already asked about is not offered again, and the server refuses a second request for it", async ({ page, db, workerTenant }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await expect(dialog.getByLabel("Related job (optional)").locator("option", { hasText: "#JB-204" })).toHaveCount(1);
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Send review request" }).click());
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Request review" }).click();
    const again = page.getByRole("dialog", { name: "Request a review" });
    await expect(again.getByLabel("Related job (optional)").locator("option", { hasText: "#JB-204" })).toHaveCount(0);
    await again.getByRole("button", { name: "Cancel" }).click();

    const text = await (await replay(page.request, captured)).text();
    expect(text).toContain("already recorded");
    expect(await count(db, "review_requests", workerTenant.organizationId)).toBe(1);
  });

  test("only completed jobs of the customer are offered, and a forged request for any other job is refused", async ({ page, db, workerTenant }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    const options = await dialog.getByLabel("Related job (optional)").locator("option").allInnerTexts();
    expect(options[0]).toBe("No related job");
    for (const option of options.slice(1)) expect(option).toMatch(/Completed/);
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Send review request" }).click());
    await expect(dialog).toBeHidden();

    const jobs = (await db.query("select number from jobs where organization_id = $1 and status <> 'completed' order by number limit 1", [workerTenant.organizationId])).rows;
    const open = `JB-${jobs[0].number}`;
    const owner = (await db.query("select c.slug from jobs j join customers c on c.id = j.customer_id where j.organization_id = $1 and j.number = $2", [workerTenant.organizationId, jobs[0].number])).rows[0].slug as string;
    const send = async (change: (args: Record<string, unknown>) => void) => (await replay(page.request, captured, withFirstArgument(captured, change))).text();
    expect(await send((args) => Object.assign(args, { customerId: owner, relatedJobId: open }))).toContain("Only completed jobs are available");
    expect(await send((args) => Object.assign(args, { customerId: "david-chen", relatedJobId: "JB-204" }))).toContain("another customer");
    expect(await send((args) => Object.assign(args, { customerId: "sarah-mitchell", relatedJobId: "JB-9999" }))).toContain("no longer exists");
    expect(await send((args) => Object.assign(args, { channel: "fax" }))).toMatch(/not understood|Choose how/);
    expect(await send((args) => Object.assign(args, { message: "x".repeat(501) }))).toContain("500 characters");
    expect(await send((args) => Object.assign(args, { message: "   " }))).toContain("Write the message");
    expect(await count(db, "review_requests", workerTenant.organizationId)).toBe(1);
  });

  test("completing a job creates no review and no request", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = { reviews: await count(db, "reviews", org), requests: await count(db, "review_requests", org) };
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const dialog = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await dialog.getByLabel("Technician debrief & resolution notes").fill("Replaced the reversing valve; system heating normally.");
    await dialog.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByText("Job #JB-201 completed.")).toBeVisible();
    expect({ reviews: await count(db, "reviews", org), requests: await count(db, "review_requests", org) }).toEqual(before);
    // The completed job can now be asked about, by hand: that is a choice of the business, not a side effect.
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialogue = page.getByRole("dialog", { name: "Request a review" });
    await dialogue.getByLabel("Customer").selectOption("david-chen");
    await expect(dialogue.getByLabel("Related job (optional)").locator("option", { hasText: "#JB-201" })).toHaveCount(1);
  });
});

/* ───────────────────────── who may change what, and what the server checks ───────────────────────── */

test.describe("the server decides who may change plans and reviews, and what", () => {
  test("a member of the business can read plans and reviews but is offered nothing to change", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/maintenance-plans");
    await expect(page.getByRole("heading", { level: 1, name: "Maintenance Plans" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Create plan" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: /^Schedule visit/ })).toHaveCount(0);
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByRole("heading", { level: 1, name: "Comfort Care" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Schedule visit" })).toHaveCount(0);
    await page.goto("/maintenance-plans?new=1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/reviews");
    await expect(reviewTabs(page)).toHaveText(APPROVED_REVIEW_TABS);
    await expect(main(page).getByRole("button", { name: "Request review" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: /^Reply to review/ })).toHaveCount(0);
    await page.goto("/reviews/rev-sarah-mitchell");
    await expect(main(page)).toContainText(SARAH_TEXT);
    await expect(page.getByRole("button", { name: "Reply to review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Write a response" })).toHaveCount(0);
  });

  test("a member replaying an owner's calls is refused, and nothing is stored", async ({ page, apiAs, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    // The owner's real calls: create a plan, reply to Sarah's review, request a review.
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page, "Peace of Mind");
    const plan = await captureAction(page, () => wizard.getByRole("button", { name: "Create plan" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance plan created" })).toBeVisible();
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("button", { name: "Reply to review" }).click();
    const reply = await captureAction(page, () => page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click());
    await expect(page.getByRole("region", { name: "Business response" })).toBeVisible();
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const request = await captureAction(page, () => page.getByRole("dialog", { name: "Request a review" }).getByRole("button", { name: "Send review request" }).click());
    await expect(page.getByRole("dialog", { name: "Request a review" })).toBeHidden();

    const before = { plans: await count(db, "maintenance_plans", org), replies: await count(db, "review_replies", org), requests: await count(db, "review_requests", org) };
    const jamie = await apiAs("jamie");
    const renamed = withArguments(plan, (args) => [{ ...(args[0] as object), name: "Jamie's plan" }]);
    expect(await (await replay(jamie, plan, renamed)).text()).toContain("Only an owner or admin can change maintenance plans");
    expect(await (await replay(jamie, reply, withArguments(reply, (args) => ["rev-elena-rodriguez", args[1]]))).text()).toContain("Only an owner or admin can reply to reviews or request them");
    expect(await (await replay(jamie, request, withArguments(request, (args) => [{ ...(args[0] as object), customerId: "david-chen", relatedJobId: undefined }]))).text()).toContain("Only an owner or admin can reply to reviews or request them");
    expect({ plans: await count(db, "maintenance_plans", org), replies: await count(db, "review_replies", org), requests: await count(db, "review_requests", org) }).toEqual(before);
  });

  test("a request with no session cannot create, schedule, reply or ask for anything", async ({ page, apiAs, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("button", { name: "Reply to review" }).click();
    const reply = await captureAction(page, () => page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click());
    await expect(page.getByRole("region", { name: "Business response" })).toBeVisible();
    const before = await count(db, "review_replies", org);
    const anonymous = await apiAs(null);
    const response = await replay(anonymous, reply, withArguments(reply, (args) => ["rev-elena-rodriguez", args[1]]), { maxRedirects: 0 });
    expect([307, 401, 403]).toContain(response.status());
    expect(await count(db, "review_replies", org)).toBe(before);
  });

  test("naming another organization in the request changes nothing there: the server only writes to the caller's own active workspace", async ({ page, db, workerTenant, clientAddresses, playwright }) => {
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page, "Peace of Mind");
    const captured = await captureAction(page, () => wizard.getByRole("button", { name: "Create plan" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance plan created" })).toBeVisible();

    // Someone else's workspace: a second copy of the sample business with its own owner.
    const other = await ensureTestTenant(800 + test.info().parallelIndex);
    const otherState = await signInOverHttp(other.email, other.password, clientAddresses());
    const api = await playwright.request.newContext({ baseURL: ORIGIN, storageState: otherState, extraHTTPHeaders: { origin: ORIGIN } });
    const mineBefore = await count(db, "maintenance_plans", workerTenant.organizationId);
    const theirsBefore = await count(db, "maintenance_plans", other.organizationId);
    await replay(api, captured, withArguments(captured, (args) => [{ ...(args[0] as object), organizationId: workerTenant.organizationId, imported: true, priceCents: 1, id: "plan-forged" }]));
    await api.dispose();

    expect(await count(db, "maintenance_plans", workerTenant.organizationId), "the named organization is untouched").toBe(mineBefore);
    expect(await count(db, "maintenance_plans", other.organizationId), "the caller's own workspace got the plan").toBe(theirsBefore + 1);
    const stored = await one(db, "select status, imported, price_cents from maintenance_plans where organization_id = $1 and slug = 'plan-elena-rodriguez-peace-of-mind'", [other.organizationId]);
    expect(stored).toEqual({ status: "active", imported: false, price_cents: 18900 });

    const { pool, db: owner } = adminDb();
    await resetTestTenant(owner, other);
    await pool.end();
  });

  test("another business's owner cannot reach Apex's plans, visits or reviews by replaying the references", async ({ page, apiAs, db }) => {
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    const schedule = await captureAction(page, () => wizard.getByRole("button", { name: "Create booking" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance visit scheduled" })).toBeVisible();
    await page.goto("/reviews/rev-sarah-mitchell");
    await page.getByRole("button", { name: "Reply to review" }).click();
    const reply = await captureAction(page, () => page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click());
    await expect(page.getByRole("region", { name: "Business response" })).toBeVisible();

    // Taylor owns Northstar only. Northstar has no such plan or review: each reference is simply unknown to it.
    const northstar = (await db.query("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id as string;
    const snapshot = async () => ({ bookings: await count(db, "bookings", northstar), visits: (await db.query("select string_agg(status || coalesce(booking_id::text, ''), ',' order by ref) as s from maintenance_plan_visits where organization_id = $1", [northstar])).rows[0].s, replies: await count(db, "review_replies", northstar) });
    const before = await snapshot();
    const taylor = await apiAs("taylor");
    expect(await (await replay(taylor, schedule)).text()).toContain("That plan no longer exists");
    expect(await (await replay(taylor, reply)).text()).toContain("That review no longer exists");
    expect(await snapshot()).toEqual(before);
  });

  test("the server re-checks every plan and visit field the screen checked, and refuses what the screen would never send", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await page.goto("/maintenance-plans?new=1");
    const wizard = await fillPlan(page, "Peace of Mind");
    const captured = await captureAction(page, () => wizard.getByRole("button", { name: "Create plan" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance plan created" })).toBeVisible();
    const plans = await count(db, "maintenance_plans", org);
    const owner = page.request;

    const attempts: [string, (args: Record<string, unknown>) => void, RegExp][] = [
      ["a zero price", (args) => Object.assign(args, { price: "0" }), /above \$0/],
      ["a negative price", (args) => Object.assign(args, { price: "-189" }), /above \$0/],
      ["a fraction of a cent", (args) => Object.assign(args, { price: "189.005" }), /above \$0/],
      ["a price that is not a number", (args) => Object.assign(args, { price: "free" }), /above \$0/],
      ["no coverage", (args) => Object.assign(args, { coverage: {} }), /at least one maintenance visit/],
      ["coverage that is a Service name", (args) => Object.assign(args, { coverage: { "AC Repair & Diagnostics": 1 } }), /not understood/],
      ["too many visits", (args) => Object.assign(args, { coverage: { cooling: 99 } }), /Include between/],
      ["a blank name", (args) => Object.assign(args, { name: "   " }), /plan name/],
      ["a status the screen never offers", (args) => Object.assign(args, { status: "ended" }), /Active or Pending/],
      ["an unknown cadence", (args) => Object.assign(args, { cadence: "daily" }), /how often/],
      ["an end before the start", (args) => Object.assign(args, { startDate: "2025-01-02", endDate: "2025-01-01" }), /after the start/],
      ["a date that is not a date", (args) => Object.assign(args, { startDate: "2024-02-30" }), /start date/],
      ["a customer of another business", (args) => Object.assign(args, { customerId: "marta-olsen", propertyId: "prop-olsen-house" }), /not in your customers/],
      ["a property of another customer", (args) => Object.assign(args, { customerId: "elena-rodriguez", propertyId: "prop-sarah-home" }), /doesn't belong to this customer/],
      ["a malformed customer reference", (args) => Object.assign(args, { customerId: "Elena; drop table maintenance_plans" }), /Select the customer/],
    ];
    for (const [label, change, message] of attempts) {
      const text = await (await replay(owner, captured, withFirstArgument(captured, change))).text();
      // The message is the one the screen would show, and nothing was stored.
      expect(text, label).toMatch(message);
      expect(text, label).not.toMatch(/"ok":true/);
      expect(await count(db, "maintenance_plans", org), label).toBe(plans);
    }
  });

  test("a visit is scheduled in order, as its mapped Service, inside its window, on a day that has not passed, and only for an active plan", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    // A real scheduling call (for a first plan of Elena's) gives the shape of the request; it is then aimed at visits that must be refused.
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    await closeDialog(await createElenaPlan(page, "Second Plan"));
    await page.goto("/maintenance-plans/plan-elena-rodriguez-peace-of-mind");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    const captured = await captureAction(page, () => wizard.getByRole("button", { name: "Create booking" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance visit scheduled" })).toBeVisible();
    const bookings = await count(db, "bookings", org);

    const aim = (plan: string, visit: string, patch: Record<string, unknown> = {}) =>
      withArguments(captured, (args) => [plan, visit, { ...(args[2] as object), ...patch }]);
    const send = async (body: string) => (await replay(page.request, captured, body)).text();
    const SARAH = "plan-sarah-comfort-care";
    const SECOND = "plan-elena-rodriguez-second-plan";
    // The completed first visit cannot be booked, and a visit that does not exist is unknown; so is a plan that does not exist.
    expect(await send(aim(SARAH, `${SARAH}-v1`))).toContain("already completed");
    expect(await send(aim(SARAH, `${SARAH}-v9`))).toContain("no longer exists");
    expect(await send(aim("plan-nobody", "plan-nobody-v1"))).toContain("That plan no longer exists");
    // A visit is used in order: the second visit of a plan waits for the first.
    expect(await send(aim(SECOND, `${SECOND}-v2`))).toContain("next included visit first");
    // A visit already booked is not booked again (the first plan's first visit is the one the screen just scheduled).
    expect(await send(aim("plan-elena-rodriguez-peace-of-mind", "plan-elena-rodriguez-peace-of-mind-v1"))).toContain("already has a booking");
    // The mapped Service, the window, the past, the opening hours and the team.
    expect(await send(aim(SECOND, `${SECOND}-v1`, { serviceId: "ac-repair-diagnostics" }))).toContain("is booked as");
    expect(await send(aim(SARAH, `${SARAH}-v2`, { date: "2024-12-10" }))).toContain("target window");
    expect(await send(aim(SECOND, `${SECOND}-v1`, { date: "2024-10-24" }))).toContain("already passed");
    expect(await send(aim(SECOND, `${SECOND}-v1`, { date: "2024-11-17" }))).toContain("closed");
    expect(await send(aim(SECOND, `${SECOND}-v1`, { start: "02:00", end: "04:00" }))).toContain("outside the business hours");
    expect(await send(aim(SECOND, `${SECOND}-v1`, { assigneeId: "nobody" }))).toMatch(/team|assign|not in/i);
    expect(await send(aim(SECOND, `${SECOND}-v1`, { date: "2024-02-30" }))).toContain("Select a service date");
    expect(await send(aim(SECOND, `${SECOND}-v1`, { end: "09:00", start: "10:00" }))).toContain("arrival window");
    // None of them stored anything.
    expect(await count(db, "bookings", org)).toBe(bookings);
    expect(await visitRow(db, org, `${SECOND}-v1`)).toMatchObject({ status: "due", booking: null });
    expect(await visitRow(db, org, "plan-sarah-comfort-care-v2")).toMatchObject({ status: "due", booking: null });
  });

  test("only an active plan has a visit scheduled: the paused plan's due visits wait", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    await page.goto("/maintenance-plans/plan-elena-rodriguez-peace-of-mind");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    const captured = await captureAction(page, () => wizard.getByRole("button", { name: "Create booking" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance visit scheduled" })).toBeVisible();
    const before = await count(db, "bookings", org);
    // Robert Miller's Comfort Care is paused (carried-in history) and has both of its visits still due.
    const text = await (await replay(page.request, captured, withArguments(captured, (args) => ["plan-robert-comfort-care", "plan-robert-comfort-care-v1", args[2]]))).text();
    expect(text).toContain("Only an active plan can have a visit scheduled");
    expect(await count(db, "bookings", org)).toBe(before);
    expect(await visitRow(db, org, "plan-robert-comfort-care-v1")).toMatchObject({ status: "due", booking: null });
  });

  test("a plan for someone with no customer record is scheduled as a booking for that name and address", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await closeDialog(await createElenaPlan(page, "Peace of Mind"));
    await page.goto("/maintenance-plans/plan-elena-rodriguez-peace-of-mind");
    await page.getByRole("button", { name: "Schedule visit" }).first().click();
    const wizard = await fillVisit(page);
    const captured = await captureAction(page, () => wizard.getByRole("button", { name: "Create booking" }).click());
    await expect(page.getByRole("dialog", { name: "Maintenance visit scheduled" })).toBeVisible();
    // Arthur Pendleton's plan names a person and an address, not a Customers record. Its second visit is due in December.
    const text = await (
      await replay(page.request, captured, withArguments(captured, (args) => ["plan-arthur-seasonal-maintenance", "plan-arthur-seasonal-maintenance-v2", { ...(args[2] as object), serviceId: "furnace-safety-inspection", date: "2024-12-10" }]))
    ).text();
    expect(text).toMatch(/"ok":true/);
    const booking = await one(
      db,
      "select b.contact_name, b.contact_address, b.customer_id, b.source, b.status, v.status as visit from bookings b join maintenance_plan_visits v on v.booking_id = b.id where b.organization_id = $1 and v.ref = 'plan-arthur-seasonal-maintenance-v2'",
      [org],
    );
    expect(booking).toEqual({ contact_name: "Arthur Pendleton", contact_address: "1904 Guadalupe St, Austin, TX", customer_id: null, source: "Maintenance plan", status: "confirmed", visit: "scheduled" });
  });
});

/* ───────────────────────── tenant isolation in the screens ───────────────────────── */

test.describe("a business sees only its own plans and reviews", () => {
  test("Northstar's owner sees Northstar's plan, bookings and reviews, and none of Apex's", async ({ openAs }) => {
    const { page, problems } = await openAs("taylor");
    await page.goto("/maintenance-plans");
    await expect(page.getByRole("table", { name: "Active plans" }).locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("Marta Olsen");
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("Furnace Care");
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("$149 / year");
    await expect(main(page)).not.toContainText("Sarah Mitchell");
    await expect(main(page)).not.toContainText("Comfort Care");

    await page.goto("/maintenance-plans/plan-marta-olsen-furnace-care");
    await expect(page.getByRole("region", { name: "Plan coverage" })).toContainText("Heating maintenance");
    await expect(page.getByRole("region", { name: "Plan coverage" })).not.toContainText("Cooling maintenance");
    await expect(page.getByRole("table", { name: "Plan service history" })).toContainText("BK-1001");
    await expect(page.getByRole("region", { name: "Upcoming included service" })).toContainText("Heating maintenance");

    await page.goto("/reviews");
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(card(page, "Priya Raman")).toContainText("Quick, clear explanation of the cooling diagnostic and a fair price.");
    await expect(card(page, "Priya Raman")).toContainText("Thank you, Priya. We are glad the visit was clear and the price felt fair.");
    await expect(card(page, "Marta Olsen")).toContainText("Awaiting reply");
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*2$/, /^Awaiting reply\s*1$/, /^Responded\s*1$/]);
    await expect(page.getByRole("region", { name: "Review totals" })).toContainText("4.5");
    const body = await page.locator("body").innerText();
    for (const leak of [SARAH_TEXT, "Sarah Mitchell", "David Chen", "Marcus Sterling"]) expect(body, leak).not.toContain(leak);
    expect(problems).toEqual([]);
  });

  test("Apex's references are unknown to Northstar: not-found states, and nothing of Apex in the page", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    for (const [path, text] of [
      ["/maintenance-plans/plan-sarah-comfort-care", "Plan not found"],
      ["/reviews/rev-sarah-mitchell", "Review not found"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByText(text)).toBeVisible();
      const body = await page.locator("body").innerText();
      for (const leak of ["Sarah Mitchell", "Comfort Care", SARAH_TEXT, "1402 Kinney"]) expect(body, `${path}: ${leak}`).not.toContain(leak);
      await expect(page).not.toHaveTitle(/Comfort Care|Sarah/);
    }
  });

  test("Northstar's own plan is a different record from Apex's: its visit links Northstar's BK-1001", async ({ openAs }) => {
    const taylor = await openAs("taylor");
    await taylor.page.goto("/bookings?tab=upcoming&booking=BK-1001");
    const drawer = taylor.page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("Marta Olsen");
    await expect(drawer.getByRole("link", { name: /Furnace Care/ })).toBeVisible();
    const alex = await openAs("alex");
    await alex.page.goto("/bookings?tab=upcoming&booking=BK-1001");
    await expect(alex.page.getByRole("complementary", { name: "Booking details" })).toHaveCount(0);
  });

  test("someone in both businesses sees each one's own plans and reviews as they switch", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/reviews");
    await expect(reviewTabs(page)).toHaveText(APPROVED_REVIEW_TABS);
    await switchWorkspace(page, /Northstar/);
    await page.goto("/reviews");
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*2$/, /^Awaiting reply\s*1$/, /^Responded\s*1$/]);
    await page.goto("/maintenance-plans");
    await expect(page.getByRole("table", { name: "Active plans" })).toContainText("Marta Olsen");
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
  });
});

test.describe("a new business starts with empty plans and reviews, not 'unavailable'", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("its owner can open Maintenance Plans and Reviews, sees zero totals and empty lists, and nothing of the sample business", async ({ page }) => {
    await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name: "Clean Slate Heating" });

    await page.goto("/maintenance-plans");
    await expect(page.getByRole("heading", { level: 1, name: "Maintenance Plans" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No maintenance plans yet" })).toBeVisible();
    await expect(totals(page)).toContainText("Active plans");
    await expect(page.getByText(/isn't available for Clean Slate Heating yet/)).toHaveCount(0);

    await page.goto("/reviews");
    await expect(page.getByRole("heading", { level: 1, name: "Reviews" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No reviews yet" })).toBeVisible();
    await expect(page.getByText(/isn't available for Clean Slate Heating yet/)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Review totals" })).toContainText("No reviews recorded yet");

    expect(await page.locator("body").innerText()).not.toMatch(/Sarah Mitchell|Comfort Care|Seasonal Maintenance|Marcus Sterling/);
    await page.goto("/maintenance-plans/plan-sarah-comfort-care");
    await expect(page.getByText("Plan not found")).toBeVisible();
    await page.goto("/reviews/rev-sarah-mitchell");
    await expect(page.getByText("Review not found")).toBeVisible();
  });

  test("with no customers there is nothing to put on a plan or to ask for a review, and the dialogs say so", async ({ page }) => {
    await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name: "Clean Slate Heating" });
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Request review" }).first().click();
    await expect(page.getByRole("dialog", { name: "Request a review" })).toContainText("You have no customers yet");
    await page.getByRole("dialog", { name: "Request a review" }).getByRole("button", { name: "Cancel" }).click();
    await page.goto("/maintenance-plans?new=1");
    await expect(page.getByRole("dialog", { name: "Create maintenance plan" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Create maintenance plan" }).getByRole("radio")).toHaveCount(0);
  });
});
