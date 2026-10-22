import { readFileSync } from "node:fs";
import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Analytics sections" });
const tab = (page: Page, name: string) => tabs(page).getByRole("tab", { name });
const kpis = (page: Page) => page.getByRole("region", { name: "Key metrics" });
const rangeButton = (page: Page) => page.getByRole("button", { name: /^Date range:/ });
const exportButton = (page: Page) => page.getByRole("button", { name: "Export report" });
const exportDialog = (page: Page) => page.getByRole("dialog", { name: "Export Analytics report" });
const rangeDialog = (page: Page) => page.getByRole("dialog", { name: "Select date range" });
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test.describe("Analytics: structure", () => {
  test("renders the approved header, the six tabs, the range control and Export report", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
    await expect(page.getByText("How your business is doing: bookings, finished jobs and money, for the dates you choose.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
    await expect(tabs(page).getByRole("tab")).toHaveText(["Overview", "Bookings", "Jobs", "Revenue", "Marketplace", "Customer retention"]);
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    await expect(rangeButton(page)).toContainText("Oct 1 – Oct 31, 2024");
    await expect(rangeButton(page)).toContainText("This month");
    await expect(exportButton(page)).toBeEnabled();
  });

  test("the tab lives in the URL, is keyboard operable and each tab has a labelled panel", async ({ page }) => {
    await page.goto("/analytics");
    await tab(page, "Overview").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Bookings")).toBeFocused();
    await expect(tab(page, "Bookings")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/analytics\?tab=bookings$/);
    await expect(page.getByRole("tabpanel")).toBeVisible();

    // Addresses from the first version of the page still open the part they meant.
    await page.goto("/analytics?tab=bookings-jobs");
    await expect(tab(page, "Bookings")).toHaveAttribute("aria-selected", "true");
    await page.goto("/analytics?tab=financial");
    await expect(tab(page, "Revenue")).toHaveAttribute("aria-selected", "true");
    await page.goto("/analytics?tab=plans");
    await expect(tab(page, "Customer retention")).toHaveAttribute("aria-selected", "true");
    await page.goto("/analytics?tab=nonsense");
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Analytics: Overview tab", () => {
  test("the five totals are the approved baselines", async ({ page }) => {
    await page.goto("/analytics");
    const cards = kpis(page).getByRole("link");
    await expect(cards).toHaveCount(5);
    await expect(cards.nth(0)).toContainText(/Bookings\s*24\s*Bookings created/);
    await expect(cards.nth(1)).toContainText(/Jobs completed\s*18\s*Completed Jobs/);
    await expect(cards.nth(2)).toContainText(/Quote value\s*\$4,820\s*Quotes created/);
    await expect(cards.nth(3)).toContainText(/Invoiced\s*\$6,240\s*Invoice total/);
    await expect(cards.nth(4)).toContainText(/Payments received\s*\$2,130\s*Recorded non-voided Payments/);
  });

  test("the weekly chart names every week's Bookings and completed Jobs, and the summary adds them up", async ({ page }) => {
    await page.goto("/analytics");
    const section = page.getByRole("region", { name: "Operational activity" });
    await expect(section).toContainText("Weekly volume of Bookings and completed Jobs");
    await expect(section).toContainText("24 Bookings · 18 Completed Jobs");
    const weeks = section.getByRole("list", { name: "Weekly Bookings and completed Jobs" }).getByRole("listitem");
    await expect(weeks).toHaveCount(5);
    for (const [index, label] of [
      "Oct 1–6: 5 Bookings, 3 completed Jobs",
      "Oct 7–13: 6 Bookings, 5 completed Jobs",
      "Oct 14–20: 7 Bookings, 4 completed Jobs",
      "Oct 21–27: 4 Bookings, 4 completed Jobs",
      "Oct 28–31: 2 Bookings, 2 completed Jobs",
    ].entries()) {
      await expect(weeks.nth(index)).toHaveAttribute("aria-label", label);
    }
  });

  test("Service activity lists the Services with their Bookings and completed Jobs, and totals them", async ({ page }) => {
    await page.goto("/analytics");
    const rows = page.getByRole("table", { name: "Service activity" }).locator("tbody tr");
    await expect(rows).toHaveCount(6);
    const text = await rows.allInnerTexts();
    expect(text[0]).toMatch(/AC Repair & Diagnostics\s+9\s+7/);
    expect(text[1]).toMatch(/Annual Cooling Tune-Up & Maintenance\s+8\s+6/);
    expect(text[2]).toMatch(/Heat Pump Diagnostics & Repair\s+4\s+3/);
    expect(text[3]).toMatch(/Furnace Safety Inspection & Tune-Up\s+2\s+2/);
    expect(text[4]).toMatch(/Ductless Mini-Split Installation & Estimate\s+1\s+0/);
    expect(text[5]).toMatch(/Total\s+24\s+18/);
  });

  test("Financial record totals are three separate record types", async ({ page }) => {
    await page.goto("/analytics");
    const totals = page.getByRole("region", { name: "Financial record totals" });
    await expect(totals).toContainText("Quotes created");
    await expect(totals).toContainText("12 quotes");
    await expect(totals).toContainText("$4,820");
    await expect(totals).toContainText("Invoices created");
    await expect(totals).toContainText("18 invoices");
    await expect(totals).toContainText("$6,240");
    await expect(totals).toContainText("Payments recorded");
    await expect(totals).toContainText("7 payments");
    await expect(totals).toContainText("$2,130");
  });
});

test.describe("Analytics: the other tabs", () => {
  test("Bookings and Jobs: status counts, recent records and recent completed Jobs from the shared records", async ({ page }) => {
    await page.goto("/analytics?tab=bookings");
    const howMany = section(page, "How many bookings are we getting?");
    await expect(howMany).toContainText("24 in this period");
    const bookings = section(page, "What state are they in?");
    for (const [label, value] of [["Confirmed", "14"], ["Completed", "6"], ["Pending confirmation", "2"], ["Cancelled", "2"]]) await expect(bookings).toContainText(new RegExp(`${label}\\s*${value}`));

    const records = page.getByRole("table", { name: "Recent booking records" }).locator("tbody tr");
    await expect(records).toHaveCount(5);
    await expect(records.filter({ hasText: "BK-1042" })).toContainText("Sarah Mitchell");
    await expect(records.filter({ hasText: "BK-1042" })).toContainText("Completed");
    await expect(page.getByRole("link", { name: "#BK-1042" })).toHaveAttribute("href", "/bookings?tab=past&booking=BK-1042");

    await expect(howMany.getByRole("link", { name: /View all in Bookings/ })).toHaveAttribute("href", "/bookings");
    await expect(page.getByRole("table", { name: "Service activity" }).locator("tbody tr")).toHaveCount(6);
    await expect(section(page, "Which Services do people book?").getByRole("link", { name: /Review catalog in Services/ })).toHaveAttribute("href", "/services");

    await page.goto("/analytics?tab=jobs");
    const jobs = section(page, "What is still scheduled or in progress?");
    await expect(jobs).toContainText("24 Jobs in this period in all");
    for (const [label, value] of [["Completed", "18"], ["Scheduled", "4"], ["In progress", "2"]]) await expect(jobs).toContainText(new RegExp(`${label}\\s*${value}`));
    await expect(section(page, "How much work is being completed?")).toContainText("18 Jobs completed");
    const recentJobs = section(page, "Recent completed Jobs");
    await expect(recentJobs.getByRole("listitem")).toHaveCount(3);
    await expect(recentJobs.getByRole("listitem").first()).toContainText("#JB-204");
    await expect(recentJobs.getByRole("listitem").first()).toContainText("Sarah Mitchell — 1402 Kinney Ave");
    await expect(recentJobs.getByRole("listitem").first()).toContainText("Completed");
    await expect(recentJobs.getByRole("link", { name: "#JB-204" })).toHaveAttribute("href", "/jobs/JB-204");
    await expect(section(page, "How much work is being completed?").getByRole("link", { name: /View all in Jobs/ })).toHaveAttribute("href", "/jobs");
  });

  test("Revenue: what was invoiced, paid, is outstanding and was quoted, at the approved baseline", async ({ page }) => {
    await page.goto("/analytics?tab=revenue");
    const quotes = section(page, "What have we quoted?");
    await expect(quotes).toContainText(/Total quoted value\s*\$4,820/);
    await expect(quotes).toContainText(/Approved quote value\s*\$2,975/);
    for (const [label, value] of [["Approved", "5"], ["Sent", "3"], ["Draft", "2"], ["Declined", "1"], ["Expired", "1"]]) await expect(quotes).toContainText(new RegExp(`${label}\\s*${value}`));

    const invoices = section(page, "What have we invoiced?");
    await expect(invoices).toContainText(/Total invoiced\s*\$6,240/);
    for (const [label, value] of [["Paid", "12"], ["Unpaid", "4"], ["Partially paid", "2"]]) await expect(invoices).toContainText(new RegExp(`${label}\\s*${value}`));
    const outstanding = section(page, "What is still outstanding?");
    await expect(outstanding).toContainText(/Outstanding balance\s*\$680/);
    await expect(outstanding.getByRole("link", { name: /View outstanding invoices in Payments/ })).toHaveAttribute("href", "/payments?tab=outstanding");

    const payments = section(page, "What has been paid?");
    await expect(payments).toContainText(/Payments recorded\s*7/);
    await expect(payments).toContainText(/Amount received\s*\$2,130/);
    await expect(payments).toContainText(/Voided payments\s*1/);
    await expect(payments).toContainText("#PAY-1001 for $285.00");
    await expect(payments).toContainText("excluded from received totals");
    await expect(payments.getByRole("link", { name: "#PAY-1008" })).toHaveAttribute("href", "/payments/PAY-1008");
  });

  test("Customer retention: Maintenance Plan totals and what customers say", async ({ page }) => {
    await page.goto("/analytics?tab=retention");
    const plans = section(page, "How many customers are on a Maintenance Plan?");
    for (const [label, value] of [["Active plans", "14"], ["Visits due", "5"], ["Upcoming renewals", "3"], ["Paused or ended", "2"]]) await expect(plans).toContainText(new RegExp(`${label}\\s*${value}`));
    await expect(plans.getByRole("link", { name: /Manage plans in Maintenance Plans/ })).toHaveAttribute("href", "/maintenance-plans");
    const reviews = section(page, "What do customers say about our work?");
    for (const [label, value] of [["Total reviews", "12"], ["Average rating", "4.7"], ["Awaiting reply", "3"], ["Review requests", "5"]]) await expect(reviews).toContainText(new RegExp(`${label}\\s*${value}`));
    await expect(reviews.getByRole("link", { name: /Read them in Reviews/ })).toHaveAttribute("href", "/reviews");
  });
});

test.describe("Analytics: date range", () => {
  test("the picker offers This month, Last month, This quarter and a custom range, with the current one chosen", async ({ page }) => {
    await page.goto("/analytics");
    await rangeButton(page).click();
    const dialog = rangeDialog(page);
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    await expect(dialog.getByRole("radio", { name: /^This month/ })).toBeChecked();
    await expect(dialog).toContainText("Oct 1 – Oct 31, 2024");
    await expect(dialog).toContainText("Sep 1 – Sep 30, 2024");
    await expect(dialog).toContainText("Oct 1 – Dec 31, 2024");
    await expect(dialog.getByLabel(/^From/)).toHaveCount(0);
    await dialog.getByRole("radio", { name: /^Custom range/ }).check();
    await expect(dialog.getByLabel(/^From/)).toHaveValue("2024-10-01");
    await expect(dialog.getByLabel(/^To( \*)?$/)).toHaveValue("2024-10-31");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rangeButton(page)).toBeFocused();
  });

  test("a range with no recorded activity shows the approved empty state, zero totals and a disabled export", async ({ page }) => {
    await page.goto("/analytics");
    await rangeButton(page).click();
    await rangeDialog(page).getByRole("radio", { name: /^Last month/ }).check();
    await rangeDialog(page).getByRole("button", { name: "Apply range" }).click();

    await expect(page).toHaveURL(/range=last-month/);
    await expect(rangeButton(page)).toContainText("Sep 1 – Sep 30, 2024");
    await expect(page.getByRole("heading", { name: "No activity for this period" })).toBeVisible();
    await expect(page.getByText("There are no Bookings, Jobs, Quotes, Invoices, or Payments recorded for the selected date range. Try selecting another date range to review workspace activity.")).toBeVisible();
    await expect(kpis(page).getByRole("link")).toHaveText([/0/, /0/, /\$0/, /\$0/, /\$0/]);
    await expect(exportButton(page)).toBeDisabled();
    // No fabricated chart values: there is no chart, table or tab on an empty range.
    await expect(page.getByRole("list", { name: "Weekly Bookings and completed Jobs" })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(0);
  });

  test("Change date range reopens the picker and Reset date range returns to this month", async ({ page }) => {
    await page.goto("/analytics?range=custom&from=2024-12-02&to=2024-12-06");
    await expect(rangeButton(page)).toContainText("Dec 2 – Dec 6, 2024");
    await expect(rangeButton(page)).toContainText("Custom range");
    await expect(page.getByRole("heading", { name: "No activity for this period" })).toBeVisible();

    await page.getByRole("button", { name: "Change date range" }).click();
    await expect(rangeDialog(page).getByRole("radio", { name: /^Custom range/ })).toBeChecked();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Reset date range" }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(rangeButton(page)).toContainText("Oct 1 – Oct 31, 2024");
    await expect(kpis(page)).toContainText("$6,240");
  });

  test("a custom range is validated, and a valid one with no records is empty", async ({ page }) => {
    await page.goto("/analytics");
    await rangeButton(page).click();
    const dialog = rangeDialog(page);
    await dialog.getByRole("radio", { name: /^Custom range/ }).check();
    await dialog.getByLabel(/^From/).fill("2024-12-06");
    await dialog.getByLabel(/^To( \*)?$/).fill("2024-12-02");
    await dialog.getByRole("button", { name: "Apply range" }).click();
    await expect(dialog.getByText("The end date must be on or after the start date.")).toBeVisible();
    await expect(dialog.getByLabel(/^From/)).toHaveAttribute("aria-invalid", "true");

    await dialog.getByLabel(/^From/).fill("2024-12-02");
    await dialog.getByLabel(/^To( \*)?$/).fill("2024-12-06");
    await dialog.getByRole("button", { name: "Apply range" }).click();
    await expect(page).toHaveURL(/range=custom&from=2024-12-02&to=2024-12-06/);
    await expect(page.getByRole("heading", { name: "No activity for this period" })).toBeVisible();
    // A range over two years long is not a report the page builds.
    await page.goto("/analytics?range=custom&from=2020-01-01&to=2024-12-06");
    await expect(rangeButton(page)).toContainText("This month");
  });

  test("a range reports the records inside its dates, and the imported history only when it covers all of its period", async ({ page }) => {
    // October 10 to 20 covers part of the imported period: the records inside it (one declined quote, $195) and a note, not the approved totals.
    await page.goto("/analytics?range=custom&from=2024-10-10&to=2024-10-20");
    await expect(page.getByText("Imported history for Oct 1 – Oct 31, 2024 is only part of the figures when the range covers all of it.")).toBeVisible();
    await expect(kpis(page).getByRole("link")).toHaveText([/^Bookings0/, /^Jobs completed0/, /^Quote value\$195/, /^Invoiced\$0/, /^Payments received\$0/]);

    // The quarter covers the whole period: the approved October figures, plus the November booking BK-1048 (25 bookings).
    await page.goto("/analytics?range=this-quarter");
    await expect(rangeButton(page)).toContainText("Oct 1 – Dec 31, 2024");
    await expect(page.getByText(/Imported history for/)).toHaveCount(0);
    await expect(kpis(page)).toContainText("25");
    await expect(kpis(page)).toContainText("$6,240");

    // This month is the approved view, with no note.
    await page.goto("/analytics");
    await expect(page.getByText(/Imported history for/)).toHaveCount(0);
    await expect(kpis(page)).toContainText("24");
  });

  test("an invalid range in the URL falls back to this month", async ({ page }) => {
    await page.goto("/analytics?range=custom&from=2024-13-01&to=garbage");
    await expect(rangeButton(page)).toContainText("Oct 1 – Oct 31, 2024");
    await expect(rangeButton(page)).toContainText("This month");
  });

  test("the same range reads the same in any browser timezone", async ({ browser, baseURL, storageState }) => {
    for (const timezoneId of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
      const context = await browser.newContext({ baseURL, timezoneId, storageState });
      const page = await context.newPage();
      try {
        await page.goto("/analytics");
        await expect(rangeButton(page)).toContainText("Oct 1 – Oct 31, 2024");
        await page.goto("/analytics?range=custom&from=2024-10-01&to=2024-11-01");
        await expect(rangeButton(page)).toContainText("Oct 1 – Nov 1, 2024");
        await expect(kpis(page)).toContainText("$6,240");
      } finally {
        await context.close();
      }
    }
  });
});

test.describe("Analytics: export", () => {
  test("the dialog offers the range, the six modules and CSV or PDF, neither marked recommended", async ({ page }) => {
    await page.goto("/analytics");
    await exportButton(page).click();
    const dialog = exportDialog(page);
    await expect(dialog).toContainText("Select the date range and record modules you want to include in this report export.");
    await expect(dialog).toContainText("Oct 1 – Oct 31, 2024");
    await expect(dialog).toContainText("(Current selected range)");
    const boxes = dialog.getByRole("checkbox");
    await expect(boxes).toHaveCount(6);
    for (const label of ["Summary KPIs", "Bookings", "Jobs", "Quotes & Invoices", "Payments", "Maintenance Plans"]) await expect(dialog.getByRole("checkbox", { name: new RegExp(`^${label}`) })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /^CSV/ })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /^PDF/ })).not.toBeChecked();
    await expect(dialog).not.toContainText(/recommended/i);
    await expect(dialog).toContainText("Voided Payments remain in record history but are excluded from received-payment totals.");
    // Nothing that sends or schedules a report.
    await expect(dialog).not.toContainText(/schedule|email|recurring|cloud|share/i);
  });

  test("Select all / Clear all, and at least one module is required", async ({ page }) => {
    await page.goto("/analytics");
    await exportButton(page).click();
    const dialog = exportDialog(page);
    await dialog.getByRole("button", { name: "Clear all" }).click();
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Export report" }).click();
    await expect(dialog.getByText("Select at least one module to include.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Select all" }).click();
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(6);
  });

  test("exporting a CSV downloads a real file made from the figures on screen", async ({ page }) => {
    await page.goto("/analytics");
    await exportButton(page).click();
    const [download] = await Promise.all([page.waitForEvent("download"), exportDialog(page).getByRole("button", { name: "Export report" }).click()]);
    expect(download.suggestedFilename()).toBe("climvia-analytics-2024-10-01-to-2024-10-31.csv");
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.split("\r\n")[0]).toBe("Section,Metric,Value");
    for (const line of ["Report,Business,Apex Climate Heating & Air", "Summary KPIs,Bookings,24", "Summary KPIs,Invoiced (USD),6240.00", "Payments,Amount received (USD),2130.00", "Maintenance Plans,Visits due,5"]) expect(csv).toContain(line);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Report exported as CSV.")).toBeVisible();
  });

  test("exporting a PDF downloads a real PDF with only the chosen modules", async ({ page }) => {
    await page.goto("/analytics");
    await exportButton(page).click();
    const dialog = exportDialog(page);
    await dialog.getByRole("button", { name: "Clear all" }).click();
    await dialog.getByRole("checkbox", { name: /^Payments/ }).check();
    await dialog.getByRole("radio", { name: /^PDF/ }).check();
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Export report" }).click()]);
    expect(download.suggestedFilename()).toBe("climvia-analytics-2024-10-01-to-2024-10-31.pdf");
    const pdf = readFileSync((await download.path())!).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Climvia Analytics report");
    expect(pdf).toContain("$2,130.00");
    expect(pdf).not.toContain("Maintenance Plans");
    expect(pdf).not.toContain("Summary KPIs");
    await expect(page.getByText("Report exported as PDF.")).toBeVisible();
  });

  test("the export carries what the session has done: a recorded payment is in the file", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const record = page.getByRole("dialog", { name: "Record payment" });
    await record.getByRole("radio", { name: /INV-1050/ }).check();
    await record.getByRole("button", { name: "Continue" }).click();
    await record.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Payment recorded" }).getByRole("button", { name: "Close", exact: true }).click();

    await primaryNav(page).getByRole("link", { name: "Analytics" }).click();
    await exportButton(page).click();
    const [download] = await Promise.all([page.waitForEvent("download"), exportDialog(page).getByRole("button", { name: "Export report" }).click()]);
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv).toContain("Payments,Amount received (USD),2430.00");
    expect(csv).toContain("Payments,Payments recorded,8");
  });

  test("Escape closes the export dialog and returns focus to its button", async ({ page }) => {
    await page.goto("/analytics");
    await exportButton(page).click();
    await expect(exportDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(exportButton(page)).toBeFocused();
  });
});

