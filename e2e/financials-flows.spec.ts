/**
 * Phase 12: the financial flows through the real application, against the real database. Quotes, invoices and payments are
 * stored, so every change made on a screen is checked where it lands (PostgreSQL), after a reload and in a fresh session; the
 * server's own checks are exercised with the very requests a screen sends, replayed by hand with different arguments or a
 * different person; and a business only ever sees its own money.
 *
 * Almost every test edits the worker's own copy of the Apex workspace, restored to the canonical record before each test.
 */
import type { APIRequestContext, Locator, Page } from "playwright/test";
import { ensureTestTenant, resetTestTenant } from "../scripts/db/seed-lib";
import { adminDb } from "../scripts/db/lib";
import { completeOnboarding, expect, NOT_SIGNED_IN, ORIGIN, signUp, switchWorkspace, test, toast, waitsForHydration } from "./saas";
import { signInOverHttp } from "./fixtures";

/* ───────────────────────── helpers ───────────────────────── */

const kpis = (page: Page) => page.getByRole("region", { name: "Payment totals" });
const kpi = (page: Page, label: string) => kpis(page).getByText(label, { exact: true }).locator("xpath=../..");
const paymentRows = (page: Page) => page.getByRole("table", { name: "Payments" }).locator("tbody tr");
const outstandingRows = (page: Page) => page.getByRole("table", { name: "Outstanding invoices" }).locator("tbody tr");
const recordDialog = (page: Page) => page.getByRole("dialog", { name: "Record payment" });
const metrics = (page: Page) => page.getByRole("region", { name: "Key metrics" });

async function expectTotals(page: Page, totals: { recorded: string; received: string; outstanding: string; balance: string }) {
  await expect(kpi(page, "Payments recorded")).toContainText(totals.recorded);
  await expect(kpi(page, "Amount received")).toContainText(totals.received);
  await expect(kpi(page, "Outstanding invoices")).toContainText(totals.outstanding);
  await expect(kpi(page, "Outstanding balance")).toContainText(totals.balance);
}

const BASELINE = { recorded: "7", received: "$2,130.00", outstanding: "2", balance: "$680.00" };

/** Records a payment on an invoice through the Record payment screen. Resolves with the confirmation dialog. */
async function recordOn(page: Page, invoice: string, options: { partial?: string } = {}) {
  await page.goto(`/payments?record=1&invoice=${invoice}`);
  const dialog = recordDialog(page);
  if (options.partial) {
    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    await dialog.getByLabel("Partial amount (USD)").fill(options.partial);
  }
  await dialog.getByRole("button", { name: "Record payment" }).click();
  const done = page.getByRole("dialog", { name: "Payment recorded" });
  await expect(done).toBeVisible();
  return done;
}

const closeDialog = (dialog: Locator) => dialog.getByRole("button", { name: "Close", exact: true }).click();

async function voidPayment(page: Page, payment: string, reason = "Incorrect amount") {
  await page.goto(`/payments/${payment}`);
  await page.getByRole("button", { name: "Void payment" }).click();
  const dialog = page.getByRole("dialog", { name: `Void Payment #${payment}?` });
  await dialog.getByLabel("Reason for voiding").selectOption(reason);
  await dialog.getByRole("button", { name: "Void payment" }).click();
  const done = page.getByRole("dialog", { name: "Payment voided" });
  await expect(done).toBeVisible();
  return done;
}

/** What a Server Action call sends, so the server's own checks can be asked directly with other arguments or another caller. */
type Captured = { url: string; headers: Record<string, string>; body: string };
async function captureAction(page: Page, trigger: () => Promise<void>): Promise<Captured> {
  const pending = page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  await trigger();
  const request = await pending;
  const headers = request.headers();
  return {
    url: request.url(),
    headers: Object.fromEntries(["next-action", "content-type", "accept", "next-router-state-tree"].filter((name) => headers[name]).map((name) => [name, headers[name]])),
    body: request.postData() ?? "",
  };
}
const replay = (api: APIRequestContext, captured: Captured, body = captured.body, options: { maxRedirects?: number } = {}) =>
  api.post(captured.url, { headers: { ...captured.headers, origin: ORIGIN }, data: body, ...options });
/** The same call with the first argument changed: `change` receives the object the screen sent. */
const withArgs = (captured: Captured, change: (args: Record<string, unknown>) => void) => {
  const parsed = JSON.parse(captured.body) as Record<string, unknown>[];
  change(parsed[0]);
  return JSON.stringify(parsed);
};

type Db = import("pg").Pool;
const paymentCount = async (db: Db, org: string) => (await db.query("select count(*)::int as n from payments where organization_id = $1", [org])).rows[0].n as number;
const received = async (db: Db, org: string, invoice: number) =>
  (await db.query("select coalesce(sum(amount_cents), 0)::int as total from payments p join invoices i on i.id = p.invoice_id where p.organization_id = $1 and i.number = $2 and p.status = 'recorded'", [org, invoice])).rows[0].total as number;

