/**
 * Phase 14: Analytics, the Overview and the sidebar counts as a person sees them, worked out by the server from the active business's
 * records in PostgreSQL (plus the sample business's imported history).
 *
 * Each test signs in as the owner of the worker's own copy of the Apex business (restored before every test), changes something
 * through the screens and follows it into Analytics, the Overview and the sidebar; the checks that read the standing Apex and
 * Northstar businesses only read. Switching business, the URL's tab and range, the downloaded files and a brand-new business are
 * checked here too.
 */
import { readFileSync } from "node:fs";
import type { Page } from "playwright/test";
import { NOT_SIGNED_IN, completeOnboarding, expect, hydrated, signUp, switchWorkspace, test } from "./saas";

const kpis = (page: Page) => page.getByRole("region", { name: "Key metrics" });
const main = (page: Page) => page.getByRole("main");
const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name });
const section = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
const rangeButton = (page: Page) => page.getByRole("button", { name: /^Date range:/ });
const exportButton = (page: Page) => page.getByRole("button", { name: "Export report" });
const sidebarCount = (page: Page, module: string) => primaryNav(page).getByRole("link", { name: new RegExp(`^${module}`) });

test.describe("what a person does reaches Analytics, the Overview and the sidebar", () => {
  test("a new booking adds one booking to this month's Bookings everywhere, and is stored", async ({ page, db, workerTenant }) => {
    await page.goto("/bookings?new=1");
    const wizard = page.getByRole("dialog", { name: "Create booking" });
    await wizard.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await wizard.getByRole("button", { name: /^Next: Service & property/ }).click();
    await wizard.getByRole("radio", { name: /^AC Repair & Diagnostics/ }).check();
    await wizard.getByRole("button", { name: /^Next: Date & time/ }).click();
    await wizard.getByRole("radio", { name: /^Midday/ }).check();
    await wizard.getByRole("button", { name: /^Next: Assignment/ }).click();
    await wizard.getByRole("radio", { name: /^Marcus Vance/ }).check();
    await wizard.getByRole("button", { name: /^Next: Review/ }).click();
    await wizard.getByRole("button", { name: "Create booking" }).click();
    await expect(page.getByRole("dialog", { name: "Booking created" })).toBeVisible();

    const created = (await db.query("select number, status, to_char(service_date, 'YYYY-MM-DD') as day from bookings where organization_id = $1 order by created_at desc, number desc limit 1", [workerTenant.organizationId])).rows[0];
    const inOctober = created.day >= "2024-10-01" && created.day <= "2024-10-31";
    const bookings = inOctober ? "25" : "24";

    await page.goto("/");
    await expect(kpis(page)).toContainText(new RegExp(`Bookings\\s*${bookings}`));
    await page.goto("/analytics");
    await expect(kpis(page)).toContainText(new RegExp(`Bookings\\s*${bookings}`));
    await page.getByRole("tab", { name: "Bookings" }).click();
    await expect(section(page, "How many bookings are we getting?")).toContainText(`${bookings} in this period`);
    // The sidebar's Bookings count is the requests waiting for an answer (not a total), so it agrees with the Requests tab and the Overview's attention list.
    const waiting = Number((await db.query("select count(*) as n from bookings where organization_id = $1 and status = 'pending'", [workerTenant.organizationId])).rows[0].n);
    const expectWaiting = () => (waiting > 0 ? expect(sidebarCount(page, "Bookings")).toContainText(`${waiting} waiting for an answer`) : expect(sidebarCount(page, "Bookings")).not.toContainText(/\d/));
    await expectWaiting();
    // The booking is stored, so a reload keeps every figure.
    await page.goto("/");
    await expect(kpis(page)).toContainText(new RegExp(`Bookings\\s*${bookings}`));
    await expectWaiting();
  });

  test("completing a job moves Completed Jobs, the Jobs panel and the sidebar to 19, and Jobs scheduled to 3", async ({ page }) => {
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const complete = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await complete.getByLabel("Technician debrief & resolution notes").fill("Heat pump diagnosed and repaired.");
    await complete.getByRole("button", { name: "Complete job" }).click();
    await expect(page.getByRole("button", { name: "Complete job" })).toHaveCount(0);

    await page.goto("/analytics");
    await expect(kpis(page)).toContainText(/Jobs completed\s*19/);
    await page.goto("/analytics?tab=jobs");
    const jobs = section(page, "What is still scheduled or in progress?");
    await expect(jobs).toContainText("24 Jobs in this period in all");
    await expect(jobs.getByText("Completed", { exact: true }).locator("..")).toContainText("19");
    await expect(jobs.getByText("Scheduled", { exact: true }).locator("..")).toContainText("3");
    await expect(page.getByText("JB-201").first()).toBeVisible();
    await page.goto("/");
    await expect(kpis(page)).toContainText("19");
    // Jobs carry no count in the sidebar: what a person acts on there is a booking waiting for an answer.
    await expect(sidebarCount(page, "Jobs")).not.toContainText(/\d/);
  });

  test("recording $300 on INV-1050 and voiding it again: received, outstanding, the payment count and the invoice statuses move together and come back", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByRole("radio", { name: /INV-1050/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Payment recorded" }).getByRole("button", { name: "Close", exact: true }).click();

    await page.goto("/analytics?tab=revenue");
    await expect(section(page, "What has been paid?")).toContainText(/Payments recorded\s*8/);
    await expect(section(page, "What has been paid?")).toContainText(/Amount received\s*\$2,430/);
    await expect(section(page, "What is still outstanding?")).toContainText(/Outstanding balance\s*\$380/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Paid\s*13/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Partially paid\s*1/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$6,240/);
    await page.goto("/");
    await expect(kpis(page)).toContainText("$2,430");

    // Void it: every figure goes back to the approved ones, and the voided payment is listed and left out.
    await page.goto("/payments/PAY-1009");
    await page.getByRole("button", { name: "Void payment" }).click();
    const voiding = page.getByRole("dialog", { name: "Void Payment #PAY-1009?" });
    await voiding.getByLabel("Reason for voiding").selectOption("Incorrect amount");
    await voiding.getByRole("button", { name: "Void payment" }).click();
    await expect(page.getByRole("dialog", { name: "Payment voided" })).toBeVisible();

    await page.goto("/analytics?tab=revenue");
    await expect(section(page, "What has been paid?")).toContainText(/Payments recorded\s*7/);
    await expect(section(page, "What has been paid?")).toContainText(/Amount received\s*\$2,130/);
    await expect(section(page, "What has been paid?")).toContainText(/Voided payments\s*2/);
    await expect(section(page, "What is still outstanding?")).toContainText(/Outstanding balance\s*\$680/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Paid\s*12/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Partially paid\s*2/);
  });

  test("replying to a review and creating a campaign are reported where they belong: the Reviews and Marketing screens move, Analytics' own tabs do not", async ({ page }) => {
    await page.goto("/reviews");
    await page.getByRole("button", { name: "Reply to review from Sarah Mitchell" }).click();
    await page.getByRole("dialog", { name: "Reply to review" }).getByRole("button", { name: "Post response" }).click();
    await expect(page.getByRole("status")).toContainText("Response posted.");
    await page.goto("/reviews");
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*12$/, /^Awaiting reply\s*2$/, /^Responded\s*10$/]);
    await expect(main(page)).toContainText("4.7");

    await page.goto("/marketing/new");
    await page.getByLabel(/^Campaign name/).fill("Report check");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL("/marketing/cmp-report-check");
    await page.goto("/marketing");
    await expect(page.getByRole("tablist", { name: "Campaign views" }).getByRole("tab")).toHaveText([/^All campaigns\s*12$/, /^Drafts\s*3$/, /^Scheduled\s*1$/, /^Sent\s*8$/]);

    // Analytics' four tabs are about operations and money: none of this is in them.
    await page.goto("/analytics");
    await expect(kpis(page)).toContainText(/Bookings\s*24/);
  });
});