test.describe("Analytics: follows the session through the shared selectors", () => {
  test("recording a payment moves received, recorded, outstanding and the invoice statuses, and Overview agrees", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const record = page.getByRole("dialog", { name: "Record payment" });
    await record.getByRole("radio", { name: /INV-1050/ }).check();
    await record.getByRole("button", { name: "Continue" }).click();
    await record.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Payment recorded" }).getByRole("button", { name: "Close", exact: true }).click();

    await primaryNav(page).getByRole("link", { name: "Analytics" }).click();
    await expect(kpis(page).getByRole("link").nth(4)).toContainText("$2,430");
    await expect(page.getByRole("region", { name: "Financial record totals" })).toContainText("8 payments");
    await tab(page, "Revenue").click();
    await expect(section(page, "What has been paid?")).toContainText(/Payments recorded\s*8/);
    await expect(section(page, "What has been paid?")).toContainText(/Amount received\s*\$2,430/);
    await expect(section(page, "What is still outstanding?")).toContainText(/Outstanding balance\s*\$380/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Paid\s*13/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Partially paid\s*1/);
    await expect(section(page, "What have we invoiced?")).toContainText(/Total invoiced\s*\$6,240/);

    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$2,430");
  });

  test("a reload restores the baseline", async ({ page }) => {
    await page.goto("/analytics?tab=revenue");
    await expect(section(page, "What has been paid?")).toContainText(/Amount received\s*\$2,130/);
  });
});

