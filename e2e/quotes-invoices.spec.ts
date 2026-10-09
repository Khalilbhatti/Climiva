import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const quoteRows = (page: Page) => page.getByRole("table", { name: "Quotes" }).locator("tbody tr");
const invoiceRows = (page: Page) => page.getByRole("table", { name: "Invoices" }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const totals = (page: Page) => page.getByRole("region", { name: "Quote and invoice totals" });
/** One summary tile, found by its label. */
const tile = (page: Page, label: string) => totals(page).getByText(label, { exact: true }).locator("xpath=../..");

/** Opens QT-884, starts Create invoice and completes it; returns once the new invoice page is showing. */
async function createInvoiceFromQuote(page: Page) {
  await page.goto("/quotes-invoices/quotes/QT-884");
  await page.getByRole("button", { name: "Create invoice" }).first().click();
  await page.getByRole("dialog", { name: "Create invoice" }).getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1052" })).toBeVisible();
}

test.describe("Quotes & Invoices list", () => {
  test("renders the approved header, derived tiles, tabs and the quote rows from the shared records", async ({ page }) => {
    await page.goto("/quotes-invoices");
    await expect(page.getByRole("heading", { level: 1, name: "Quotes & Invoices" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Quotes & Invoices" })).toHaveAttribute("aria-current", "page");

    // Tile numbers are derived from the records, not typed in.
    await expect(tile(page, "Open quotes")).toContainText("2");
    await expect(tile(page, "Approved quotes")).toContainText("1");
    await expect(tile(page, "Unpaid invoices")).toContainText("2");
    await expect(tile(page, "Paid invoices")).toContainText("7");

    await expect(page.getByRole("tablist", { name: "Quotes and invoices" }).getByRole("tab")).toHaveText([/^Quotes\s*4$/, /^Invoices\s*9$/]);
    await expect(tab(page, "Quotes")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Quotes" }).getByRole("columnheader")).toHaveText([
      "Quote",
      "Customer",
      "Related work",
      "Amount",
      "Status",
      "Last updated",
      "Actions",
    ]);
    await expect(quoteRows(page)).toHaveCount(4);

    const qt884 = quoteRows(page).filter({ hasText: "QT-884" });
    await expect(qt884).toContainText("Sarah Mitchell");
    await expect(qt884).toContainText("AC Repair & Diagnostics");
    await expect(qt884).toContainText("Job #JB-204");
    await expect(qt884).toContainText("$285.00");
    await expect(qt884).toContainText("Approved");
    await expect(quoteRows(page).filter({ hasText: "QT-891" })).toContainText("Sent");
    await expect(quoteRows(page).filter({ hasText: "QT-893" })).toContainText("Draft");
    await expect(quoteRows(page).filter({ hasText: "QT-879" })).toContainText("Declined");
  });

  test("quotes filter by status, search, customer and service", async ({ page }) => {
    await page.goto("/quotes-invoices");
    const statuses = page.getByRole("group", { name: "Filter quotes by status" });
    await expect(statuses.getByRole("button")).toHaveText(["All (4)", "Draft (1)", "Sent (1)", "Approved (1)", "Declined (1)", "Expired (0)"]);

    await statuses.getByRole("button", { name: "Approved (1)" }).click();
    await expect(quoteRows(page)).toHaveCount(1);
    await statuses.getByRole("button", { name: "Expired (0)" }).click();
    await expect(page.getByText("No quotes match your filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(quoteRows(page)).toHaveCount(4);

    await page.getByLabel("Search quotes").fill("claire");
    await expect(quoteRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Customer", { exact: true }).selectOption("David Chen");
    await expect(quoteRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Service", { exact: true }).selectOption("heat-pump-diagnostics-repair");
    await expect(quoteRows(page)).toHaveCount(2);
  });

  test("the Invoices tab lists all nine invoices with derived status and balance, and is deep-linkable", async ({ page }) => {
    await page.goto("/quotes-invoices?tab=invoices");
    await expect(tab(page, "Invoices")).toHaveAttribute("aria-selected", "true");
    await expect(invoiceRows(page)).toHaveCount(9);

    await expect(invoiceRows(page).filter({ hasText: "INV-1044" })).toContainText("Paid");
    await expect(invoiceRows(page).filter({ hasText: "INV-1044" })).toContainText("$0.00");
    const arthur = invoiceRows(page).filter({ hasText: "INV-1050" });
    await expect(arthur).toContainText("Arthur Pendleton");
    await expect(arthur).toContainText("$500.00");
    await expect(arthur).toContainText("$300.00");
    await expect(arthur).toContainText("Partially paid");
    await expect(invoiceRows(page).filter({ hasText: "INV-1051" })).toContainText("Unpaid");

    const statuses = page.getByRole("group", { name: "Filter invoices by status" });
    await expect(statuses.getByRole("button")).toHaveText(["All (9)", "Paid (7)", "Unpaid (1)", "Partially paid (1)"]);
    await statuses.getByRole("button", { name: "Paid (7)" }).click();
    await expect(invoiceRows(page)).toHaveCount(7);
    await statuses.getByRole("button", { name: "Partially paid (1)" }).click();
    await expect(invoiceRows(page)).toHaveCount(1);
  });

  test("customer names link to Customers only where a customer record exists", async ({ page }) => {
    await page.goto("/quotes-invoices?tab=invoices");
    await expect(invoiceRows(page).filter({ hasText: "INV-1044" }).getByRole("link", { name: "Sarah Mitchell" })).toHaveAttribute("href", "/customers/sarah-mitchell");
    await expect(invoiceRows(page).filter({ hasText: "INV-1048" }).getByRole("link", { name: "Elena Rodriguez" })).toHaveAttribute("href", "/customers/elena-rodriguez");
    await expect(invoiceRows(page).filter({ hasText: "INV-1049" }).getByRole("link", { name: "David Chen" })).toHaveAttribute("href", "/customers/david-chen");
    await expect(invoiceRows(page).filter({ hasText: "INV-1043" }).getByRole("link", { name: "Kevin Vance" })).toHaveCount(0);
    await expect(page.getByText("Rostova")).toHaveCount(0);
  });

  test("no accounting-package features are offered", async ({ page }) => {
    await page.goto("/quotes-invoices");
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const term of ["aging", "ledger", "bookkeeping", "reconciliation", "accounting sync", "tax filing"]) expect(text).not.toContain(term);
  });
});

test.describe("Quote #QT-884", () => {
  test("opens from the list with the approved details", async ({ page }) => {
    await page.goto("/quotes-invoices");
    await page.getByRole("link", { name: "View quote QT-884" }).click();
    await expect(page).toHaveURL("/quotes-invoices/quotes/QT-884");

    await expect(page.getByRole("heading", { level: 1, name: "Quote #QT-884" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Quotes & Invoices" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Linked to Job #JB-204" })).toHaveAttribute("href", "/jobs/JB-204");
    const summary = page.getByRole("region", { name: "Quote summary" });
    await expect(summary).toContainText("Approved");
    await expect(summary).toContainText("Sarah Mitchell");
    await expect(summary).toContainText("Oct 24, 2024");
    await expect(summary).toContainText("AC Repair & Diagnostics");

    const items = page.getByRole("table", { name: "Quote line items" });
    await expect(items.locator("tbody tr")).toHaveCount(3);
    await expect(items).toContainText("Titan HD 45/5 µF 440V Dual Run Capacitor");
    await expect(items).toContainText("$89.50");
    await expect(items).toContainText("1.5 hrs");
    await expect(items).toContainText("$130.00/hr");
    await expect(items).toContainText("$195.00");
    await expect(items).toContainText("Rounding adjustment");
    await expect(page.getByRole("region", { name: "Line items" })).toContainText("$285.00");

    await expect(page.getByText("Quote valid through: Nov 23, 2024")).toBeVisible();
    await expect(page.getByText("Quote approved by customer · Ready for invoicing")).toBeVisible();
    const customer = page.getByRole("region", { name: "Customer", exact: true });
    await expect(customer).toContainText("(512) 555-0194");
    await expect(customer).toContainText("sarah.m@gmail.com");
    await expect(customer).toContainText("1402 Kinney Ave");
    await expect(page.getByRole("region", { name: "Quote status" })).toContainText("No invoice created yet");
    await expect(page.getByRole("region", { name: "Related records" })).toContainText("Booking #BK-1042");
  });

  test("other quotes open too, with their own status and no Create invoice action", async ({ page }) => {
    await page.goto("/quotes-invoices/quotes/QT-891");
    await expect(page.getByRole("heading", { level: 1, name: "Quote #QT-891" })).toBeVisible();
    await expect(page.getByRole("link", { name: "David Chen" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);

    await page.goto("/quotes-invoices/quotes/QT-893");
    await expect(page.getByRole("region", { name: "Customer", exact: true })).toContainText("No customer record yet.");
  });

  test("an unknown quote or invoice shows a not-found state in the shell", async ({ page }) => {
    await page.goto("/quotes-invoices/quotes/QT-000");
    await expect(page.getByText("Quote not found")).toBeVisible();
    await page.goto("/quotes-invoices/invoices/INV-0000");
    await expect(page.getByText("Invoice not found")).toBeVisible();
    await expect(primaryNav(page)).toBeVisible();
  });
});

test.describe("Create invoice from the approved quote", () => {
  test("shows the approved information for review, and Cancel creates nothing", async ({ page }) => {
    await page.goto("/quotes-invoices/quotes/QT-884");
    await page.getByRole("button", { name: "Create invoice" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create invoice" });
    await expect(dialog).toContainText("From approved Quote #QT-884");
    await expect(dialog).toContainText("Job #JB-204");
    await expect(dialog.getByRole("table", { name: "Invoice items" }).locator("tbody tr")).toHaveCount(3);
    await expect(dialog).toContainText("Titan HD 45/5 µF 440V Dual Run Capacitor");
    await expect(dialog).toContainText("$285.00");
    await expect(dialog).toContainText("Assigned when created");
    await expect(dialog).toContainText("Unpaid");
    await expect(dialog).toContainText("Today (Oct 25, 2024)");
    await expect(dialog.getByLabel("Payment terms")).toHaveValue("due-on-receipt");
    await expect(dialog).toContainText("Payments are recorded separately after the invoice is created.");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create invoice" }).first()).toBeFocused();
    await expect(page.getByRole("region", { name: "Quote status" })).toContainText("No invoice created yet");
  });

  test("creating stores an unpaid INV-1052, links it to the quote, and records no payment", async ({ page }) => {
    await page.goto("/quotes-invoices/quotes/QT-884");
    await page.getByRole("button", { name: "Create invoice" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create invoice" });
    await dialog.getByLabel("Payment terms").selectOption("net-15");
    await dialog.getByLabel("Message to customer (optional)").fill("Thank you for your business.");
    await dialog.getByRole("button", { name: "Create invoice" }).click();

    await expect(page).toHaveURL("/quotes-invoices/invoices/INV-1052");
    await expect(page.getByText("Invoice #INV-1052 created from Quote #QT-884.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1052" })).toBeVisible();
    await expect(page.locator("header").filter({ hasText: "INV-1052" }).last()).toContainText("Unpaid");
    await expect(page.getByRole("link", { name: "From Quote #QT-884" })).toHaveAttribute("href", "/quotes-invoices/quotes/QT-884");
    await expect(page.getByRole("region", { name: "Invoice summary" })).toContainText("Net 15 · due Nov 9, 2024");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$285.00");
    await expect(page.getByText("No payments recorded yet.")).toBeVisible();
    await expect(page.getByText("“Thank you for your business.”")).toBeVisible();

    // The quote now points at the invoice and can't be invoiced again.
    await page.getByRole("link", { name: "From Quote #QT-884" }).click();
    await expect(page.getByRole("region", { name: "Quote status" })).toContainText("#INV-1052");
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
    await expect(page.getByText("Quote approved by customer · Invoiced")).toBeVisible();

    // It is stored, not held in the page: after a reload the invoice and the link are still there.
    await page.reload();
    await expect(page.getByRole("region", { name: "Quote status" })).toContainText("#INV-1052");
    await page.goto("/quotes-invoices/invoices/INV-1052");
    await expect(page.locator("header").filter({ hasText: "INV-1052" }).last()).toContainText("Unpaid");
    await expect(page.getByRole("region", { name: "Invoice summary" })).toContainText("Net 15 · due Nov 9, 2024");
  });

  test("nothing is paid automatically: Payments still has 7 recorded payments and the new invoice is outstanding", async ({ page }) => {
    await createInvoiceFromQuote(page);
    await primaryNav(page).getByRole("link", { name: "Payments" }).click();
    const kpis = page.getByRole("region", { name: "Payment totals" });
    await expect(kpis.getByText("Payments recorded", { exact: true }).locator("xpath=../..")).toContainText("7");
    await expect(kpis.getByText("Amount received", { exact: true }).locator("xpath=../..")).toContainText("$2,130.00");
    await expect(kpis.getByText("Outstanding invoices", { exact: true }).locator("xpath=../..")).toContainText("3");
    await expect(kpis.getByText("Outstanding balance", { exact: true }).locator("xpath=../..")).toContainText("$965.00");
    await page.getByRole("tab", { name: /^Outstanding invoices/ }).click();
    await expect(page.getByRole("table", { name: "Outstanding invoices" }).locator("tbody tr").filter({ hasText: "INV-1052" })).toContainText("$285.00");
  });

  test("the Overview's Total Invoiced includes the new invoice, and keeps it after a reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$6,240");
    await createInvoiceFromQuote(page);
    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$6,525");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$2,130");
    await page.reload();
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$6,525");
  });
});

test.describe("Invoice #INV-1044", () => {
  test("opens from the list, fully paid in the canonical baseline", async ({ page }) => {
    await page.goto("/quotes-invoices?tab=invoices");
    await invoiceRows(page).filter({ hasText: "INV-1044" }).getByRole("link", { name: "View invoice INV-1044" }).click();
    await expect(page).toHaveURL("/quotes-invoices/invoices/INV-1044");

    await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1044" })).toBeVisible();
    await expect(page.locator("header").filter({ hasText: "INV-1044" }).last()).toContainText("Paid");
    const summary = page.getByRole("region", { name: "Payment summary" });
    await expect(summary).toContainText("$285.00");
    await expect(summary).toContainText("Paid");
    await expect(summary).toContainText("$0.00");
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

    const items = page.getByRole("table", { name: "Invoice items" });
    await expect(items.locator("tbody tr")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "Invoice summary" })).toContainText("Oct 25, 2024");
    await expect(page.getByRole("region", { name: "Invoice summary" })).toContainText("Due on receipt");
    await expect(page.getByRole("region", { name: "Invoice summary" })).toContainText("#JB-204");
    await expect(page.getByRole("region", { name: "Related records" })).toContainText("Booking #BK-1042");
    await expect(page.getByRole("region", { name: "Customer", exact: true })).toContainText("Sarah Mitchell");
  });

  test("its payment history shows PAY-1008 as Recorded and the historical PAY-1001 as Voided and not counted", async ({ page }) => {
    await page.goto("/quotes-invoices/invoices/INV-1044");
    const payments = page.getByRole("table", { name: "Payments for this invoice" });
    await expect(payments.locator("tbody tr")).toHaveCount(2);
    await expect(payments.locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("Recorded");
    await expect(payments.locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("Oct 28, 2024");
    await expect(payments.locator("tbody tr").filter({ hasText: "PAY-1001" })).toContainText("Voided");
    await expect(payments.locator("tbody tr").filter({ hasText: "PAY-1001" })).toContainText("Not counted");
    await expect(page.getByRole("region", { name: "Payments", exact: true })).toContainText("1 recorded");
    // Totals count the recorded payment only.
    await expect(page.getByText("Payments received").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Invoice items" })).toContainText("$285.00");
    // The paid baseline shows no reopened-invoice banner.
    await expect(page.getByText(/was voided\. Invoice #INV-1044 now has a balance due/)).toHaveCount(0);
  });

  test("INV-1044 never appears in the Record payment selection or the outstanding list", async ({ page }) => {
    await page.goto("/payments?record=1");
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(dialog.getByRole("radio", { name: /INV-1050/ })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /INV-1051/ })).toBeVisible();
    await expect(dialog.getByText("INV-1044")).toHaveCount(0);
    await expect(dialog.getByText("Sarah Mitchell")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("tab", { name: /^Outstanding invoices/ }).click();
    await expect(page.getByRole("table", { name: "Outstanding invoices" }).getByText("INV-1044")).toHaveCount(0);
  });

  test("opening Record payment for a paid invoice directly is refused politely", async ({ page }) => {
    await page.goto("/payments?record=1&invoice=INV-1044");
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await expect(dialog).toContainText("Invoice #INV-1044 has no balance due, so no payment can be recorded against it.");
    await expect(dialog.getByRole("button", { name: "Record payment" })).toBeDisabled();
  });
});

test.describe("Invoice #INV-1050 (partially paid)", () => {
  test("shows what was previously paid and offers Record payment with its balance", async ({ page }) => {
    await page.goto("/quotes-invoices/invoices/INV-1050");
    await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1050" })).toBeVisible();
    await expect(page.locator("header").filter({ hasText: "INV-1050" }).last()).toContainText("Partially paid");
    await expect(page.getByRole("region", { name: "Invoice items" })).toContainText("Previously paid");
    await expect(page.getByRole("region", { name: "Invoice items" })).toContainText("$200.00");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$300.00");
    await expect(page.getByRole("region", { name: "Customer", exact: true })).toContainText("No customer record yet.");

    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await expect(dialog).toContainText("Arthur Pendleton · Balance due $300.00");
    await expect(dialog.getByRole("button", { name: "Back" })).toHaveCount(0); // started from the invoice: no selection step
    await expect(dialog.getByRole("radio", { name: /^Full payment · \$300\.00/ })).toBeChecked();
  });
});
