import type { Page } from "playwright/test";
import { expect, test } from "./fixtures";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const kpis = (page: Page) => page.getByRole("region", { name: "Payment totals" });
const kpi = (page: Page, label: string) => kpis(page).getByText(label, { exact: true }).locator("xpath=../..");
const paymentRows = (page: Page) => page.getByRole("table", { name: "Payments" }).locator("tbody tr");
const outstandingRows = (page: Page) => page.getByRole("table", { name: "Outstanding invoices" }).locator("tbody tr");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const recordDialog = (page: Page) => page.getByRole("dialog", { name: "Record payment" });

async function expectTotals(page: Page, totals: { recorded: string; received: string; outstanding: string; balance: string }) {
  await expect(kpi(page, "Payments recorded")).toContainText(totals.recorded);
  await expect(kpi(page, "Amount received")).toContainText(totals.received);
  await expect(kpi(page, "Outstanding invoices")).toContainText(totals.outstanding);
  await expect(kpi(page, "Outstanding balance")).toContainText(totals.balance);
}

/** Records the full $300 on INV-1050 through the real flow and returns the success dialog. */
async function recordFullPaymentOnInv1050(page: Page) {
  await page.getByRole("button", { name: "Record payment" }).first().click();
  const dialog = recordDialog(page);
  await dialog.getByRole("radio", { name: /INV-1050/ }).check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Record payment" }).click();
  return page.getByRole("dialog", { name: "Payment recorded" });
}