test.describe("Analytics: scope", () => {
  test("is a reporting view only: no editing controls, AI, forecasts or per-technician figures on any tab", async ({ page }) => {
    for (const query of ["", "?tab=bookings", "?tab=jobs", "?tab=revenue", "?tab=marketplace", "?tab=retention"]) {
      await page.goto(`/analytics${query}`);
      const text = (await page.locator("main").innerText()).toLowerCase();
      for (const banned of ["insight", "recommend", "forecast", "predict", "ai ", "technician performance", "conversion", "profitab", "efficiency", "demand", "saved view", "last synced", "data readiness", "audit", "traffic", "attribution", "seo"]) {
        expect(text, `${query || "overview"}: ${banned}`).not.toContain(banned);
      }
      await expect(page.locator("main").getByRole("button", { name: /^(Save|Add|Create|Delete|Edit)/ })).toHaveCount(0);
    }
  });

  test("shows only the approved tabs and no decorative percentages", async ({ page }) => {
    await page.goto("/analytics");
    await expect(tabs(page).getByRole("tab")).toHaveCount(6);
    expect(await page.locator("main").innerText()).not.toMatch(/\d+(\.\d+)?%/);
  });

  test("the Overview module has no Analytics content", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator("main").innerText();
    for (const phrase of ["Weekly volume", "Service activity", "Financial record totals", "Export report", "Selected period summary"]) expect(text).not.toContain(phrase);
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$6,240");
  });

  test("keeps its content inside the content area at a narrow width, scrolling wide tables and tabs sideways instead", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    for (const query of ["", "?tab=bookings-jobs", "?tab=financial", "?tab=plans", "?range=last-month"]) {
      await page.goto(`/analytics${query}`);
      await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
      const outside = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const limit = main.getBoundingClientRect().right + 1;
        return [...main.querySelectorAll("*")]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.right > limit && !element.closest(".overflow-x-auto");
          })
          .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`);
      });
      expect(outside, `${query || "overview"}`).toEqual([]);
    }
  });
});