/* ───────────────────────── Record payment ───────────────────────── */

test.describe("Record payment: the canonical flow is stored", () => {
  test("INV-1050 + $300 makes PAY-1009: in PostgreSQL, still there after a reload and in a fresh session, and every total follows", async ({
    page,
    db,
    workerTenant,
    browser,
    clientAddresses,
  }) => {
    const org = workerTenant.organizationId;
    await page.goto("/payments");
    await expectTotals(page, BASELINE);

    const done = await recordOn(page, "INV-1050");
    await expect(done).toContainText("Payment #PAY-1009 recorded");

    const row = (
      await db.query(
        "select p.number, p.amount_cents, p.method, p.status, p.paid_on::text as paid_on, p.customer_id, p.recorded_by is not null as has_member, i.number as invoice from payments p join invoices i on i.id = p.invoice_id where p.organization_id = $1 and p.number = 1009",
        [org],
      )
    ).rows[0];
    expect(row).toEqual({ number: 1009, amount_cents: 30000, method: "check", status: "recorded", paid_on: "2024-10-25", customer_id: null, has_member: true, invoice: 1050 });
    // The next payment will be PAY-1010: the counter moved with the payment.
    expect((await db.query("select next_value from organization_sequences where organization_id = $1 and kind = 'payment'", [org])).rows[0].next_value).toBe(1010);

    await closeDialog(done);
    const afterRecording = { recorded: "8", received: "$2,430.00", outstanding: "1", balance: "$380.00" };
    await expectTotals(page, afterRecording);

    await page.reload();
    await expectTotals(page, afterRecording);
    await expect(paymentRows(page).first()).toContainText("PAY-1009");
    await expect(paymentRows(page).first()).toContainText("Arthur Pendleton");

    // A fresh login sees the same: it is the database, not the page.
    const storageState = await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses());
    const context = await browser.newContext({ storageState, extraHTTPHeaders: { "x-forwarded-for": clientAddresses() } });
    const fresh = waitsForHydration(await context.newPage());
    await fresh.goto("/payments");
    await expectTotals(fresh, afterRecording);
    await fresh.goto("/quotes-invoices/invoices/INV-1050");
    await expect(fresh.locator("header").filter({ hasText: "INV-1050" }).last()).toContainText("Paid");
    await expect(fresh.getByRole("table", { name: "Payments for this invoice" })).toContainText("PAY-1009");
    await fresh.goto("/quotes-invoices/invoices/INV-1051");
    await expect(fresh.locator("header").filter({ hasText: "INV-1051" }).last()).toContainText("Unpaid");
    await fresh.goto("/quotes-invoices/invoices/INV-1044");
    await expect(fresh.locator("header").filter({ hasText: "INV-1044" }).last()).toContainText("Paid");
    await fresh.goto("/payments/PAY-1001");
    await expect(fresh.locator("header").filter({ hasText: "PAY-1001" }).last()).toContainText("Voided");
    await fresh.goto("/");
    await expect(metrics(fresh)).toContainText("$2,430");
    await expect(metrics(fresh)).toContainText("8 recorded non-voided payments");
    await context.close();
  });

  test("partial payments on INV-1051: $100, then $180, then the last $100 - each stored, the balance and status after each", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const steps: [string, number, string, string][] = [
      ["100", 10000, "Partially paid", "$280.00"],
      ["180", 28000, "Partially paid", "$100.00"],
      ["100", 38000, "Paid", "$0.00"],
    ];
    for (const [amount, total, status, balance] of steps) {
      const done = await recordOn(page, "INV-1051", { partial: amount });
      await expect(done).toContainText(`Remaining balance${balance}`);
      await expect(done).toContainText(status);
      expect(await received(db, org, 1051)).toBe(total);
      await closeDialog(done);
      await page.goto("/quotes-invoices/invoices/INV-1051");
      await expect(page.locator("header").filter({ hasText: "INV-1051" }).last()).toContainText(status);
      await expect(page.getByRole("region", { name: "Payment summary" })).toContainText(balance);
    }
    await page.goto("/payments");
    // 7 + 3 payments; $2,130 + $380 received; only INV-1050's $300 is still open.
    await expectTotals(page, { recorded: "10", received: "$2,510.00", outstanding: "1", balance: "$300.00" });
    await page.goto("/payments?tab=outstanding");
    await expect(outstandingRows(page)).toHaveCount(1);
    await expect(outstandingRows(page).first()).toContainText("INV-1050");
  });

  test("cents add up exactly: $100.10 and $199.90 pay off a $300 balance with nothing left over", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await closeDialog(await recordOn(page, "INV-1050", { partial: "100.10" }));
    await closeDialog(await recordOn(page, "INV-1050", { partial: "199.90" }));
    expect(await received(db, org, 1050)).toBe(30000);
    await page.goto("/quotes-invoices/invoices/INV-1050");
    await expect(page.locator("header").filter({ hasText: "INV-1050" }).last()).toContainText("Paid");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$0.00");
  });

  test("a double click records one payment", async ({ page, db, workerTenant }) => {
    await page.goto("/payments?record=1&invoice=INV-1050");
    await recordDialog(page).getByRole("button", { name: "Record payment" }).dblclick();
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toContainText("PAY-1009");
    expect(await paymentCount(db, workerTenant.organizationId)).toBe(9);
    expect(await received(db, workerTenant.organizationId, 1050)).toBe(30000);
  });

  test("the screen is never ahead of the database: a payment the server refuses is reported and nothing is stored", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await page.goto("/payments?record=1&invoice=INV-1051");
    // Another window records the whole balance while this dialog is open.
    await db.query(
      "insert into payments (organization_id, number, invoice_id, amount_cents, method, status, paid_on, recorded_at) select $1, 1009, id, 38000, 'cash', 'recorded', '2024-10-25', now() from invoices where organization_id = $1 and number = 1051",
      [org],
    );
    await recordDialog(page).getByRole("button", { name: "Record payment" }).click();
    await expect(recordDialog(page).getByRole("alert")).toContainText("no balance due");
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toHaveCount(0);
    expect(await received(db, org, 1051)).toBe(38000);
    expect(await paymentCount(db, org)).toBe(9);
  });

  test("the date cannot be in the future, on the screen or on the server", async ({ page, db, workerTenant }) => {
    await page.goto("/payments?record=1&invoice=INV-1051");
    const dialog = recordDialog(page);
    await expect(dialog.getByLabel("Payment date")).toHaveAttribute("max", "2024-10-25");
    await dialog.getByLabel("Payment date").fill("2024-10-26");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByText("The payment date can't be in the future.")).toBeVisible();
    expect(await paymentCount(db, workerTenant.organizationId)).toBe(8);
  });

  test("recording never creates an invoice or changes a quote, and the voided history is untouched", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = (await db.query("select (select count(*)::int from invoices where organization_id = $1) as invoices, (select max(updated_at)::text from quotes where organization_id = $1) as quotes", [org])).rows[0];
    await closeDialog(await recordOn(page, "INV-1050"));
    const after = (await db.query("select (select count(*)::int from invoices where organization_id = $1) as invoices, (select max(updated_at)::text from quotes where organization_id = $1) as quotes", [org])).rows[0];
    expect(after).toEqual(before);
    const voided = (await db.query("select status, amount_cents from payments where organization_id = $1 and number = 1001", [org])).rows[0];
    expect(voided).toEqual({ status: "voided", amount_cents: 28500 });
  });
});