test.describe("Payments: canonical baseline", () => {
  test("renders the approved header and the post-#PAY-1008 totals: 7 recorded, $2,130 received, 2 outstanding, $680", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    await expect(page.getByText("Track payments recorded against customer Invoices and review outstanding balances.")).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
    await expectTotals(page, { recorded: "7", received: "$2,130.00", outstanding: "2", balance: "$680.00" });
    await expect(kpi(page, "Payments recorded")).toContainText("Active non-voided payments");
    await expect(kpi(page, "Outstanding balance")).toContainText("Total remaining across open Invoices");
  });

  test("the payment list has all eight records, newest first, with PAY-1008 intact and PAY-1001 Voided", async ({ page }) => {
    await page.goto("/payments");
    await expect(tab(page, "Payments")).toContainText("8");
    await expect(page.getByRole("table", { name: "Payments" }).getByRole("columnheader")).toHaveText([
      "Payment",
      "Customer",
      "Invoice",
      "Date",
      "Method",
      "Amount",
      "Status",
      "Actions",
    ]);
    await expect(paymentRows(page)).toHaveCount(8);
    await expect(paymentRows(page).first()).toContainText("PAY-1008");

    const pay1008 = paymentRows(page).filter({ hasText: "PAY-1008" });
    await expect(pay1008).toContainText("Sarah Mitchell");
    await expect(pay1008).toContainText("#INV-1044");
    await expect(pay1008).toContainText("Oct 28, 2024");
    await expect(pay1008).toContainText("Check");
    await expect(pay1008).toContainText("$285.00");
    await expect(pay1008).toContainText("Recorded");

    const pay1001 = paymentRows(page).filter({ hasText: "PAY-1001" });
    await expect(pay1001).toContainText("Voided");
    await expect(pay1001).toContainText("Excluded from total");
    await expect(pay1001).toContainText("$285.00");
    await expect(paymentRows(page).filter({ hasText: "Elena Rodriguez" })).toContainText("PAY-1006");
    await expect(page.getByText("Rostova")).toHaveCount(0);
  });

  test("the voided payment does not contribute: the seven recorded payments add up to the received total", async ({ page }) => {
    await page.goto("/payments");
    await expect(paymentRows(page)).toHaveCount(8); // the list renders after the page hydrates
    const amounts = await paymentRows(page).filter({ hasText: "Recorded" }).locator("td:nth-child(6)").allInnerTexts();
    expect(amounts).toHaveLength(7);
    const sum = amounts.reduce((total, text) => total + Number(text.replace(/[$,]/g, "")), 0);
    expect(sum).toBe(2130);
    await expect(kpi(page, "Amount received")).toContainText("$2,130.00");
  });

  test("Outstanding invoices are exactly INV-1050 (Arthur Pendleton, $300 balance) and INV-1051 (Maya Lin, $380)", async ({ page }) => {
    await page.goto("/payments?tab=outstanding");
    await expect(tab(page, "Outstanding invoices")).toHaveAttribute("aria-selected", "true");
    await expect(outstandingRows(page)).toHaveCount(2);
    await expect(page.getByRole("table", { name: "Outstanding invoices" }).getByRole("columnheader")).toHaveText([
      "Invoice",
      "Customer",
      "Invoice date",
      "Invoice total",
      "Paid",
      "Balance due",
      "Payment status",
      "Actions",
    ]);

    const arthur = outstandingRows(page).filter({ hasText: "INV-1050" });
    await expect(arthur).toContainText("Arthur Pendleton");
    await expect(arthur).toContainText("Oct 27, 2024");
    await expect(arthur).toContainText("$500.00");
    await expect(arthur).toContainText("$200.00");
    await expect(arthur).toContainText("$300.00");
    await expect(arthur).toContainText("Partially paid");

    const maya = outstandingRows(page).filter({ hasText: "INV-1051" });
    await expect(maya).toContainText("Maya Lin");
    await expect(maya).toContainText("$380.00");
    await expect(maya).toContainText("$0.00");
    await expect(maya).toContainText("Unpaid");

    await expect(page.getByText("Showing 2 of 2 outstanding invoices · Total remaining open balance: $680.00")).toBeVisible();
    await expect(page.getByRole("table", { name: "Outstanding invoices" }).getByText("INV-1044")).toHaveCount(0);
  });

  test("payments filter by method, status and customer, and search by id", async ({ page }) => {
    await page.goto("/payments");
    await page.getByLabel("Method", { exact: true }).selectOption("check");
    await expect(paymentRows(page)).toHaveCount(4); // PAY-1001, 1002, 1005, 1008
    await page.getByLabel("Status", { exact: true }).selectOption("voided");
    await expect(paymentRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(paymentRows(page)).toHaveCount(8);

    await page.getByLabel("Customer", { exact: true }).selectOption("Sarah Mitchell");
    await expect(paymentRows(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search payments").fill("pay-1006");
    await expect(paymentRows(page)).toHaveCount(1);
    await page.getByLabel("Search payments").fill("zzz");
    await expect(page.getByText("No payments match your filters.")).toBeVisible();
  });

  test("shows the approved empty state when nothing has been recorded", async ({ page }) => {
    await page.goto("/payments?state=empty");
    await expect(page.getByText("No payments recorded yet")).toBeVisible();
    await expect(page.getByText("Payments will appear here when you record money received against an Invoice.")).toBeVisible();
    await expectTotals(page, { recorded: "0", received: "$0.00", outstanding: "3", balance: "$965.00" });
    await page.getByRole("button", { name: "View outstanding invoices" }).click();
    await expect(outstandingRows(page)).toHaveCount(3);
  });
});

test.describe("Record payment", () => {
  test("opens the real flow from Payments with the two outstanding invoices only", async ({ page }) => {
    await page.goto("/payments");
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await expect(page).toHaveURL(/\/payments\?record=1$/);
    const dialog = recordDialog(page);
    await expect(dialog).toContainText("Choose the Invoice this payment should be recorded against.");
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    const arthur = dialog.getByRole("radio", { name: /INV-1050/ });
    await expect(arthur).toBeVisible();
    await expect(dialog.getByText("Invoice total: $500.00 · Payments received: $200.00")).toBeVisible();
    await expect(dialog.getByText("Balance due: $300.00")).toBeVisible();
    await expect(dialog.getByText("Balance due: $380.00")).toBeVisible();
    await expect(dialog.getByText("INV-1044")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Select an invoice to continue.");
    await arthur.check();
    await expect(dialog.getByText("Selected: Invoice #INV-1050 (Arthur Pendleton) · Balance due: $300.00")).toBeVisible();
  });

  test("INV-1050 shows its $300 balance, defaults to a full $300 payment and previews the result", async ({ page }) => {
    await page.goto("/payments?record=1");
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: /INV-1050/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(dialog).toContainText("Arthur Pendleton · Balance due $300.00");
    await expect(dialog.getByRole("radio", { name: /^Full payment · \$300\.00/ })).toBeChecked();
    await expect(dialog.getByText("Balance after this payment: $0.00")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Check" })).toBeChecked();
    await expect(dialog.getByLabel("Check number (optional)")).toBeVisible();
    await expect(dialog.getByLabel("Payment date")).toHaveValue("2024-10-25");

    const summary = dialog.getByRole("complementary", { name: "Payment summary" });
    await expect(summary).toContainText("After recording: Paid");
    await expect(summary).toContainText("#INV-1050");
    await expect(summary).toContainText("Arthur Pendleton");
    await expect(summary).toContainText("Invoice total$500.00");
    await expect(summary).toContainText("Previously paid$200.00");
    await expect(summary).toContainText("Payment being recorded$300.00");
    await expect(summary).toContainText("Balance after payment$0.00");
    await expect(summary).toContainText("This payment will be recorded separately and linked to Invoice #INV-1050.");
  });

  test("offers only the approved methods, and the check number only for checks", async ({ page }) => {
    await page.goto("/payments?record=1&invoice=INV-1051");
    const dialog = recordDialog(page);
    const methods = dialog.getByRole("group", { name: "Payment method" });
    await expect(methods.getByRole("radio")).toHaveCount(5);
    for (const name of ["Check", "Card", "Cash", "Bank transfer", "Other"]) await expect(methods.getByRole("radio", { name })).toBeVisible();
    await methods.getByRole("radio", { name: "Card" }).check();
    await expect(dialog.getByLabel("Check number (optional)")).toHaveCount(0);
    await expect(dialog.getByLabel("Internal note (optional)")).toBeVisible();
  });

  test("a partial amount is validated against the balance, with the error tied to the field", async ({ page }) => {
    await page.goto("/payments?record=1&invoice=INV-1050");
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    const amount = dialog.getByLabel("Partial amount (USD)");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByText("Enter an amount between $0.01 and $300.00.")).toBeVisible();
    await expect(amount).toHaveAttribute("aria-invalid", "true");

    await amount.fill("300.01");
    await expect(dialog.getByText("Enter an amount between $0.01 and $300.00.")).toBeVisible();
    await amount.fill("100");
    await expect(dialog.getByText("Enter an amount between $0.01 and $300.00.")).toHaveCount(0);
    await expect(dialog.getByText("Balance after this payment: $200.00")).toBeVisible();
    await expect(dialog.getByRole("complementary", { name: "Payment summary" })).toContainText("After recording: Partially paid");
  });

  test("recording the full $300 creates PAY-1009, pays INV-1050 and leaves a clear confirmation", async ({ page }) => {
    await page.goto("/payments");
    const done = await recordFullPaymentOnInv1050(page);
    await expect(done).toBeVisible();
    await expect(done).toContainText("Payment #PAY-1009 recorded");
    await expect(done).toContainText("Arthur Pendleton");
    await expect(done).toContainText("#INV-1050");
    await expect(done).toContainText("$300.00");
    await expect(done).toContainText("Check");
    await expect(done).toContainText("Oct 25, 2024");
    await expect(done).toContainText("Remaining balance$0.00");
    await expect(done).toContainText("Paid");
    await expect(done.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", "/quotes-invoices/invoices/INV-1050");
    await expect(done.getByRole("link", { name: "View payment" })).toHaveAttribute("href", "/payments/PAY-1009");
    // It is the record flow, not the void flow.
    await expect(page.getByText("Payment voided")).toHaveCount(0);
  });

  test("after closing, Payments shows 8 recorded, $2,430 received, 1 outstanding invoice and $380", async ({ page }) => {
    await page.goto("/payments");
    const done = await recordFullPaymentOnInv1050(page);
    await done.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/payments$/);

    await expectTotals(page, { recorded: "8", received: "$2,430.00", outstanding: "1", balance: "$380.00" });
    await expect(tab(page, "Payments")).toContainText("9");

    const created = paymentRows(page).filter({ hasText: "PAY-1009" });
    await expect(paymentRows(page).first()).toContainText("PAY-1009");
    await expect(created).toContainText("Arthur Pendleton");
    await expect(created).toContainText("#INV-1050");
    await expect(created).toContainText("$300.00");
    await expect(created).toContainText("Check");
    await expect(created).toContainText("Recorded");

    // Historical records are unchanged.
    await expect(paymentRows(page).filter({ hasText: "PAY-1008" })).toContainText("$285.00");
    await expect(paymentRows(page).filter({ hasText: "PAY-1008" })).toContainText("Oct 28, 2024");
    await expect(paymentRows(page).filter({ hasText: "PAY-1008" })).toContainText("Recorded");
    await expect(paymentRows(page).filter({ hasText: "PAY-1001" })).toContainText("Voided");

    await tab(page, "Outstanding invoices").click();
    await expect(outstandingRows(page)).toHaveCount(1);
    await expect(outstandingRows(page).first()).toContainText("INV-1051");
    await expect(outstandingRows(page).first()).toContainText("$380.00");
    await expect(page.getByRole("table", { name: "Outstanding invoices" }).getByText("INV-1050")).toHaveCount(0);
    await expect(page.getByText("Showing 1 of 1 outstanding invoices · Total remaining open balance: $380.00")).toBeVisible();
  });

  test("INV-1050 is Paid with a $0 balance, and PAY-1009 appears in its payment history", async ({ page }) => {
    await page.goto("/payments");
    const done = await recordFullPaymentOnInv1050(page);
    await done.getByRole("link", { name: "View invoice" }).click();

    await expect(page).toHaveURL("/quotes-invoices/invoices/INV-1050");
    await expect(page.locator("header").filter({ hasText: "INV-1050" }).last()).toContainText("Paid");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$0.00");
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    const history = page.getByRole("table", { name: "Payments for this invoice" });
    await expect(history.locator("tbody tr")).toHaveCount(1);
    await expect(history).toContainText("PAY-1009");
    await expect(page.getByRole("region", { name: "Invoice items" })).toContainText("Previously paid");
  });

  test("the new totals persist across navigation and across a reload, because the payment is stored", async ({ page }) => {
    await page.goto("/payments");
    const done = await recordFullPaymentOnInv1050(page);
    await done.getByRole("button", { name: "Close", exact: true }).click();

    // Navigate away (client-side) and back.
    await primaryNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$2,430");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("8 recorded non-voided payments");
    await primaryNav(page).getByRole("link", { name: "Quotes & Invoices" }).click();
    await page.getByRole("tab", { name: /^Invoices/ }).click();
    await expect(page.getByRole("table", { name: "Invoices" }).locator("tbody tr").filter({ hasText: "INV-1050" })).toContainText("Paid");
    await primaryNav(page).getByRole("link", { name: "Payments" }).click();
    await expectTotals(page, { recorded: "8", received: "$2,430.00", outstanding: "1", balance: "$380.00" });
    await expect(paymentRows(page).first()).toContainText("PAY-1009");

    // The payment is in the database: a reload keeps it, and so does the Overview.
    await page.reload();
    await expectTotals(page, { recorded: "8", received: "$2,430.00", outstanding: "1", balance: "$380.00" });
    await expect(page.getByRole("link", { name: "View payment PAY-1009" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Key metrics" })).toContainText("$2,430");
  });

  test("the Overview quick action opens this same flow, ending in the same PAY-1009 and totals", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "Core Operational Workflows" }).getByRole("link", { name: /Record payment/ }).click();
    await expect(page).toHaveURL(/\/payments\?record=1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    const dialog = recordDialog(page);
    await expect(dialog.getByRole("radio")).toHaveCount(2);

    await dialog.getByRole("radio", { name: /INV-1050/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    const done = page.getByRole("dialog", { name: "Payment recorded" });
    await expect(done).toContainText("Payment #PAY-1009 recorded");
    await done.getByRole("button", { name: "Close", exact: true }).click();
    await expectTotals(page, { recorded: "8", received: "$2,430.00", outstanding: "1", balance: "$380.00" });
  });

  test("Record payment on an Outstanding row skips the selection and a partial payment leaves the invoice open", async ({ page }) => {
    await page.goto("/payments?tab=outstanding");
    await page.getByRole("button", { name: "Record payment for invoice INV-1051" }).click();
    const dialog = recordDialog(page);
    await expect(dialog).toContainText("Maya Lin · Balance due $380.00");
    await expect(dialog.getByRole("button", { name: "Back" })).toHaveCount(0);

    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    await dialog.getByLabel("Partial amount (USD)").fill("100");
    await dialog.getByRole("radio", { name: "Card" }).check();
    await dialog.getByLabel("Internal note (optional)").fill("Deposit by phone");
    await dialog.getByRole("button", { name: "Record payment" }).click();

    const done = page.getByRole("dialog", { name: "Payment recorded" });
    await expect(done).toContainText("Payment #PAY-1009 recorded");
    await expect(done).toContainText("Remaining balance$280.00");
    await expect(done).toContainText("Partially paid");
    await done.getByRole("button", { name: "Close", exact: true }).click();

    await expectTotals(page, { recorded: "8", received: "$2,230.00", outstanding: "2", balance: "$580.00" });
    await expect(outstandingRows(page).filter({ hasText: "INV-1051" })).toContainText("$280.00");
    await expect(outstandingRows(page).filter({ hasText: "INV-1051" })).toContainText("Partially paid");
  });

  test("the dialog is keyboard-operable: focus moves to the step heading and Escape cancels without recording", async ({ page }) => {
    await page.goto("/payments");
    const open = page.getByRole("button", { name: "Record payment" }).first();
    await open.click();
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: /INV-1050/ }).focus();
    await page.keyboard.press("Space");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { level: 3 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(open).toBeFocused();
    await expectTotals(page, { recorded: "7", received: "$2,130.00", outstanding: "2", balance: "$680.00" });
  });
});

test.describe("Payment detail", () => {
  test("a recorded payment shows its facts, its customer and its related records", async ({ page }) => {
    await page.goto("/payments/PAY-1008");
    await expect(page.getByRole("heading", { level: 1, name: "Payment #PAY-1008" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("header").filter({ hasText: "PAY-1008" }).last()).toContainText("Recorded");
    const summary = page.getByRole("region", { name: "Payment summary" });
    await expect(summary).toContainText("$285.00");
    await expect(summary).toContainText("Oct 28, 2024");
    await expect(summary).toContainText("Check");
    await expect(summary).toContainText("Alex Morgan · Apex Climate Heating & Air");
    await expect(summary).toContainText("Recorded against Invoice #INV-1044. Remaining balance on invoice: $0.00.");
    await expect(page.getByRole("region", { name: "Customer", exact: true })).toContainText("Sarah Mitchell");
    await expect(page.getByRole("region", { name: "Related records" })).toContainText("Invoice #INV-1044");
    await expect(page.getByRole("region", { name: "Related records" })).toContainText("Job #JB-204");
    await expect(page.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", "/quotes-invoices/invoices/INV-1044");
    await expect(page.getByRole("button", { name: "Void payment" })).toBeVisible();
    await expect(page.getByText("No internal note added.")).toBeVisible();
  });

  test("the historical PAY-1001 is clearly Voided, counts for nothing and cannot be voided again", async ({ page }) => {
    await page.goto("/payments/PAY-1001");
    await expect(page.locator("header").filter({ hasText: "PAY-1001" }).last()).toContainText("Voided");
    await expect(page.getByText("This payment was voided and no longer affects the invoice balance.")).toBeVisible();
    await expect(page.getByText("Void reason: Payment entered by mistake · Void date: Oct 25, 2024 · Voided by: Alex Morgan")).toBeVisible();
    const summary = page.getByRole("region", { name: "Payment summary" });
    await expect(summary).toContainText("Original recorded amount · not counted");
    await expect(summary).toContainText("Contribution to invoice$0.00");
    await expect(page.getByRole("button", { name: "Void payment" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Activity" })).toContainText("Payment voided by Alex Morgan");
    await expect(page.getByRole("region", { name: "Activity" })).toContainText("Payment recorded by Alex Morgan");
    // Product wording: no ledger / audit / settlement language.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const term of ["ledger", "audit", "settlement", "gateway", "processor", "reconciliation"]) expect(text).not.toContain(term);
  });

  test("an unknown payment (and a payment that was never created) shows a not-found state", async ({ page }) => {
    await page.goto("/payments/PAY-9999");
    await expect(page.getByText("Payment not found")).toBeVisible();
    await page.goto("/payments/PAY-1009");
    await expect(page.getByText("Payment not found")).toBeVisible();
  });
});

test.describe("Void payment: a separate, historical flow", () => {
  test("voiding asks for a reason, then reopens the invoice and recomputes every total, without creating PAY-1009", async ({ page }) => {
    await page.goto("/payments/PAY-1008");
    await page.getByRole("button", { name: "Void payment" }).click();
    const dialog = page.getByRole("dialog", { name: "Void Payment #PAY-1008?" });
    await expect(dialog).toContainText("Status: Recorded");
    await expect(dialog).toContainText("Voided");
    await expect(dialog).toContainText("Paid total$285.00 → $0.00");
    await expect(dialog).toContainText("Balance due$0.00 → $285.00");
    await expect(dialog).toContainText("The related quote, job and booking are not changed.");

    await dialog.getByRole("button", { name: "Void payment" }).click();
    await expect(dialog.getByText("Select a reason for voiding this payment.")).toBeVisible();
    await expect(dialog.getByLabel("Reason for voiding")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Reason for voiding").selectOption("Incorrect amount");
    await dialog.getByLabel("Internal note (optional)").fill("Entered against the wrong invoice");
    await dialog.getByRole("button", { name: "Void payment" }).click();

    const done = page.getByRole("dialog", { name: "Payment voided" });
    await expect(done).toContainText("Payment #PAY-1008 voided");
    await expect(done).toContainText("Payment #PAY-1008 no longer contributes to Invoice #INV-1044.");
    await expect(done).toContainText("Invoice balance due$285.00");
    await expect(done).toContainText("Unpaid");
    await expect(done.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", "/quotes-invoices/invoices/INV-1044");
    await done.getByRole("button", { name: "Close", exact: true }).click();

    // The payment page now shows it as Voided.
    await expect(page.getByText("Void reason: Incorrect amount")).toBeVisible();
    await expect(page.getByRole("button", { name: "Void payment" })).toHaveCount(0);

    // Totals fall back to the figures before PAY-1008, and nothing new was recorded.
    await primaryNav(page).getByRole("link", { name: "Payments" }).click();
    await expectTotals(page, { recorded: "6", received: "$1,845.00", outstanding: "3", balance: "$965.00" });
    await expect(tab(page, "Payments")).toContainText("8");
    await expect(page.getByRole("link", { name: "View payment PAY-1009" })).toHaveCount(0);
    await tab(page, "Outstanding invoices").click();
    await expect(outstandingRows(page).filter({ hasText: "INV-1044" })).toContainText("$285.00");
    await expect(outstandingRows(page).filter({ hasText: "INV-1044" })).toContainText("Unpaid");
  });

  test("the reopened invoice shows the Unpaid-after-void state and can then be paid again as PAY-1009", async ({ page }) => {
    await page.goto("/payments/PAY-1008");
    await page.getByRole("button", { name: "Void payment" }).click();
    const dialog = page.getByRole("dialog", { name: "Void Payment #PAY-1008?" });
    await dialog.getByLabel("Reason for voiding").selectOption("Duplicate payment");
    await dialog.getByRole("button", { name: "Void payment" }).click();
    await page.getByRole("dialog", { name: "Payment voided" }).getByRole("link", { name: "View invoice" }).click();

    await expect(page).toHaveURL("/quotes-invoices/invoices/INV-1044");
    await expect(page.locator("header").filter({ hasText: "INV-1044" }).last()).toContainText("Unpaid");
    await expect(page.getByText("Payment #PAY-1008 was voided. Invoice #INV-1044 now has a balance due of $285.00.")).toBeVisible();
    const history = page.getByRole("table", { name: "Payments for this invoice" });
    await expect(history.locator("tbody tr")).toHaveCount(2);
    await expect(history.locator("tbody tr").filter({ hasText: "PAY-1001" })).toContainText("Voided");
    await expect(history.locator("tbody tr").filter({ hasText: "PAY-1008" })).toContainText("Voided");

    await page.getByRole("button", { name: "Record payment" }).first().click();
    const record = recordDialog(page);
    await expect(record).toContainText("Sarah Mitchell · Balance due $285.00");
    await record.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toContainText("Payment #PAY-1009 recorded");
  });

  test("Record payment and Void payment never share a screen, and PAY-1001 is never reused", async ({ page }) => {
    await page.goto("/payments");
    const done = await recordFullPaymentOnInv1050(page);
    await expect(done).toContainText("PAY-1009");
    await expect(done).not.toContainText("PAY-1001");
    await expect(done.getByText("voided")).toHaveCount(0);
    await done.getByRole("button", { name: "Close", exact: true }).click();
    await expect(paymentRows(page).filter({ hasText: "PAY-1001" })).toHaveCount(1);
    await expect(paymentRows(page).filter({ hasText: "PAY-1001" })).toContainText("Voided");
  });

  test("a voided payment stays voided after a reload: still in history, still counted for nothing", async ({ page }) => {
    await page.goto("/payments/PAY-1008");
    await page.getByRole("button", { name: "Void payment" }).click();
    await page.getByRole("dialog", { name: "Void Payment #PAY-1008?" }).getByLabel("Reason for voiding").selectOption("Other");
    await page.getByRole("dialog", { name: "Void Payment #PAY-1008?" }).getByRole("button", { name: "Void payment" }).click();
    await page.getByRole("dialog", { name: "Payment voided" }).getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await expect(page.locator("header").filter({ hasText: "PAY-1008" }).last()).toContainText("Voided");
    await expect(page.getByRole("button", { name: "Void payment" })).toHaveCount(0);
    await page.goto("/payments");
    await expectTotals(page, { recorded: "6", received: "$1,845.00", outstanding: "3", balance: "$965.00" });
    await expect(paymentRows(page).filter({ hasText: "PAY-1008" })).toContainText("Voided");
  });
});
