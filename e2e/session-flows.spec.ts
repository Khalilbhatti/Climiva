/**
 * Phase 8, Part K. One working session, several modules: each test changes something in one module and then follows
 * it through the others by client-side navigation (a full page load would discard the session, which is exactly what
 * the last step of each test checks). Every module reads the same records, so nothing is repeated or left behind.
 */
import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const main = (page: Page) => page.locator("main");
const toast = (page: Page) => page.getByRole("status");
const kpis = (page: Page) => page.getByRole("region", { name: "Key metrics" });
const tabs = (page: Page, name: string) => page.getByRole("tablist", { name }).getByRole("tab");

/** Client-side navigation: keeps the session's in-memory state, as clicking a link does. */
async function go(page: Page, href: string) {
  await page.evaluate((target) => (window as unknown as { next: { router: { push: (to: string) => void } } }).next.router.push(target), href);
  await expect(page).toHaveURL(new RegExp(href.split("?")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

test.describe("a Settings change reaches every module that shows it", () => {
  test("business name and phone: Overview, Website, the public site and the Marketplace listing; a reload keeps them, they are stored", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Business name").fill("Summit HVAC Services");
    await page.getByLabel(/^Phone( [*])?$/).fill("(737) 555-0100");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(toast(page)).toContainText("Business information saved.");

    await go(page, "/");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText("Summit HVAC Services");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText("(737) 555-0100");
    await go(page, "/website/pages");
    await expect(main(page)).toContainText("Summit HVAC Services");
    await go(page, "/website/preview/contact");
    await expect(page.getByTestId("site-frame").locator("footer")).toContainText("Summit HVAC Services");
    await go(page, "/marketplace/preview");
    await expect(page.getByTestId("directory-frame")).toContainText("Summit HVAC Services");
    await expect(page.getByTestId("directory-frame")).toContainText("(737) 555-0100");
    await expect(page.getByTestId("directory-frame")).not.toContainText("Apex Climate");

    await page.reload();
    await expect(page.getByTestId("directory-frame")).toContainText("Summit HVAC Services");
    await expect(page.getByTestId("directory-frame")).toContainText("(737) 555-0100");
  });

  test("business hours: the Overview card, the Website, the Marketplace and Team availability follow the saved hours", async ({ page }) => {
    await page.goto("/settings/hours");
    await page.getByLabel("Monday opening time").selectOption("08:00");
    await page.getByLabel("Monday closing time").selectOption("17:00");
    await page.getByRole("button", { name: "Copy Monday to weekdays" }).click();
    await page.getByRole("switch", { name: "Saturday open" }).click();
    await page.getByRole("button", { name: "Save hours", exact: true }).click();
    await expect(toast(page)).toContainText("Business hours saved");

    await go(page, "/");
    await expect(page.getByRole("region", { name: "Business information" })).toContainText("Mon–Fri: 8:00 AM–5:00 PM");
    await go(page, "/website/preview/contact");
    await expect(page.getByTestId("site-frame")).toContainText(/Mon–Fri\s*8:00 AM–5:00 PM/);
    await go(page, "/marketplace/preview");
    await expect(page.getByTestId("directory-frame")).toContainText("Mon–Fri 8:00 AM–5:00 PM");
    await go(page, "/team/alex-morgan");
    await expect(main(page)).toContainText("Mon–Fri 8:00 AM–5:00 PM");

    await page.reload();
    await expect(main(page)).toContainText("Mon–Fri 8:00 AM–5:00 PM");
  });
});

test.describe("assigning a technician is one change seen in Bookings, Schedule and Jobs", () => {
  test("assigning Elena Rodriguez's visit to Samira Patel", async ({ page }) => {
    await page.goto("/schedule");
    const banner = page.getByRole("region", { name: "Unassigned work" });
    await expect(banner).toContainText("Unassigned · 2");
    await page.getByRole("button", { name: "Assign technician to Elena Rodriguez" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign technician" });
    await dialog.getByRole("radio", { name: /^Samira Patel/ }).check();
    await dialog.getByRole("button", { name: "Save assignment" }).click();
    await expect(banner).toContainText("Unassigned · 1");

    await go(page, "/jobs");
    await expect(page.getByRole("table", { name: "Active jobs" }).locator("tbody tr").filter({ hasText: "JB-198" })).toContainText("Samira Patel");
    await expect(page.getByRole("button", { name: "Assign technician to job JB-198" })).toHaveCount(0);

    await go(page, "/bookings?booking=BK-1035");
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Samira Patel");

    await go(page, "/schedule");
    await expect(page.locator("#event-JB-198")).toContainText("Samira");
    await expect(page.getByRole("region", { name: "Unassigned work" })).toContainText("Unassigned · 1");

    // The assignment is stored: a reload keeps it, in every screen.
    await page.reload();
    await expect(page.getByRole("region", { name: "Unassigned work" })).toContainText("Unassigned · 1");
    await expect(page.locator("#event-JB-198")).toContainText("Samira");
  });
});

test.describe("completing a job reaches the customer and Reviews", () => {
  test("JB-201 becomes Completed work for David Chen and a job he can be asked to review", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const complete = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await complete.getByLabel("Technician debrief & resolution notes").fill("Heat pump diagnosed and repaired.");
    await complete.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);

    await go(page, "/jobs?tab=completed");
    await expect(tabs(page, "Job lists")).toHaveText([/^Active\s*3$/, /^Upcoming\s*2$/, /^Completed\s*8$/]);
    await expect(page.getByRole("table", { name: "Completed jobs" }).locator("tbody tr").filter({ hasText: "JB-201" })).toContainText("David Chen");

    await go(page, "/customers/david-chen");
    await expect(main(page)).toContainText("JB-201");

    // The Overview's Completed Jobs is the workspace aggregate (18); it is a baseline, not a count of the sample.
    await go(page, "/");
    await expect(kpis(page)).toContainText("18");

    await go(page, "/reviews");
    await page.getByRole("button", { name: "Request review" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a review" });
    await dialog.getByLabel("Customer").selectOption("david-chen");
    await expect(dialog.getByLabel("Related job (optional)")).toHaveValue("JB-201");

    // The completion is stored: a reload keeps it.
    await page.reload();
    await go(page, "/jobs?tab=completed");
    await expect(tabs(page, "Job lists")).toHaveText([/^Active\s*3$/, /^Upcoming\s*2$/, /^Completed\s*8$/]);
  });
});

test.describe("recording #PAY-1009 reaches Payments, the invoice, the Overview and Analytics", () => {
  test("the $300 on #INV-1050 moves every total together, and a reload restores the baseline", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByRole("radio", { name: /INV-1050/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    const done = page.getByRole("dialog", { name: "Payment recorded" });
    await expect(done).toContainText("Payment #PAY-1009 recorded");
    await done.getByRole("button", { name: "Close", exact: true }).click();

    await expect(main(page)).toContainText("$2,430.00");
    await go(page, "/quotes-invoices/invoices/INV-1050");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$0.00");
    await expect(page.getByRole("table", { name: "Payments for this invoice" })).toContainText("PAY-1009");
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

    await go(page, "/");
    await expect(kpis(page)).toContainText("$2,430");
    await expect(kpis(page)).toContainText("8 recorded non-voided payments");
    await expect(kpis(page)).toContainText("$6,240");

    await go(page, "/analytics?tab=financial");
    await expect(main(page)).toContainText("$2,430");

    await go(page, "/payments?tab=outstanding");
    await expect(main(page)).toContainText("$380.00");

    await page.reload();
    await go(page, "/");
    await expect(kpis(page)).toContainText("$2,130");
    await expect(kpis(page)).toContainText("7 recorded non-voided payments");
  });
});

test.describe("scheduling Sarah's included visit reaches Plans, Bookings and Schedule", () => {
  test("#BK-1048 is one booking everywhere, with no Job, Invoice or Payment", async ({ page }) => {
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
    const done = page.getByRole("dialog", { name: "Maintenance visit scheduled" });
    await expect(done).toContainText("Booking #BK-1048 confirmed");
    await done.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("table", { name: "Plan service history" })).toContainText("BK-1048");

    await go(page, "/bookings?tab=upcoming&booking=BK-1048");
    const drawer = page.getByRole("complementary", { name: "Booking details" });
    await expect(drawer).toContainText("Marcus Vance");
    await expect(drawer.getByRole("link", { name: /Comfort Care/ })).toBeVisible();
    await expect(drawer.getByRole("link", { name: /View job/ })).toHaveCount(0);

    await go(page, "/schedule?view=day&date=2024-11-19&event=BK-1048");
    await expect(page.getByRole("complementary", { name: "Booking details" })).toContainText("Marcus Vance");

    await go(page, "/jobs");
    await expect(main(page)).not.toContainText("BK-1048");
    await go(page, "/payments");
    await expect(main(page)).toContainText("$2,130.00");

    await page.reload();
    await expect(main(page)).not.toContainText("BK-1048");
  });
});

test.describe("replying to a review reaches the Reviews counts", () => {
  test("Sarah Mitchell's review moves to Responded, and the total and average hold", async ({ page }) => {
    await page.goto("/reviews");
    await expect(tabs(page, "Review views")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*3$/, /^Responded\s*9$/]);
    await page.getByRole("button", { name: "Reply to review from Sarah Mitchell" }).click();
    await page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click();
    await expect(toast(page)).toContainText("Response posted.");
    await expect(tabs(page, "Review views")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*2$/, /^Responded\s*10$/]);

    await go(page, "/reviews/rev-sarah-mitchell");
    await expect(main(page)).toContainText("Responded");
    await expect(page.getByRole("link", { name: /JB-204/ }).first()).toBeVisible();

    await go(page, "/customers/sarah-mitchell");
    await expect(main(page)).toContainText("Sarah Mitchell");

    await page.reload();
    await go(page, "/reviews");
    await expect(tabs(page, "Review views")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*3$/, /^Responded\s*9$/]);
  });
});

test.describe("cancelling a scheduled campaign keeps it as a Draft", () => {
  test("Fall maintenance reminder leaves Scheduled, joins Drafts, and nothing is sent", async ({ page }) => {
    await page.goto("/marketing");
    await expect(tabs(page, "Campaign views")).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
    await go(page, "/marketing/cmp-fall-maintenance-reminder");
    await page.getByRole("button", { name: "Cancel scheduled send" }).click();
    await page.getByRole("dialog", { name: "Cancel scheduled campaign?" }).getByRole("button", { name: "Cancel scheduled send" }).click();
    await expect(toast(page)).toContainText("Scheduled send cancelled. The campaign is now a Draft.");

    await go(page, "/marketing");
    await expect(tabs(page, "Campaign views")).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*3$/, /^Scheduled\s*0$/, /^Sent\s*8$/]);
    await expect(page.getByRole("table", { name: "Campaigns" }).locator("tbody tr").filter({ hasText: "Fall maintenance reminder" })).toContainText("Draft");

    await page.reload();
    await expect(tabs(page, "Campaign views")).toHaveText([/^All campaigns\s*11$/, /^Drafts\s*2$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);
  });
});

