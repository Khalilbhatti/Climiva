/**
 * Phase 19F, the product's main journeys as a person walks them, by what is on the screen:
 *
 *   a new owner       Landing → Sign up → Set-up → Overview → add a Service → add a Customer → Marketplace Listing → publish
 *   a returning owner Overview → a booking waiting for an answer → the Customer → the Job → the money
 *   a review          a finished Job → the Customer → Request review → the customer's public review → the business's Reviews
 *   a visitor         Marketplace → provider → a request that does not look like a booking (on a phone)
 *   a platform admin  Sign in → Organizations → Marketplace → Reviews, in a console that does not look like a workspace
 *
 * and what changes for people who may not manage: a team member is shown nothing to create.
 *
 * What these hold is the guidance, not the data: the Getting started count is the real state of the business (never ticked by a click), a booking that is only
 * a request never looks confirmed, and nothing offered is something the server would refuse.
 */
import { randomBytes } from "node:crypto";
import type { Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { NAV_GROUPS } from "../src/config/navigation";
import { makePlatformAdmin } from "./platform-admin-helpers";
import { SAMPLE_SERVICES } from "./marketplace-helpers";
import { NOT_SIGNED_IN, ORIGIN, completeOnboarding, expect, expectAccessible, hydrated, signUp, test } from "./saas";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const gettingStarted = (page: Page) => page.getByRole("region", { name: "Getting started" });
const address = () => `fd00:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let owner: ReturnType<typeof adminDb>;
test.beforeAll(() => {
  owner = adminDb();
});
test.afterAll(async () => {
  await owner.pool.end();
});

/* ───────────────────────────────── a new owner ───────────────────────────────── */

test.describe("a new owner", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 150_000 });

  test("goes from the landing page to a published Marketplace Listing, and Getting started counts only what is really there", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "List Your Business" }).first().click();
    await expect(page).toHaveURL(/\/signup$/);
    await signUp(page, { name: "Pat Newcomer" });
    await completeOnboarding(page, { name: "Journey Heating & Air" });

    // The first screen is plain: what this is, how far along it is, and nothing made up.
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("What needs your attention today at Journey Heating & Air.")).toBeVisible();
    await expect(gettingStarted(page).getByText("0 of 5 completed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today" })).toHaveCount(0);
    await expectAccessible(page);

    // 1. A Service, from the step itself: it opens the real wizard.
    await gettingStarted(page).getByRole("link", { name: /^Add your first service/ }).click();
    await expect(page).toHaveURL(/\/services\?new=1$/);
    const wizard = page.getByRole("dialog", { name: "Add new service" });
    await wizard.getByLabel("Service name").fill("Journey Tune-Up");
    await wizard.getByLabel("Customer-facing description").fill("A yearly tune-up for your system.");
    await wizard.getByRole("button", { name: /^Next: How customers book/ }).click();
    await wizard.getByRole("radio", { name: /^Instant booking/ }).check();
    await wizard.getByRole("button", { name: /^Next: Pricing/ }).click();
    await wizard.getByLabel("Fee amount (USD)").or(wizard.getByLabel("Price (USD)")).fill("75");
    await wizard.getByRole("button", { name: /^Next: Where customers see it/ }).click();
    await wizard.getByRole("button", { name: /^Next: Review/ }).click();
    await wizard.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The step's link is spent: the address is the plain list, so a reload does not open the wizard again.
    await expect(page).toHaveURL(/\/services$/);

    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(gettingStarted(page).getByText("1 of 5 completed")).toBeVisible();
    await expect(gettingStarted(page).getByRole("link", { name: /Add your first service \(done\)/ })).toBeVisible();

    // 2. A Customer, the same way.
    await gettingStarted(page).getByRole("link", { name: /^Add your first customer/ }).click();
    await expect(page).toHaveURL(/\/customers\?new=1$/);
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await dialog.getByLabel(/^Full name/).fill("Dana Homeowner");
    await dialog.getByLabel("Email address").fill("dana@example.test");
    await dialog.getByLabel("Phone number").fill("(303) 555-0142");
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(page).toHaveURL(/\/customers\/dana-homeowner$/);
    // On her page the next thing to do is there; there is no booking yet, so there is no review to ask for.
    await expect(page.getByRole("link", { name: "Create booking" })).toHaveAttribute("href", "/bookings?new=1&customer=dana-homeowner");
    await expect(page.getByRole("button", { name: "Request review" })).toHaveCount(0);

    // 3. The Marketplace Listing: set up, then publish.
    await primaryNav(page).getByRole("link", { name: "Marketplace Listing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace Listing" })).toBeVisible();
    await page.getByRole("link", { name: /Set up listing/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Set up Marketplace Listing" })).toBeVisible();
    // Nothing is chosen for the owner: publishing with no Service is refused in words, and choosing one is what the owner does.
    await page.getByRole("button", { name: "Save & publish listing" }).click();
    await expect(page.getByText("Select at least one Service to show.")).toBeVisible();
    await page.getByRole("checkbox", { name: "Show Journey Tune-Up" }).check();
    await page.getByRole("button", { name: "Save & publish listing" }).click();
    await expect(page).toHaveURL(/\/marketplace-listing$/);
    // A published listing's main action is to look at it as a homeowner does.
    const profile = page.getByRole("link", { name: "View public profile" });
    await expect(profile).toHaveAttribute("href", /^\/listings\//);

    // The count follows the records: a Service, a Customer and a published Listing are three of the five.
    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(gettingStarted(page).getByText("3 of 5 completed")).toBeVisible();
    await expect(gettingStarted(page).getByRole("link", { name: /^Add your team/ })).toBeVisible();

    // Hiding the list is this browser's choice for this business; the steps themselves stay what they are.
    await gettingStarted(page).getByRole("button", { name: "Hide Getting started" }).click();
    await expect(gettingStarted(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(gettingStarted(page)).toHaveCount(0);
  });
});

/* ───────────────────────────────── a returning owner ───────────────────────────────── */

test.describe("a returning owner", () => {
  test.describe.configure({ timeout: 120_000 });

  test("works the day from the Overview: what is waiting, the customer, the job, the money", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    // What needs an answer is one click away, and says how many.
    const attention = page.getByRole("region", { name: "Needs your attention" });
    const waiting = attention.getByRole("link", { name: /booking requests? (is|are) waiting for your answer/ });
    await expect(waiting).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: /^Bookings/ })).toContainText("waiting for an answer");
    await waiting.click();
    await expect(page).toHaveURL(/\/bookings\?tab=requests$/);
    await page.getByRole("button", { name: /^Review booking/ }).first().click();
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await drawer.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByRole("status")).toContainText(/confirmed/);
    // It is confirmed, so the next step is said in words, not guessed.
    await expect(drawer).toContainText("Assign a technician, then create a job when it is time to do the work.");

    // The Customer: what to do next sits at the top of the page.
    await primaryNav(page).getByRole("link", { name: "Customers" }).click();
    await page.getByRole("link", { name: "Sarah Mitchell" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Sarah Mitchell" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create booking" })).toHaveAttribute("href", "/bookings?new=1&customer=sarah-mitchell");
    for (const heading of ["Properties (1)", "Equipment", "Jobs", "Contact", "Maintenance plan"]) await expect(page.getByRole("heading", { name: heading })).toBeVisible();

    // The Job, from the day's own list.
    await page.goto("/");
    await page.getByRole("region", { name: "Today" }).getByRole("listitem").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/jobs\/JB-\d+$/);

    // The money: what has not been paid in full is a click from the Overview, and a document knows the others it belongs to.
    await page.goto("/");
    await page.getByRole("region", { name: "Needs your attention" }).getByRole("link", { name: /invoices? (has|have) not been paid in full/ }).click();
    await expect(page).toHaveURL(/\/quotes-invoices\?tab=invoices$/);
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByRole("region", { name: "Related records" })).toBeVisible();
  });
});

/* ───────────────────────────────── a review ───────────────────────────────── */

test.describe("a review", () => {
  test.describe.configure({ timeout: 120_000 });

  test("is asked for from the customer once the work is done, answered on a public page, and read by the business", async ({ page, browser }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const complete = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await complete.getByLabel("Technician debrief & resolution notes").fill("Heat pump diagnosed and repaired.");
    await complete.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);

    // Now it is: the customer's page offers it, and the dialog is for that customer.
    await page.goto("/customers/david-chen");
    await hydrated(page);
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await expect(dialog.getByLabel("Customer")).toContainText("David Chen");
    await dialog.getByRole("button", { name: "Send review request" }).click();
    const ready = page.getByRole("dialog", { name: "Review link ready" });
    const link = await ready.getByLabel("Review link").inputValue();
    await ready.getByRole("button", { name: "Done" }).click();

    // The customer's page, without signing in.
    const visitor = await browser.newContext({ baseURL: ORIGIN, storageState: NOT_SIGNED_IN, extraHTTPHeaders: { "x-forwarded-for": address() } });
    try {
      const guest = await visitor.newPage();
      await guest.goto(link);
      await guest.getByLabel("5 stars").check({ force: true });
      await guest.getByLabel("Your review").fill("Explained the repair and left everything clean.");
      await guest.getByRole("button", { name: "Send review" }).click();
      await expect(guest.getByText("Thank you. Your review was sent.")).toBeVisible();
    } finally {
      await visitor.close();
    }

    // It is in the business's Reviews, from the customer, waiting for a reply.
    await page.goto("/reviews");
    await expect(page.getByRole("article", { name: "Review from David Chen" }).first()).toContainText("Explained the repair and left everything clean.");
  });
});

/* ───────────────────────────────── a visitor, on a phone ───────────────────────────────── */

test.describe("a visitor on a phone", () => {
  test.use({ storageState: NOT_SIGNED_IN, viewport: { width: 390, height: 844 } });
  test.describe.configure({ timeout: 120_000 });

  test("finds a provider and asks for an appointment, and what comes back is a request, not a booking", async ({ page, workerTenant }) => {
    // The Marketplace opens and fits a phone. (Finding a provider by a search is held by the discovery specs; this journey starts from the provider's profile.)
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Find HVAC service in your area" })).toBeVisible();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);

    await page.goto(`/listings/${workerTenant.listingSlug}`);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);

    // The way to book is on the profile, in the words of how this Service is booked.
    await page.getByRole("region", { name: "Services" }).getByRole("link", { name: /AC Repair & Diagnostics/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/listings/${workerTenant.listingSlug}/book/${SAMPLE_SERVICES.repair}`));
    await page.getByLabel("Date", { exact: true }).fill("2024-10-29");
    await page.getByRole("radio", { name: /^Midday/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/^Full name/).fill("Casey Visitor");
    await page.getByLabel(/^Phone number/).fill("(512) 555-0113");
    await page.getByLabel(/^Email address/).fill(`visitor-${randomBytes(3).toString("hex")}@example.test`);
    await page.getByLabel(/^Service address/).fill("5 Barton Hills Dr, Austin, TX 78704");
    await page.getByLabel(/primary cooling issue/).selectOption("Blowing warm air");
    await expect(page.getByText("This is a request, not a confirmed visit. No payment is taken today.")).toBeVisible();
    await page.getByRole("button", { name: "Submit appointment request" }).click();

    // A request says it is a request, in words and in colour: it is not the green "confirmed" of an instant booking.
    const done = page.getByRole("region", { name: "Appointment request submitted" });
    await expect(done).toBeVisible();
    await expect(page.getByText("Request received")).toBeVisible();
    await expect(page.getByText("Booking confirmed")).toHaveCount(0);
    await expect(page.getByRole("status")).not.toHaveClass(/bg-positive-soft/);
    await expect(page.getByText("The team reviews availability and confirms the time with you by email or phone.")).toBeVisible();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});