test.describe("the URL keeps the tab and the range", () => {
  test("a tab and a range survive a reload and a link, and changing the range changes every figure on every tab", async ({ page }) => {
    await page.goto("/analytics?tab=revenue&range=this-quarter");
    await expect(tab(page, "Revenue")).toHaveAttribute("aria-selected", "true");
    await expect(rangeButton(page)).toContainText("Oct 1 – Dec 31, 2024");
    await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$6,240/);
    await page.reload();
    await expect(tab(page, "Revenue")).toHaveAttribute("aria-selected", "true");
    await expect(rangeButton(page)).toContainText("Oct 1 – Dec 31, 2024");

    // A range with no invoices: the same tab, the same URL parameters, no stale Oct figures.
    await page.goto("/analytics?tab=revenue&range=custom&from=2024-10-10&to=2024-10-20");
    await expect(page.getByText(/Imported history for/)).toBeVisible();
    await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$0/);
    await expect(section(page, "What have we quoted?")).toContainText(/Total quoted value\s*\$195/);
    await tab(page, "Bookings").click();
    await expect(page).toHaveURL(/tab=bookings$|tab=bookings&/);
    await expect(page).toHaveURL(/range=custom&from=2024-10-10&to=2024-10-20/);
    await expect(section(page, "How many bookings are we getting?")).toContainText("0 in this period");

    // The picker changes the range and keeps the tab.
    await rangeButton(page).click();
    await page.getByRole("dialog", { name: "Select date range" }).getByRole("radio", { name: /^This month/ }).check();
    await page.getByRole("dialog", { name: "Select date range" }).getByRole("button", { name: "Apply range" }).click();
    await expect(page).toHaveURL(/tab=bookings/);
    await expect(section(page, "How many bookings are we getting?")).toContainText("24 in this period");
  });

  test("the range is read from the business's own calendar: a new business's this month is the real month, not October 2024", async ({ openAs }) => {
    // Northstar keeps its own clock (the real date), so its default month has nothing, and October 2024 is asked for by date.
    const { page } = await openAs("taylor");
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "No activity for this period" })).toBeVisible();
    await expect(rangeButton(page)).not.toContainText("Oct 1 – Oct 31, 2024");
    await page.goto("/analytics?range=custom&from=2024-10-01&to=2024-10-31");
    await expect(kpis(page)).toContainText(/Bookings\s*6/);
  });
});

