/**
 * Setting up a new business: the five steps, what they refuse, and exactly what gets created (one organization, its owner, its
 * seven days of hours and a first site, in one transaction, and nothing else).
 */
import { randomBytes } from "node:crypto";
import { SYSTEM_ROLES } from "../src/data/team";
import { completeOnboarding, expect, expectAccessible, NOT_SIGNED_IN, openForm, signUp, switcher, test, waitsForHydration } from "./saas";

/** A business name no earlier run can have used, so the stored address is predictable on a database that is being reused. */
const uniqueName = (base: string) => `${base} ${randomBytes(3).toString("hex")}`;
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const heading = (page: import("playwright/test").Page, name: string) => page.getByRole("heading", { level: 2, name });

// Each of these signs up, sets a business up and checks what was stored: several page loads in a row.
test.describe.configure({ timeout: 90_000 });

test.describe("the set-up steps", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("a visitor who is not signed in is sent to Log in", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
  });

  test("it has five steps, starting with the business name", async ({ page }) => {
    await signUp(page);
    await expect(page.getByRole("heading", { level: 1, name: "Set up your business" })).toBeVisible();
    const steps = page.getByRole("list", { name: "Setup steps" }).getByRole("listitem");
    await expect(steps).toHaveText([/Business/, /Contact & location/, /Preferences/, /Business hours/, /Review & create/]);
    await expect(heading(page, "What's your business called?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  });

  test("every step passes the structural and contrast checks, with and without errors showing", async ({ page }) => {
    await signUp(page);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Enter your business name.")).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel(/^Business name/).fill("Accessible Air");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("main [aria-invalid='true']").first()).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel(/^Phone/).fill("(303) 555-0188");
    await page.getByLabel(/^Email/).fill("hello@accessible.test");
    await page.getByLabel(/^Street address/).fill("12 Aspen Way");
    await page.getByLabel(/^City/).fill("Denver");
    await page.getByLabel(/^State/).selectOption("CO");
    await page.getByLabel(/^ZIP code/).fill("80203");
    await page.getByRole("button", { name: "Continue" }).click();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Review and create your workspace" })).toBeVisible();
    await expectAccessible(page);
  });

  test("each step refuses to go on until its own fields are right, and says which", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Enter your business name.")).toBeVisible();
    await expect(page.getByLabel(/^Business name/)).toBeFocused();
    await page.getByLabel(/^Business name/).fill("Valid Name Air");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(heading(page, "How can customers reach you?")).toBeFocused();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("main [aria-invalid='true']").first()).toBeFocused();
    expect(await page.locator("main [aria-invalid='true']").count()).toBeGreaterThanOrEqual(5);
    await expect(heading(page, "How can customers reach you?")).toBeVisible();
  });

  test("a closing time that is not after the opening time stops the hours step", async ({ page }) => {
    await signUp(page);
    await page.getByLabel(/^Business name/).fill("Valid Name Air");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Phone/).fill("(303) 555-0188");
    await page.getByLabel(/^Email/).fill("hello@valid.test");
    await page.getByLabel(/^Street address/).fill("12 Aspen Way");
    await page.getByLabel(/^City/).fill("Denver");
    await page.getByLabel(/^State/).selectOption("CO");
    await page.getByLabel(/^ZIP code/).fill("80203");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(heading(page, "When are you open?")).toBeVisible();
    await page.getByLabel("Monday closing time").selectOption({ index: 0 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Closing time must be after opening time.")).toBeVisible();
    await expect(heading(page, "When are you open?")).toBeVisible();
  });

  test("Back keeps what was typed, and the review shows it before anything is created", async ({ page, db }) => {
    const email = await signUp(page);
    await page.getByLabel(/^Business name/).fill("Review Me Heating");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel(/^Business name/)).toHaveValue("Review Me Heating");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Phone/).fill("(303) 555-0188");
    await page.getByLabel(/^Email/).fill("hello@review.test");
    await page.getByLabel(/^Street address/).fill("12 Aspen Way");
    await page.getByLabel(/^City/).fill("Denver");
    await page.getByLabel(/^State/).selectOption("CO");
    await page.getByLabel(/^ZIP code/).fill("80203");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(heading(page, "Review and create your workspace")).toBeVisible();
    const review = page.getByRole("definition");
    await expect(page.getByText("Review Me Heating")).toBeVisible();
    await expect(page.getByText("12 Aspen Way, Denver, CO 80203")).toBeVisible();
    await expect(page.getByText("Mon–Fri: 9:00 AM–5:00 PM")).toBeVisible();
    expect(await review.count()).toBeGreaterThan(5);
    // Still nothing in the database: reviewing creates nothing.
    const user = await db.query<{ id: string }>("select id from auth_user where email = $1", [email]);
    expect((await db.query("select 1 from organization_memberships where user_id = $1", [user.rows[0].id])).rowCount).toBe(0);
  });
});