/* ───────────────────────────────── the platform's console ───────────────────────────────── */

test.describe("a platform administrator", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 120_000 });

  test("signs in and moves through Organizations, Marketplace and Reviews in a console that does not look like a workspace", async ({ page }) => {
    const admin = await makePlatformAdmin("p19fux", owner.db, owner.pool);
    await page.goto("/platform-admin/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);

    // It is a console, and says so: its own navigation, no business, none of the product's.
    const nav = page.getByRole("navigation", { name: "Platform" });
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Organizations", "Users", "Marketplace Listings", "Reviews / Moderation", "System"]);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByTitle("Switch workspace")).toHaveCount(0);
    await expect(page.getByText("Super administrator").first()).toBeVisible();
    // Its rail is dark where a business's workspace is light: the two are told apart at a glance.
    const rail = await page.locator("header").first().evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(rail).toBe("rgb(31, 41, 55)");

    for (const [label, path] of [["Organizations", "/platform-admin/organizations"], ["Marketplace Listings", "/platform-admin/marketplace"], ["Reviews / Moderation", "/platform-admin/reviews"]] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      await expectAccessible(page);
    }
  });
});

/* ───────────────────────────────── who is offered what ───────────────────────────────── */

test.describe("a team member who may only look", () => {
  test("is offered nothing to create: no Getting started, no quick actions, no New menu, no booking or review button", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    // What there is to read is there.
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Needs your attention" })).toBeVisible();
    // What there is to change is not offered.
    await expect(gettingStarted(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Quick actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create booking" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);

    await page.goto("/customers/sarah-mitchell");
    await expect(page.getByRole("heading", { level: 1, name: "Sarah Mitchell" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create booking" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request review" })).toHaveCount(0);

    await page.goto("/website");
    await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit website" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
  });
});

/* ───────────────────────────────── finding things ───────────────────────────────── */

test.describe("the navigation and the New menu", () => {
  test("group the product the way an owner thinks of it, keep every module reachable, and name the Marketplace Listing for what it is", async ({ openAs }) => {
    const { page } = await openAs("alex");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const nav = primaryNav(page);

    // The same groups, in the same order, with the same modules in each.
    const labels = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toEqual(["Overview", "Bookings", "Schedule", "Jobs", "Customers", "Services", "Team", "Maintenance Plans", "Quotes & Invoices", "Payments", "Website", "Marketplace Listing", "Reviews", "Marketing", "Analytics"]);
    for (const heading of ["Work", "Business", "Money", "Growth", "Insights"]) await expect(nav.getByRole("heading", { name: heading })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Marketplace Listing" })).toHaveAttribute("href", "/marketplace-listing");
    await expect(nav.getByRole("link", { name: "Marketplace", exact: true })).toHaveCount(0);
    // On a window of ordinary height the last group is in view, and on a short one it is a scroll away, never lost.
    await expect(nav.getByRole("link", { name: "Analytics" })).toBeInViewport();
    await page.setViewportSize({ width: 1280, height: 600 });
    await nav.getByRole("link", { name: "Analytics" }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(nav.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
  });

  test("New starts the common things from any page, and a link that opens one leaves the plain address behind", async ({ openAs }) => {
    const { page } = await openAs("alex");
    await page.goto("/reviews");
    await hydrated(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const menu = page.getByRole("region", { name: "Create new" });
    await expect(menu.getByRole("link")).toHaveText([/^Booking/, /^Customer/, /^Service/, /^Payment/]);
    await menu.getByRole("link", { name: /^Customer/ }).click();
    await expect(page).toHaveURL(/\/customers\?new=1$/);
    const dialog = page.getByRole("dialog", { name: "Add customer" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/customers$/);
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