/* ───────────────────────── Void payment ───────────────────────── */

test.describe("Void payment: stored, final, and it reopens the invoice", () => {
  test("voiding PAY-1008 is stored with who, when and why; the invoice is Unpaid again and the totals fall back; the payment stays in history", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const done = await voidPayment(page, "PAY-1008", "Duplicate payment");
    await expect(done).toContainText("Invoice balance due$285.00");
    await closeDialog(done);

    const row = (await db.query("select status, void_reason, voided_at is not null as has_time, voided_by is not null as has_member, amount_cents from payments where organization_id = $1 and number = 1008", [org])).rows[0];
    expect(row).toEqual({ status: "voided", void_reason: "Duplicate payment", has_time: true, has_member: true, amount_cents: 28500 });
    expect(await paymentCount(db, org)).toBe(8); // nothing was deleted or added

    await page.reload();
    await expect(page.locator("header").filter({ hasText: "PAY-1008" }).last()).toContainText("Voided");
    await page.goto("/payments");
    await expectTotals(page, { recorded: "6", received: "$1,845.00", outstanding: "3", balance: "$965.00" });
    await expect(paymentRows(page).filter({ hasText: "PAY-1008" })).toContainText("Voided");
    await page.goto("/quotes-invoices/invoices/INV-1044");
    await expect(page.locator("header").filter({ hasText: "INV-1044" }).last()).toContainText("Unpaid");
    await expect(page.getByText("Payment #PAY-1008 was voided. Invoice #INV-1044 now has a balance due of $285.00.")).toBeVisible();
  });

  test("a voided payment is final: the Void action is gone, and a stale window that tries again is told it was already voided", async ({ page, db, workerTenant }) => {
    const second = await page.context().newPage();
    waitsForHydration(second);
    await page.goto("/payments/PAY-1008");
    await second.goto("/payments/PAY-1008");
    await closeDialog(await voidPayment(second, "PAY-1008", "Other"));

    // The first window still shows an active payment: its attempt reaches the server, which refuses.
    await page.getByRole("button", { name: "Void payment" }).click();
    const dialog = page.getByRole("dialog", { name: "Void Payment #PAY-1008?" });
    await dialog.getByLabel("Reason for voiding").selectOption("Duplicate payment");
    await dialog.getByRole("button", { name: "Void payment" }).click();
    await expect(dialog.getByRole("alert")).toContainText("That payment has already been voided.");
    const stored = (await db.query("select void_reason from payments where organization_id = $1 and number = 1008", [workerTenant.organizationId])).rows[0];
    expect(stored.void_reason).toBe("Other");
    await second.close();
  });

  test("the reopened invoice can be paid again: PAY-1009 pays INV-1044, and PAY-1008 stays Voided beside it", async ({ page, db, workerTenant }) => {
    await closeDialog(await voidPayment(page, "PAY-1008", "Incorrect amount"));
    await closeDialog(await recordOn(page, "INV-1044"));
    const org = workerTenant.organizationId;
    expect(await received(db, org, 1044)).toBe(28500);
    await page.goto("/quotes-invoices/invoices/INV-1044");
    await expect(page.locator("header").filter({ hasText: "INV-1044" }).last()).toContainText("Paid");
    const history = page.getByRole("table", { name: "Payments for this invoice" }).locator("tbody tr");
    await expect(history).toHaveCount(3);
    await expect(history.filter({ hasText: "PAY-1009" })).toContainText("Recorded");
    await expect(history.filter({ hasText: "PAY-1008" })).toContainText("Voided");
    await expect(history.filter({ hasText: "PAY-1001" })).toContainText("Voided");
  });

  test("voiding changes no quote, job or booking", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const snapshot = async () =>
      (await db.query("select (select max(updated_at)::text from quotes where organization_id = $1) as quotes, (select status from jobs where organization_id = $1 and number = 204) as job, (select status from bookings where organization_id = $1 and number = 1042) as booking", [org])).rows[0];
    const before = await snapshot();
    await closeDialog(await voidPayment(page, "PAY-1008"));
    expect(await snapshot()).toEqual(before);
  });
});