test.describe("creating the workspace", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("one transaction creates the organization, its owner, its hours and a first site, and makes it the active workspace", async ({ page, db }) => {
    const name = uniqueName("Pinecrest Air Services");
    const email = await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name, phone: "(303) 555-0188", email: "hello@pinecrest.test", street: "12 Aspen Way", city: "Denver", state: "CO", zip: "80203" });

    const user = (await db.query<{ id: string }>("select id from auth_user where email = $1", [email])).rows[0];
    const organizations = await db.query("select o.* from organizations o join organization_memberships m on m.organization_id = o.id where m.user_id = $1", [user.id]);
    expect(organizations.rowCount).toBe(1);
    const organization = organizations.rows[0];
    expect(organization).toMatchObject({
      name,
      slug: slugOf(name),
      phone: "(303) 555-0188",
      email: "hello@pinecrest.test",
      address_line1: "12 Aspen Way",
      city: "Denver",
      state_region: "CO",
      postal_code: "80203",
      timezone: "America/Denver",
      currency: "USD",
      fixture_set: null,
    });
    expect(organization.onboarding_completed_at).not.toBeNull();

    const membership = await db.query("select role, status from organization_memberships where organization_id = $1", [organization.id]);
    expect(membership.rows).toEqual([{ role: "owner", status: "active" }]);

    const hours = await db.query("select day_of_week, is_open, to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes from organization_business_hours where organization_id = $1 order by day_of_week", [organization.id]);
    expect(hours.rows).toEqual([
      { day_of_week: 0, is_open: false, opens: null, closes: null },
      ...[1, 2, 3, 4, 5].map((day) => ({ day_of_week: day, is_open: true, opens: "09:00", closes: "17:00" })),
      { day_of_week: 6, is_open: false, opens: null, closes: null },
    ]);

    const sites = await db.query("select name, slug, status from sites where organization_id = $1", [organization.id]);
    expect(sites.rows).toEqual([{ name, slug: "main", status: "draft" }]);

    // The person's profile is the name they signed up with.
    expect((await db.query("select full_name from profiles where user_id = $1", [user.id])).rows[0].full_name).toBe("Dana Founder");
  });

  test("the new workspace is empty: no customers, services, jobs, bookings or money, and no sample data", async ({ page, db }) => {
    const owner = await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name: "Blank Slate Cooling" });
    await expect(page.getByText("Your workspace is ready")).toBeVisible();
    await expect(page.getByRole("region", { name: "Key metrics" })).toHaveCount(0);
    await expect(page.getByText("Core Operational Workflows")).toHaveCount(0);
    await expect(page.getByText("Apex")).toHaveCount(0);
    await expect(switcher(page)).toContainText("Blank Slate Cooling");
    // Sidebar counts belong to the sample business.
    await expect(page.getByRole("navigation", { name: "Primary" }).locator("a span.font-mono")).toHaveCount(0);
    // Payments and Quotes & Invoices are the business's own now, and it has none yet: real empty states with zero totals, not "isn't available".
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "No payments recorded yet" })).toBeVisible();
    const paymentTotals = page.getByRole("region", { name: "Payment totals" });
    for (const [label, value] of [["Payments recorded", "0"], ["Amount received", "$0.00"], ["Outstanding invoices", "0"], ["Outstanding balance", "$0.00"]]) {
      await expect(paymentTotals.getByText(label, { exact: true }).locator("xpath=../..")).toContainText(value);
    }
    await page.goto("/quotes-invoices");
    await expect(page.getByText("No quotes yet.")).toBeVisible();
    await page.getByRole("tab", { name: /^Invoices/ }).click();
    await expect(page.getByText("No invoices yet.")).toBeVisible();
    await expect(page.getByText(/isn't available for Blank Slate Cooling yet/)).toHaveCount(0);
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    // Bookings, Jobs and the Schedule are the business's own now, and it has none yet: real empty states.
    await page.goto("/bookings");
    await expect(page.getByText("No bookings yet. Create a booking to get started.")).toBeVisible();
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "No jobs yet" })).toBeVisible();
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Nothing is scheduled yet" })).toBeVisible();
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    // Customers and Services are the business's own now, and it has none yet.
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "No customers yet" })).toBeVisible();
    await page.goto("/services");
    await expect(page.getByRole("heading", { name: "No services configured yet" })).toBeVisible();
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    await expect(page.getByText("AC Repair & Diagnostics")).toHaveCount(0);
    // The team is the owner alone.
    await page.goto("/team");
    const members = page.getByRole("table", { name: "Team members" }).locator("tbody tr");
    await expect(members).toHaveCount(1);
    await expect(members.first()).toContainText("Dana Founder");
    await expect(members.first()).toContainText("Owner");

    // What was stored: the owner's team record and the standard roles, and no customers or Services.
    const counts = await db.query<{ roles: number; members: number; customers: number; services: number; properties: number; equipment: number }>(
      `select (select count(*)::int from team_roles where organization_id = o.id) as roles,
              (select count(*)::int from team_members where organization_id = o.id) as members,
              (select count(*)::int from customers where organization_id = o.id) as customers,
              (select count(*)::int from services where organization_id = o.id) as services,
              (select count(*)::int from customer_properties where organization_id = o.id) as properties,
              (select count(*)::int from equipment where organization_id = o.id) as equipment
       from organizations o join organization_memberships m on m.organization_id = o.id join auth_user u on u.id = m.user_id where u.email = $1`,
      [owner],
    );
    expect(counts.rows).toEqual([{ roles: SYSTEM_ROLES.length, members: 1, customers: 0, services: 0, properties: 0, equipment: 0 }]);
  });

  test("the person is the owner, and Business information, hours and preferences are real and theirs", async ({ page }) => {
    await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name: "Pinecrest Air Services", phone: "(303) 555-0188", email: "hello@pinecrest.test" });
    await expect(page.getByRole("button", { name: /Dana Founder, Owner/ })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByLabel(/^Business name/)).toHaveValue("Pinecrest Air Services");
    await expect(page.getByLabel(/^Phone/)).toHaveValue("(303) 555-0188");
    await expect(page.getByLabel(/^City/)).toHaveValue("Denver");
    await page.goto("/settings/hours");
    await expect(page.getByRole("region", { name: "Hours preview" })).toContainText(/Mon–Fri\s*9:00 AM–5:00 PM/);
    await page.goto("/settings/preferences");
    await expect(page.getByLabel(/^Time zone/)).toHaveValue("America/Denver");
    await page.goto("/settings/profile");
    await expect(page.getByLabel(/^Full name/)).toHaveValue("Dana Founder");
  });

  test("it survives a reload and a fresh login", async ({ page, context }) => {
    const email = await signUp(page);
    await completeOnboarding(page, { name: "Durable Heating" });
    await page.reload();
    await expect(switcher(page)).toContainText("Durable Heating");
    await context.clearCookies();
    await openForm(page, "/login");
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel(/^Password/).fill("Correct-horse-1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(switcher(page)).toContainText("Durable Heating");
  });

  test("pressing Create workspace twice creates one workspace", async ({ page, db }) => {
    const email = await signUp(page);
    await page.getByLabel(/^Business name/).fill("Double Click Air");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Phone/).fill("(303) 555-0188");
    await page.getByLabel(/^Email/).fill("hello@double.test");
    await page.getByLabel(/^Street address/).fill("12 Aspen Way");
    await page.getByLabel(/^City/).fill("Denver");
    await page.getByLabel(/^State/).selectOption("CO");
    await page.getByLabel(/^ZIP code/).fill("80203");
    for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue" }).click();
    const create = page.getByRole("button", { name: "Create workspace" });
    await create.dblclick();
    await expect(page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
    const user = await db.query<{ id: string }>("select id from auth_user where email = $1", [email]);
    expect((await db.query("select 1 from organization_memberships where user_id = $1", [user.rows[0].id])).rowCount).toBe(1);
  });

  test("two businesses with the same name each get their own address", async ({ browser, db, clientAddresses }) => {
    const name = uniqueName("Twin Name Heating");
    const slugs: string[] = [];
    for (let run = 0; run < 2; run++) {
      const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
      const page = waitsForHydration(await context.newPage());
      await signUp(page);
      await completeOnboarding(page, { name });
      await context.close();
    }
    const rows = await db.query<{ slug: string }>("select slug from organizations where name = $1 order by created_at", [name]);
    slugs.push(...rows.rows.map((row) => row.slug));
    expect(slugs).toHaveLength(2);
    expect(slugs[0]).toBe(slugOf(name));
    expect(slugs[1]).toBe(`${slugOf(name)}-2`);
  });

  test("a failure on the server shows a message, keeps what was typed and creates nothing", async ({ page, db, consoleGuard }) => {
    consoleGuard.allow(/ERR_FAILED/);
    const email = await signUp(page);
    await page.getByLabel(/^Business name/).fill("Offline Air");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Phone/).fill("(303) 555-0188");
    await page.getByLabel(/^Email/).fill("hello@offline.test");
    await page.getByLabel(/^Street address/).fill("12 Aspen Way");
    await page.getByLabel(/^City/).fill("Denver");
    await page.getByLabel(/^State/).selectOption("CO");
    await page.getByLabel(/^ZIP code/).fill("80203");
    for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Continue" }).click();
    await page.route("**/onboarding", (route) => (route.request().headers()["next-action"] ? route.abort() : route.continue()));
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByRole("button", { name: "Create workspace" })).toBeEnabled();
    await expect(page.getByText("Offline Air")).toBeVisible();
    const user = await db.query<{ id: string }>("select id from auth_user where email = $1", [email]);
    expect((await db.query("select 1 from organization_memberships where user_id = $1", [user.rows[0].id])).rowCount).toBe(0);
    await page.unroute("**/onboarding");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workspace Overview" })).toBeVisible();
  });
});