test.describe("tenant switching recalculates everything", () => {
  test("an admin of both businesses sees each one's figures on every tab, never a mixture, and the Overview and the sidebar follow", async ({ openAs }) => {
    test.setTimeout(90_000);
    const { page } = await openAs("casey");
    await page.goto("/");
    const toApex = () => switchWorkspace(page, /Apex/);
    const toNorthstar = () => switchWorkspace(page, /Northstar/);
    const active = await page.getByTitle("Switch workspace").innerText();
    if (!active.includes("Apex")) await toApex();

    await page.goto("/analytics");
    await expect(kpis(page)).toContainText(/Bookings\s*24/);
    await expect(kpis(page)).toContainText("$6,240");
    await page.getByRole("tab", { name: "Bookings" }).click();
    await expect(page.getByRole("table", { name: "Service activity" })).toContainText("AC Repair & Diagnostics");
    await expect(sidebarCount(page, "Bookings")).toContainText("waiting for an answer");

    await toNorthstar();
    await page.goto("/analytics?range=custom&from=2024-10-01&to=2024-10-31");
    await expect(kpis(page)).toContainText(/Bookings\s*6/);
    await expect(kpis(page)).toContainText("$369");
    for (const [name, check] of [
      ["Overview", async () => { await expect(main(page)).not.toContainText("AC Repair & Diagnostics"); await expect(main(page)).toContainText("Cooling Diagnostic Visit"); }],
      ["Bookings", async () => { await expect(section(page, "How many bookings are we getting?")).toContainText("6 in this period"); await expect(page.getByRole("table", { name: "Service activity" })).toContainText("Furnace Tune-Up"); }],
      ["Jobs", async () => { await expect(section(page, "What is still scheduled or in progress?")).toContainText("3 Jobs in this period in all"); }],
      ["Revenue", async () => { await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$369/); await expect(section(page, "What have we quoted?")).toContainText(/Total quoted value\s*\$223/); }],
      ["Customer retention", async () => { await expect(section(page, "How many customers are on a Maintenance Plan?")).toContainText(/Active plans\s*1/); }],
    ] as const) {
      await page.getByRole("tab", { name }).click();
      await check();
    }
    expect(await main(page).innerText()).not.toContain("$6,240");

    // Back to Apex: the approved figures return, and the URL's tab and range are replaced by the Overview (a business switch is a page load).
    await toApex();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(kpis(page)).toContainText(/Bookings\s*24/);
    await page.goto("/analytics?tab=revenue");
    await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$6,240/);
  });

  test("a member of Apex reads Analytics too, and a business's figures are never read from another business's page", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/analytics");
    await expect(kpis(page)).toContainText(/Bookings\s*24/);
    await expect(exportButton(page)).toBeEnabled();
    const { page: taylor } = await openAs("taylor");
    await taylor.goto("/analytics?range=custom&from=2024-10-01&to=2024-10-31");
    expect(await main(taylor).innerText()).not.toContain("Apex");
    expect(await main(taylor).innerText()).not.toContain("$6,240");
  });
});