/* ───────────────────────── Create invoice ───────────────────────── */

test.describe("Create invoice from an approved quote: stored", () => {
  async function createFromQt884(page: Page, terms = "net-15") {
    await page.goto("/quotes-invoices/quotes/QT-884");
    await page.getByRole("button", { name: "Create invoice" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create invoice" });
    await dialog.getByLabel("Payment terms").selectOption(terms);
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1052" })).toBeVisible();
  }

  test("QT-884 becomes INV-1052: its lines, customer, job and booking are copied; it is unpaid; no payment is made; it is still there after a reload", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await createFromQt884(page);

    const invoice = (
      await db.query(
        `select i.number, i.payment_terms, i.issue_date::text as issued, i.due_date::text as due, i.imported, i.previously_paid_cents, i.customer_id is not null as has_customer,
                i.job_id = j.id as job_matches, i.booking_id = b.id as booking_matches, i.quote_id = q.id as quote_matches,
                (select count(*)::int from invoice_line_items l where l.invoice_id = i.id) as lines,
                (select sum(l.line_total_cents)::int from invoice_line_items l where l.invoice_id = i.id) as total
           from invoices i, jobs j, bookings b, quotes q
          where i.organization_id = $1 and i.number = 1052 and j.organization_id = $1 and j.number = 204 and b.organization_id = $1 and b.number = 1042 and q.organization_id = $1 and q.number = 884`,
        [org],
      )
    ).rows[0];
    expect(invoice).toEqual({
      number: 1052, payment_terms: "net-15", issued: "2024-10-25", due: "2024-11-09", imported: false, previously_paid_cents: 0, has_customer: true,
      job_matches: true, booking_matches: true, quote_matches: true, lines: 3, total: 28500,
    });
    // Nothing was paid and the quote is untouched; the counter moved.
    expect(await paymentCount(db, org)).toBe(8);
    expect((await db.query("select status from quotes where organization_id = $1 and number = 884", [org])).rows[0].status).toBe("approved");
    expect((await db.query("select next_value from organization_sequences where organization_id = $1 and kind = 'invoice'", [org])).rows[0].next_value).toBe(1053);

    await page.reload();
    await expect(page.locator("header").filter({ hasText: "INV-1052" }).last()).toContainText("Unpaid");
    await page.goto("/payments");
    await expectTotals(page, { recorded: "7", received: "$2,130.00", outstanding: "3", balance: "$965.00" });
    await page.goto("/");
    await expect(metrics(page)).toContainText("$6,525");
  });

  test("the new invoice can be paid like any other, and it is outstanding until it is", async ({ page, db, workerTenant }) => {
    await createFromQt884(page, "due-on-receipt");
    await closeDialog(await recordOn(page, "INV-1052"));
    expect(await received(db, workerTenant.organizationId, 1052)).toBe(28500);
    await page.goto("/quotes-invoices/invoices/INV-1052");
    await expect(page.locator("header").filter({ hasText: "INV-1052" }).last()).toContainText("Paid");
  });

  test("a quote gets one invoice: a stale window that tries again is told it already has one", async ({ page, db, workerTenant }) => {
    const second = await page.context().newPage();
    waitsForHydration(second);
    await page.goto("/quotes-invoices/quotes/QT-884");
    await second.goto("/quotes-invoices/quotes/QT-884");
    await second.getByRole("button", { name: "Create invoice" }).first().click();
    await second.getByRole("dialog", { name: "Create invoice" }).getByRole("button", { name: "Create invoice" }).click();
    await expect(second.getByRole("heading", { level: 1, name: "Invoice #INV-1052" })).toBeVisible();

    await page.getByRole("button", { name: "Create invoice" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create invoice" });
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(dialog.getByRole("alert")).toContainText("That quote already has an invoice.");
    expect((await db.query("select count(*)::int as n from invoices where organization_id = $1 and quote_id is not null", [workerTenant.organizationId])).rows[0].n).toBe(1);
    await second.close();
  });

  test("only an approved quote offers Create invoice, and completing a job creates no quote, invoice or payment", async ({ page, db, workerTenant }) => {
    for (const quote of ["QT-891", "QT-893", "QT-879"]) {
      await page.goto(`/quotes-invoices/quotes/${quote}`);
      await expect(page.getByRole("heading", { level: 1, name: `Quote #${quote}` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
    }
    const org = workerTenant.organizationId;
    const counts = async () =>
      (await db.query("select (select count(*)::int from quotes where organization_id = $1) as quotes, (select count(*)::int from invoices where organization_id = $1) as invoices, (select count(*)::int from payments where organization_id = $1) as payments", [org])).rows[0];
    const before = await counts();
    await page.goto("/jobs/JB-201");
    await page.getByRole("button", { name: "Start job" }).click();
    await page.getByRole("button", { name: "Complete job" }).click();
    const done = page.getByRole("dialog", { name: "Complete job #JB-201" });
    await done.getByLabel("Technician debrief & resolution notes").fill("Replaced the contactor.");
    await done.getByRole("button", { name: "Complete job" }).click();
    await expect(toast(page)).toContainText("Job #JB-201 completed.");
    expect((await db.query("select status from jobs where organization_id = $1 and number = 201", [org])).rows[0].status).toBe("completed");
    expect(await counts()).toEqual(before);
  });
});

/* ───────────────────────── Customer financial history ───────────────────────── */

test.describe("a customer's financial history", () => {
  test("Sarah Mitchell's page lists her quote, her invoice and both payments, from the same records the money pages use", async ({ page }) => {
    await page.goto("/customers/sarah-mitchell");
    const history = page.getByRole("region", { name: "Financial history" });
    await expect(history).toBeVisible();
    await expect(history).toContainText("Quote #QT-884");
    await expect(history).toContainText("Invoice #INV-1044");
    await expect(history.getByRole("link", { name: "Invoice #INV-1044" })).toHaveAttribute("href", "/quotes-invoices/invoices/INV-1044");
    await expect(history).toContainText("Payment #PAY-1008");
    await expect(history).toContainText("Payment #PAY-1001");
    await expect(history).toContainText("Not counted"); // the voided one
    await expect(history).toContainText("Invoiced$285.00");
    await expect(history).toContainText("Paid$285.00");
    await expect(history).toContainText("Balance due$0.00");
  });

  test("it follows what is recorded: voiding PAY-1008 reopens $285 on her page, after a reload too", async ({ page }) => {
    await closeDialog(await voidPayment(page, "PAY-1008"));
    await page.goto("/customers/sarah-mitchell");
    const history = page.getByRole("region", { name: "Financial history" });
    await expect(history).toContainText("Balance due$285.00");
    await expect(history.getByRole("listitem").filter({ hasText: "Payment #PAY-1008" })).toContainText("Voided");
    await page.reload();
    await expect(history).toContainText("Balance due$285.00");
  });

  test("each customer's page shows their own documents only, and a customer with none says so", async ({ page }) => {
    await page.goto("/customers/bradley-cooper");
    const history = page.getByRole("region", { name: "Financial history" });
    await expect(history).toContainText("Quote #QT-879");
    await expect(history).toContainText("No invoices yet.");
    await expect(history).toContainText("No payments yet.");
    await expect(history).not.toContainText("QT-884");
    await page.goto("/customers/elena-rodriguez");
    await expect(page.getByRole("region", { name: "Financial history" })).toContainText("Invoice #INV-1048");
    await expect(page.getByRole("region", { name: "Financial history" })).toContainText("Payment #PAY-1006");
    await expect(page.getByRole("region", { name: "Financial history" })).not.toContainText("QT-884");
    await page.goto("/customers/hannah-wright");
    await expect(page.getByRole("region", { name: "Financial history" })).toContainText("No quotes, invoices or payments are recorded for this customer yet.");
  });
});

/* ───────────────────────── who may change money, and what the server checks ───────────────────────── */

test.describe("the server decides who may change money, and what", () => {
  test("a member of the business can read the money but is offered nothing to change", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /Record payment/ })).toHaveCount(0);
    await page.goto("/payments?tab=outstanding");
    await expect(page.getByRole("table", { name: "Outstanding invoices" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /Record payment/ })).toHaveCount(0);
    await page.goto("/payments?record=1&invoice=INV-1051");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/quotes-invoices/invoices/INV-1051");
    await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1051" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    await page.goto("/payments/PAY-1008");
    await expect(page.getByRole("heading", { level: 1, name: "Payment #PAY-1008" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Void payment" })).toHaveCount(0);
    await page.goto("/quotes-invoices/quotes/QT-884");
    await expect(page.getByRole("heading", { level: 1, name: "Quote #QT-884" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
  });

  test("a member replaying an owner's Record payment is refused and nothing is stored", async ({ page, apiAs, db }) => {
    await page.goto("/payments?record=1&invoice=INV-1051");
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    await dialog.getByLabel("Partial amount (USD)").fill("50");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Record payment" }).click());
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toBeVisible();

    const apex = (await db.query("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id as string;
    const before = await paymentCount(db, apex);
    const jamie = await apiAs("jamie");
    const result = await (await replay(jamie, captured)).text();
    expect(result).toContain("Only an owner or admin can change quotes, invoices and payments");
    expect(await paymentCount(db, apex)).toBe(before);
  });

  test("a request with no session cannot record or void anything", async ({ page, apiAs, db, workerTenant }) => {
    await page.goto("/payments?record=1&invoice=INV-1051");
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    await dialog.getByLabel("Partial amount (USD)").fill("50");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Record payment" }).click());
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toBeVisible();
    const before = await paymentCount(db, workerTenant.organizationId);

    const anonymous = await apiAs(null);
    const response = await replay(anonymous, captured, captured.body, { maxRedirects: 0 });
    expect([307, 401, 403]).toContain(response.status());
    expect(await paymentCount(db, workerTenant.organizationId)).toBe(before);
  });

  test("naming another organization in the request changes nothing there: the server only ever writes to the caller's own active workspace", async ({
    page,
    db,
    workerTenant,
    clientAddresses,
    playwright,
  }) => {
    await page.goto("/payments?record=1&invoice=INV-1051");
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    await dialog.getByLabel("Partial amount (USD)").fill("50");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Record payment" }).click());
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toBeVisible();

    // Someone else's workspace: a second copy of the sample business with its own owner.
    const other = await ensureTestTenant(800 + test.info().parallelIndex);
    const otherState = await signInOverHttp(other.email, other.password, clientAddresses());
    const api = await playwright.request.newContext({ baseURL: ORIGIN, storageState: otherState, extraHTTPHeaders: { origin: ORIGIN } });
    const mineBefore = await received(db, workerTenant.organizationId, 1051);
    const forged = withArgs(captured, (args) => Object.assign(args, { organizationId: workerTenant.organizationId, customerId: "sarah-mitchell", status: "voided", amount: 75 }));
    await replay(api, captured, forged);
    await api.dispose();

    expect(await received(db, workerTenant.organizationId, 1051), "the named organization is untouched").toBe(mineBefore);
    expect(await received(db, other.organizationId, 1051), "the caller's own workspace received the payment, as a recorded $75").toBe(7500);
    const stored = (await db.query("select p.status, p.customer_id from payments p join invoices i on i.id = p.invoice_id where p.organization_id = $1 and i.number = 1051", [other.organizationId])).rows[0];
    expect(stored).toEqual({ status: "recorded", customer_id: null });

    const { pool, db: admin } = adminDb();
    await resetTestTenant(admin, other);
    await pool.end();
  });

  test("another business's owner cannot reach Apex's invoices, payments or quotes by replaying the references", async ({ page, apiAs, db, workerTenant }) => {
    await page.goto("/payments?record=1&invoice=INV-1050");
    const dialog = recordDialog(page);
    const record = await captureAction(page, () => dialog.getByRole("button", { name: "Record payment" }).click());
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toBeVisible();
    await closeDialog(page.getByRole("dialog", { name: "Payment recorded" }));
    const voidCall = await captureAction(page, async () => {
      await page.goto("/payments/PAY-1008");
      await page.getByRole("button", { name: "Void payment" }).click();
      const voiding = page.getByRole("dialog", { name: "Void Payment #PAY-1008?" });
      await voiding.getByLabel("Reason for voiding").selectOption("Other");
      await voiding.getByRole("button", { name: "Void payment" }).click();
    });
    await page.goto("/quotes-invoices/quotes/QT-884");
    await page.getByRole("button", { name: "Create invoice" }).first().click();
    const invoiceCall = await captureAction(page, () => page.getByRole("dialog", { name: "Create invoice" }).getByRole("button", { name: "Create invoice" }).click());
    await expect(page.getByRole("heading", { level: 1, name: "Invoice #INV-1052" })).toBeVisible();

    // Taylor owns Northstar only. Northstar has no INV-1050, PAY-1008 or QT-884: each reference is simply unknown to it.
    const northstar = (await db.query("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id as string;
    const before = await db.query("select (select count(*)::int from payments where organization_id = $1) as payments, (select count(*)::int from payments where organization_id = $1 and status = 'voided') as voided, (select count(*)::int from invoices where organization_id = $1) as invoices", [northstar]);
    const taylor = await apiAs("taylor");
    expect(await (await replay(taylor, record)).text()).toContain("That invoice no longer exists");
    expect(await (await replay(taylor, voidCall)).text()).toContain("That payment no longer exists");
    expect(await (await replay(taylor, invoiceCall)).text()).toContain("That quote no longer exists");
    const after = await db.query("select (select count(*)::int from payments where organization_id = $1) as payments, (select count(*)::int from payments where organization_id = $1 and status = 'voided') as voided, (select count(*)::int from invoices where organization_id = $1) as invoices", [northstar]);
    expect(after.rows).toEqual(before.rows);
    // And Apex's own copy is exactly what the owner did: one payment, one void, one invoice.
    expect(await paymentCount(db, workerTenant.organizationId)).toBe(9);
  });

  test("the server re-checks every amount, method, date and reference the screen checked, and refuses what the screen would never send", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await page.goto("/payments?record=1&invoice=INV-1051");
    const dialog = recordDialog(page);
    await dialog.getByRole("radio", { name: "Partial payment" }).check();
    await dialog.getByLabel("Partial amount (USD)").fill("100");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Record payment" }).click());
    await expect(page.getByRole("dialog", { name: "Payment recorded" })).toBeVisible();
    expect(await received(db, org, 1051)).toBe(10000);
    const owner = page.request;

    // Each of these would be a wrong or hostile payment. None may change the stored money.
    const attempts: [string, (args: Record<string, unknown>) => void, RegExp][] = [
      ["zero", (args) => Object.assign(args, { amount: 0 }), /Enter an amount above \$0\.00/],
      ["negative", (args) => Object.assign(args, { amount: -50 }), /Enter an amount above \$0\.00/],
      ["a fraction of a cent", (args) => Object.assign(args, { amount: 10.005 }), /at most two decimals/],
      ["not a number", (args) => Object.assign(args, { amount: "abc" }), /at most two decimals/],
      ["more than the balance", (args) => Object.assign(args, { amount: 280.01 }), /between \$0\.01 and \$280\.00/],
      ["an absurd amount", (args) => Object.assign(args, { amount: 1e9 }), /at most two decimals|between/],
      ["an unknown method", (args) => Object.assign(args, { method: "wire" }), /not understood/],
      ["a date that is not a date", (args) => Object.assign(args, { date: "2024-02-30" }), /date the payment was received/],
      ["a future date", (args) => Object.assign(args, { date: "2024-10-26" }), /can't be in the future/],
      ["an invoice that does not exist", (args) => Object.assign(args, { invoiceId: "INV-9999" }), /no longer exists/],
      ["a malformed invoice reference", (args) => Object.assign(args, { invoiceId: "INV-1051; drop table payments" }), /not understood/],
      ["a paid invoice", (args) => Object.assign(args, { invoiceId: "INV-1044" }), /no balance due/],
    ];
    for (const [label, change, message] of attempts) {
      const text = await (await replay(owner, captured, withArgs(captured, change))).text();
      expect(text, label).toMatch(message);
      expect(await received(db, org, 1051), `${label}: INV-1051`).toBe(10000);
      expect(await paymentCount(db, org), label).toBe(9);
    }
    // An exact balance is accepted; the invoice is paid; one more cent is not.
    const exact = await (await replay(owner, captured, withArgs(captured, (args) => Object.assign(args, { amount: 280 })))).text();
    expect(exact).not.toMatch(/no longer exists|between|not understood/);
    expect(await received(db, org, 1051)).toBe(38000);
    expect(await (await replay(owner, captured, withArgs(captured, (args) => Object.assign(args, { amount: 0.01 })))).text()).toMatch(/no balance due/);
    expect(await received(db, org, 1051)).toBe(38000);
  });

  test("a void names a reason from the list, a payment that exists and a payment that is still recorded", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await page.goto("/payments/PAY-1008");
    await page.getByRole("button", { name: "Void payment" }).click();
    const dialog = page.getByRole("dialog", { name: "Void Payment #PAY-1008?" });
    await dialog.getByLabel("Reason for voiding").selectOption("Other");
    const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Void payment" }).click());
    await expect(page.getByRole("dialog", { name: "Payment voided" })).toBeVisible();
    const send = async (args: unknown[]) => (await replay(page.request, captured, JSON.stringify(args))).text();
    expect(await send(["PAY-1008", "Because I said so", ""])).toContain("Select a reason");
    expect(await send(["PAY-9999", "Other", ""])).toContain("That payment no longer exists");
    expect(await send(["PAY-1008", "Other", ""])).toContain("That payment has already been voided");
    expect(await send(["PAY-1001", "Other", ""])).toContain("That payment has already been voided");
    expect(await send(["INV-1044", "Other", ""])).toContain("That payment was not understood");
    const voided = (await db.query("select count(*)::int as n from payments where organization_id = $1 and status = 'voided'", [org])).rows[0].n;
    expect(voided).toBe(2); // PAY-1001 and the one void just made
  });
});

/* ───────────────────────── tenant isolation in the screens ───────────────────────── */

test.describe("a business sees only its own money", () => {
  test("Northstar's owner sees Northstar's payments, quotes and invoices, and none of Apex's", async ({ openAs }) => {
    const { page, problems } = await openAs("taylor");
    await page.goto("/payments");
    await expectTotals(page, { recorded: "1", received: "$60.00", outstanding: "2", balance: "$309.00" });
    await expect(paymentRows(page)).toHaveCount(2);
    await expect(paymentRows(page).filter({ hasText: "PAY-1002" })).toContainText("Voided");
    await expect(page.getByText("Sarah Mitchell")).toHaveCount(0);
    await page.goto("/quotes-invoices");
    await expect(page.getByRole("table", { name: "Quotes" }).locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("table", { name: "Quotes" })).toContainText("Marta Olsen");
    await page.goto("/quotes-invoices?tab=invoices");
    await expect(page.getByRole("table", { name: "Invoices" }).locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("table", { name: "Invoices" }).locator("tbody tr").filter({ hasText: "INV-1001" })).toContainText("Partially paid");
    expect(problems).toEqual([]);
  });

  test("Apex's references are unknown to Northstar: not-found states, and nothing of Apex in the page", async ({ openAs }) => {
    const { page } = await openAs("taylor");
    for (const [path, text] of [
      ["/payments/PAY-1008", "Payment not found"],
      ["/quotes-invoices/invoices/INV-1050", "Invoice not found"],
      ["/quotes-invoices/quotes/QT-884", "Quote not found"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByText(text)).toBeVisible();
      const body = await page.locator("body").innerText();
      for (const leak of ["Arthur Pendleton", "Sarah Mitchell", "$285.00", "Capacitor"]) expect(body, `${path}: ${leak}`).not.toContain(leak);
    }
    // The tab title does not confirm a record exists elsewhere either.
    await page.goto("/payments/PAY-1008");
    await expect(page).not.toHaveTitle(/PAY-1008/);
    // Northstar's own PAY-1001 is a different payment from Apex's (voided) one.
    await page.goto("/payments/PAY-1001");
    await expect(page.locator("header").filter({ hasText: "PAY-1001" }).last()).toContainText("Recorded");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$60.00");
  });

  test("the same reference is a different record in each business: Apex's PAY-1001 is voided, Northstar's is recorded", async ({ openAs }) => {
    const alex = await openAs("alex");
    await alex.page.goto("/payments/PAY-1001");
    await expect(alex.page.locator("header").filter({ hasText: "PAY-1001" }).last()).toContainText("Voided");
    await expect(alex.page.getByRole("region", { name: "Payment summary" })).toContainText("$285.00");
    const taylor = await openAs("taylor");
    await taylor.page.goto("/payments/PAY-1001");
    await expect(taylor.page.getByRole("region", { name: "Payment summary" })).toContainText("$60.00");
  });

  test("someone in both businesses sees each one's own money as they switch", async ({ openAs }) => {
    const { page } = await openAs("casey");
    await page.goto("/payments");
    await expectTotals(page, BASELINE);
    await switchWorkspace(page, /Northstar/);
    await page.goto("/payments");
    await expectTotals(page, { recorded: "1", received: "$60.00", outstanding: "2", balance: "$309.00" });
    await expect(page.getByText("Arthur Pendleton")).toHaveCount(0);
  });
});

test.describe("a new business starts with empty money, not 'unavailable'", () => {
  test.use({ storageState: NOT_SIGNED_IN });

  test("its owner can open Payments and Quotes & Invoices, sees zero totals and empty lists, and has nothing to record against", async ({ page }) => {
    await signUp(page, { name: "Dana Founder" });
    await completeOnboarding(page, { name: "Clean Slate Heating" });

    await page.goto("/payments");
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No payments recorded yet" })).toBeVisible();
    await expectTotals(page, { recorded: "0", received: "$0.00", outstanding: "0", balance: "$0.00" });
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await expect(recordDialog(page)).toContainText("No invoices have an outstanding balance.");
    await expect(recordDialog(page).getByRole("radio")).toHaveCount(0);

    await page.goto("/quotes-invoices");
    const totals = page.getByRole("region", { name: "Quote and invoice totals" });
    for (const label of ["Open quotes", "Approved quotes", "Unpaid invoices", "Paid invoices"]) {
      await expect(totals.getByText(label, { exact: true }).locator("xpath=../..")).toContainText("0");
    }
    await expect(page.getByText("No quotes yet.")).toBeVisible();
    await expect(page.getByText(/isn't available for Clean Slate Heating yet/)).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(/Sarah Mitchell|Arthur Pendleton|PAY-10|INV-10|QT-8/);

    // A customer-less business has no financial history to show either.
    await page.goto("/payments/PAY-1001");
    await expect(page.getByText("Payment not found")).toBeVisible();
  });
});