test.describe("hiding and publishing the Marketplace listing is what the public page shows", () => {
  test("hidden: the public page says so and lists nothing; published again: the five Services are back", async ({ page }) => {
    await page.goto("/marketplace/edit");
    await page.getByRole("switch", { name: "Listing visible" }).click();
    await page.getByRole("dialog", { name: "Hide Marketplace listing?" }).getByRole("button", { name: "Hide listing" }).click();
    await expect(toast(page)).toContainText("Marketplace listing hidden.");

    await go(page, "/marketplace/preview");
    await expect(page.getByRole("heading", { level: 1, name: "This listing isn't available" })).toBeVisible();
    await expect(page.getByTestId("directory-frame")).toContainText("Apex Climate Heating & Air is not listed in the Climvia Marketplace right now.");
    await expect(page.getByTestId("directory-frame")).not.toContainText("AC Repair & Diagnostics");
    await expect(primaryNav(page)).toHaveCount(0);

    await go(page, "/marketplace");
    await page.getByRole("button", { name: "Publish listing" }).click();
    await expect(toast(page)).toContainText("Marketplace listing published.");
    await go(page, "/marketplace/preview");
    const frame = page.getByTestId("directory-frame");
    await expect(frame).toContainText("AC Repair & Diagnostics");
    await expect(frame).not.toContainText("Emergency No-Heat / No-Cool");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