test.describe("the exported file is the report on screen", () => {
  test("the CSV of the default view carries the approved figures, and the PDF is named for the same range", async ({ page }) => {
    await page.goto("/analytics");
    await exportButton(page).click();
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog", { name: "Export Analytics report" }).getByRole("button", { name: "Export report" }).click()]);
    expect(csv.suggestedFilename()).toBe("climvia-analytics-2024-10-01-to-2024-10-31.csv");
    const text = readFileSync((await csv.path())!, "utf8");
    for (const line of ["Report,Business,Apex Climate Heating & Air", "Report,Prepared on,2024-10-25", "Summary KPIs,Bookings,24", "Summary KPIs,Jobs completed,18", "Summary KPIs,Quote value (USD),4820.00", "Summary KPIs,Invoiced (USD),6240.00", "Payments,Amount received (USD),2130.00", "Maintenance Plans,Active plans,14"]) {
      expect(text).toContain(line);
    }
  });

  test("an export follows the range and the records: a payment recorded this session is in the file; a day's range holds that day", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByRole("radio", { name: /INV-1050/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Payment recorded" }).getByRole("button", { name: "Close", exact: true }).click();

    await page.goto("/analytics");
    await exportButton(page).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog", { name: "Export Analytics report" }).getByRole("button", { name: "Export report" }).click()]);
    expect(readFileSync((await download.path())!, "utf8")).toContain("Payments,Amount received (USD),2430.00");

    await page.goto("/analytics?range=custom&from=2024-10-25&to=2024-10-25");
    await exportButton(page).click();
    const [day] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog", { name: "Export Analytics report" }).getByRole("button", { name: "Export report" }).click()]);
    expect(day.suggestedFilename()).toBe("climvia-analytics-2024-10-25-to-2024-10-25.csv");
    const csv = readFileSync((await day.path())!, "utf8");
    expect(csv).toContain("Report,Date range,2024-10-25 to 2024-10-25");
    // The 25th: 4 bookings, and the payments of that day (PAY-1002, PAY-1003 and the new $300).
    expect(csv).toContain("Summary KPIs,Bookings,4");
    expect(csv).toContain("Payments,Payments recorded,3");
    expect(csv).toContain("Summary KPIs,Payments received (USD),985.00");
  });

  test("Northstar's export is Northstar's: its name and figures, none of Apex's", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    await page.goto("/analytics?range=custom&from=2024-10-01&to=2024-10-31");
    await exportButton(page).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog", { name: "Export Analytics report" }).getByRole("button", { name: "Export report" }).click()]);
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv).toContain("Report,Business,Northstar Heating & Cooling");
    expect(csv).toContain("Summary KPIs,Bookings,6");
    expect(csv).toContain("Summary KPIs,Invoiced (USD),369.00");
    for (const apex of ["Apex", "6240.00", "2130.00"]) expect(csv).not.toContain(apex);
    // An empty range has nothing to export.
    await page.goto("/analytics");
    await expect(exportButton(page)).toBeDisabled();
  });
});

test.describe("a new business", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("reports zeros and a real empty state: no Apex baseline, no counts in the sidebar, an Overview that says it is ready, and nothing to export", async ({ page }) => {
    await signUp(page);
    await completeOnboarding(page, { name: "Brand New HVAC" });
    await expect(page.getByRole("heading", { level: 2, name: "Getting started" })).toBeVisible();
    await expect(sidebarCount(page, "Bookings")).not.toContainText(/\d/);
    await expect(sidebarCount(page, "Jobs")).not.toContainText(/\d/);

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
    await expect(page.getByText(/isn't available yet/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No activity for this period" })).toBeVisible();
    await expect(kpis(page).getByRole("link")).toHaveText([/^Bookings0/, /^Jobs completed0/, /^Quote value\$0/, /^Invoiced\$0/, /^Payments received\$0/]);
    await expect(exportButton(page)).toBeDisabled();
    // Whatever range is chosen there is nothing: the approved October figures belong to the sample business alone.
    for (const url of ["/analytics?range=custom&from=2024-10-01&to=2024-10-31", "/analytics?range=this-quarter", "/analytics?range=last-month"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "No activity for this period" })).toBeVisible();
      await expect(kpis(page).getByRole("link")).toHaveText([/^Bookings0/, /^Jobs completed0/, /^Quote value\$0/, /^Invoiced\$0/, /^Payments received\$0/]);
      expect(await main(page).innerText()).not.toContain("6,240");
    }
    await hydrated(page);
    await page.goto("/reviews");
    await expect(page.getByRole("tablist", { name: "Review views" }).getByRole("tab")).toHaveText([/^All reviews\s*0$/, /^Awaiting reply\s*0$/, /^Responded\s*0$/]);
    await page.goto("/maintenance-plans");
    await expect(main(page)).not.toContainText("14");
  });
});