test.describe("adding another business", () => {
  test("someone who already has a workspace is sent past set-up unless they ask for another", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/$/);
    await openForm(page, "/onboarding?new=1");
    await expect(page.getByRole("heading", { level: 1, name: "Set up your business" })).toBeVisible();
    await expect(page.getByText("Add another business workspace. Your other workspaces stay as they are.")).toBeVisible();
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a second business becomes the active one and the first is left alone", async ({ browser, db, clientAddresses }) => {
    // A browser of its own, signed in as nobody (a context opened by hand would otherwise start as this worker's owner).
    const context = await browser.newContext({ storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const page = waitsForHydration(await context.newPage());
    const email = await signUp(page, { name: "Two Hats" });
    await completeOnboarding(page, { name: "First Hat Heating" });
    await openForm(page, "/onboarding?new=1");
    await completeOnboarding(page, { name: "Second Hat Cooling" });
    await expect(switcher(page)).toContainText("Second Hat Cooling");

    await switcher(page).click();
    const list = page.getByRole("region", { name: "Workspaces" });
    await expect(list.getByRole("button")).toHaveCount(2);
    await list.getByRole("button", { name: /First Hat Heating/ }).click();
    await expect(switcher(page)).toContainText("First Hat Heating");

    const user = await db.query<{ id: string }>("select id from auth_user where email = $1", [email]);
    const owned = await db.query("select o.name, m.role from organizations o join organization_memberships m on m.organization_id = o.id where m.user_id = $1 order by o.created_at", [user.rows[0].id]);
    expect(owned.rows).toEqual([
      { name: "First Hat Heating", role: "owner" },
      { name: "Second Hat Cooling", role: "owner" },
    ]);
    await context.close();
  });
});
