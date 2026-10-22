/**
 * Phase 19G: a business creates a Quote by hand, from Quotes & Invoices, and takes it on to an Invoice.
 *
 * What a person sees and does (the Create quote flow: Customer, Work, Price, Review; the draft that results; marking it sent and approved; creating its invoice),
 * and what the server decides whatever a screen offers (who may create, whose customers and jobs a quote may name, what a total is, how a number is taken):
 * the same requests the screen sends, replayed with other arguments, as other people, and many at once.
 *
 * Almost every test edits the worker's own copy of the Apex workspace, restored to the canonical record before each test (so the first quote is always QT-894).
 */
import type { APIRequestContext, Locator, Page } from "playwright/test";
import { adminDb } from "../scripts/db/lib";
import { ensureTestTenant, resetTestTenant } from "../scripts/db/seed-lib";
import { signInOverHttp } from "./fixtures";
import { joinBusiness, makeAccount, makePlatformAdmin } from "./platform-admin-helpers";
import { captureAction, replay, withFirstArgument, type Captured } from "./replay";
import { NOT_SIGNED_IN, ORIGIN, completeOnboarding, expect, expectAccessible, signUp, test, toast } from "./saas";

type Db = import("pg").Pool;

/* ───────────────────────── helpers ───────────────────────── */

const wizard = (page: Page) => page.getByRole("dialog", { name: "Create quote" });
const headerAction = (page: Page) => page.getByRole("main").getByRole("button", { name: "Create quote" });

async function openWizard(page: Page): Promise<Locator> {
  await page.goto("/quotes-invoices");
  await headerAction(page).click();
  await expect(wizard(page)).toBeVisible();
  return wizard(page);
}

type Row = { description: string; quantity?: string; price: string };

/** Fill the Price step: one row per line (the form starts with one). */
async function fillLines(dialog: Locator, rows: Row[]) {
  for (const [index, row] of rows.entries()) {
    if (index > 0) await dialog.getByRole("button", { name: "Add line item" }).click();
    await dialog.getByLabel(`Description, line ${index + 1}`).fill(row.description);
    if (row.quantity !== undefined) await dialog.getByLabel("Quantity").nth(index).fill(row.quantity);
    await dialog.getByLabel("Price each ($)").nth(index).fill(row.price);
  }
}

type Quote = { customer: RegExp; service?: string; job?: string; message?: string; validThrough?: string; lines: Row[] };

/** Walk the whole flow to the end and wait for the new quote's page. Resolves with the quote's reference. */
async function createQuote(page: Page, quote: Quote): Promise<string> {
  const dialog = await openWizard(page);
  await dialog.getByRole("radio", { name: quote.customer }).check();
  await dialog.getByRole("button", { name: /^Next: Work/ }).click();
  if (quote.service) await dialog.getByLabel("Service").selectOption({ label: quote.service });
  if (quote.job) await dialog.getByLabel("Related job").selectOption(quote.job);
  if (quote.message) await dialog.getByLabel("Note for the customer").fill(quote.message);
  await dialog.getByRole("button", { name: /^Next: Price/ }).click();
  await fillLines(dialog, quote.lines);
  if (quote.validThrough) await dialog.getByLabel("Price is good through").fill(quote.validThrough);
  await dialog.getByRole("button", { name: /^Next: Review/ }).click();
  await dialog.getByRole("button", { name: "Create quote" }).click();
  await expect(page).toHaveURL(/\/quotes-invoices\/quotes\/QT-\d+$/);
  return /QT-\d+/.exec(page.url())![0];
}

const THREE_LINES: Row[] = [
  { description: "Diagnostic visit", quantity: "1", price: "89.50" },
  { description: "Capacitor", quantity: "1.5", price: "33.33" },
  { description: "Refrigerant", quantity: "3", price: "12.10" },
];

async function storedQuote(db: Db, organizationId: string, number: number) {
  const quote = (
    await db.query(
      `select q.number, q.status, q.created_on::text as created_on, q.valid_through::text as valid_through, q.message, c.slug as customer, j.number as job, s.slug as service,
              q.sent_on::text as sent_on, q.approved_on::text as approved_on
         from quotes q left join customers c on c.id = q.customer_id left join jobs j on j.id = q.job_id left join services s on s.id = q.service_id
        where q.organization_id = $1 and q.number = $2`,
      [organizationId, number],
    )
  ).rows[0];
  const lines = (
    await db.query(
      `select l.sort_order, l.description, l.quantity::text as quantity, l.unit_price_cents, l.line_total_cents from quote_line_items l join quotes q on q.id = l.quote_id
        where q.organization_id = $1 and q.number = $2 order by l.sort_order`,
      [organizationId, number],
    )
  ).rows;
  return { quote, lines };
}

const count = async (db: Db, table: "quotes" | "invoices" | "payments", organizationId: string) =>
  (await db.query(`select count(*)::int as n from ${table} where organization_id = $1`, [organizationId])).rows[0].n as number;

/** Create one quote through the screen and capture the request it sent, for replaying. */
async function captureCreate(page: Page): Promise<Captured> {
  const dialog = await openWizard(page);
  await dialog.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
  await dialog.getByRole("button", { name: /^Next: Work/ }).click();
  await dialog.getByRole("button", { name: /^Next: Price/ }).click();
  await fillLines(dialog, [{ description: "Captured visit", price: "100" }]);
  await dialog.getByRole("button", { name: /^Next: Review/ }).click();
  const captured = await captureAction(page, () => dialog.getByRole("button", { name: "Create quote" }).click());
  await expect(page).toHaveURL(/\/quotes-invoices\/quotes\/QT-\d+$/);
  return captured;
}

/** What a person is never shown in an error. */
const INTERNAL = /sql|constraint|violat|relation "|syntax|stack|exception|organization_id|policy|row-level|undefined|\bnull\b/i;

/** The words of a refusal: the `error` a Server Action answered with, out of the response's framing. */
const errorOf = (response: string) => JSON.parse(`"${/"error":"((?:[^"\\]|\\.)*)"/.exec(response)?.[1] ?? ""}"`) as string;

/* ───────────────────────── the flow ───────────────────────── */

test.describe("Quotes & Invoices offers Create quote", () => {
  test("an owner has one Create quote button; it opens a flow that goes Customer, Work, Price, Review, with Cancel on the left", async ({ page }) => {
    await page.goto("/quotes-invoices");
    await expect(headerAction(page)).toHaveCount(1);

    await headerAction(page).click();
    const dialog = wizard(page);
    const steps = dialog.getByRole("list", { name: "Create quote steps" }).getByRole("listitem");
    await expect(steps).toHaveText([/Customer/, /Work/, /Price/, /Review/]);
    await expect(steps.first()).toHaveAttribute("aria-current", "step");
    await expect(dialog.getByRole("heading", { name: /^Who is this quote for\?/ })).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(5);
    const [cancel, next] = [await dialog.getByRole("button", { name: "Cancel" }).boundingBox(), await dialog.getByRole("button", { name: /^Next: Work/ }).boundingBox()];
    expect(cancel!.x).toBeLessThan(next!.x);

    // One step at a time, in plain words; Back returns without losing the choice.
    await dialog.getByRole("radio", { name: /^David Chen/ }).check();
    await dialog.getByRole("button", { name: /^Next: Work/ }).click();
    await expect(dialog.getByRole("heading", { name: /^What work are you quoting\?/ })).toBeVisible();
    await dialog.getByRole("button", { name: /^Next: Price/ }).click();
    await expect(dialog.getByRole("heading", { name: /^What will it cost\?/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(dialog.getByRole("radio", { name: /^David Chen/ })).toBeChecked();
    await expectAccessible(page);
  });

  test("the address ?new=1 opens it, and closing it leaves the plain address behind", async ({ page }) => {
    await page.goto("/quotes-invoices?new=1");
    await expect(wizard(page)).toBeVisible();
    await wizard(page).getByRole("button", { name: "Cancel" }).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/quotes-invoices$/);
  });

  test("a member is offered no way to create a quote", async ({ openAs }) => {
    const { page } = await openAs("jamie");
    await page.goto("/quotes-invoices");
    await expect(page.getByRole("heading", { level: 1, name: "Quotes & Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create quote" })).toHaveCount(0);
    await page.goto("/quotes-invoices?new=1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/quotes-invoices/quotes/QT-893");
    await expect(page.getByRole("button", { name: /^(Mark as sent|Customer approved|Customer declined|Mark expired)$/ })).toHaveCount(0);
  });
});

test.describe("creating a quote", () => {
  test("three lines, quantities with decimals and a half-cent line: the server stores whole cents, a draft, numbered QT-894, for that customer, job and Service", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const invoicesBefore = await count(db, "invoices", org);

    const reference = await createQuote(page, {
      customer: /^Sarah Mitchell/,
      service: "AC Repair & Diagnostics",
      job: "JB-204",
      message: "Thanks for your patience, Sarah.",
      validThrough: "2024-11-30",
      lines: THREE_LINES,
    });
    expect(reference).toBe("QT-894");

    // The page shows the draft: the lines as typed and the total as the server added it up (89.50 + 50.00 + 36.30).
    await expect(page.getByRole("heading", { level: 1, name: "Quote #QT-894" })).toBeVisible();
    await expect(toast(page)).toContainText("Quote #QT-894 was created as a draft for Sarah Mitchell.");
    await expect(page.locator("header").filter({ hasText: "QT-894" }).last()).toContainText("Draft");
    await expect(page.getByRole("link", { name: "Linked to Job #JB-204" })).toBeVisible();
    const lines = page.getByRole("table", { name: "Quote line items" }).locator("tbody tr");
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toContainText("Diagnostic visit");
    await expect(lines.nth(1)).toContainText("1.5");
    await expect(lines.nth(1)).toContainText("$33.33");
    await expect(lines.nth(1)).toContainText("$50.00");
    await expect(lines.nth(2)).toContainText("$36.30");
    await expect(page.getByRole("region", { name: "Line items" })).toContainText(/Total\s*\$175\.80/);
    await expect(page.getByText("“Thanks for your patience, Sarah.”")).toBeVisible();
    await expect(page.getByText("Quote valid through: Nov 30, 2024")).toBeVisible();

    // And it is stored that way: integer cents, half up, the day it was made, the business's own customer, job and Service.
    const { quote, lines: rows } = await storedQuote(db, org, 894);
    expect(quote).toEqual({
      number: 894,
      status: "draft",
      created_on: "2024-10-25",
      valid_through: "2024-11-30",
      message: "Thanks for your patience, Sarah.",
      customer: "sarah-mitchell",
      job: 204,
      service: "ac-repair-diagnostics",
      sent_on: null,
      approved_on: null,
    });
    expect(rows).toEqual([
      { sort_order: 1, description: "Diagnostic visit", quantity: "1.00", unit_price_cents: 8950, line_total_cents: 8950 },
      { sort_order: 2, description: "Capacitor", quantity: "1.50", unit_price_cents: 3333, line_total_cents: 5000 },
      { sort_order: 3, description: "Refrigerant", quantity: "3.00", unit_price_cents: 1210, line_total_cents: 3630 },
    ]);
    // The counter moved with the quote, and no invoice was made.
    expect((await db.query("select next_value from organization_sequences where organization_id = $1 and kind = 'quote'", [org])).rows[0].next_value).toBe(895);
    expect(await count(db, "invoices", org)).toBe(invoicesBefore);
    await expect(page.getByRole("region", { name: "Quote status" })).toContainText("No invoice created yet");
  });

  test("ten cents and twenty cents add up to thirty, not 0.30000000000000004", async ({ page, db, workerTenant }) => {
    await createQuote(page, { customer: /^David Chen/, lines: [{ description: "Gasket", price: "0.10" }, { description: "Seal", price: "0.20" }] });
    await expect(page.getByRole("region", { name: "Line items" })).toContainText(/Total\s*\$0\.30/);
    const { lines } = await storedQuote(db, workerTenant.organizationId, 894);
    expect(lines.map((line) => line.line_total_cents)).toEqual([10, 20]);
  });

  test("the new quote is in the list and the totals, and the baseline records beside it are as they were", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const before = (await db.query("select q.number, q.status, (select coalesce(sum(line_total_cents), 0)::int from quote_line_items l where l.quote_id = q.id) as total from quotes q where q.organization_id = $1 order by q.number", [org])).rows;
    expect(before.map((row) => row.number)).toEqual([879, 884, 891, 893]);

    await createQuote(page, { customer: /^Sarah Mitchell/, lines: THREE_LINES });
    await page.getByRole("link", { name: "Back to Quotes & Invoices" }).click();

    await expect(page.getByRole("tab", { name: /^Quotes\s*5$/ })).toBeVisible();
    const rows = page.getByRole("table", { name: "Quotes" }).locator("tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: "QT-894" })).toContainText("Sarah Mitchell");
    await expect(rows.filter({ hasText: "QT-894" })).toContainText("$175.80");
    await expect(rows.filter({ hasText: "QT-894" })).toContainText("Draft");
    await expect(page.getByRole("region", { name: "Quote and invoice totals" })).toContainText(/Open quotes\s*3/);

    // Nothing that was there moved: the same four quotes with the same status and total, QT-884 approved and not yet invoiced, INV-1044 paid, and the payments as approved.
    const after = (await db.query("select q.number, q.status, (select coalesce(sum(line_total_cents), 0)::int from quote_line_items l where l.quote_id = q.id) as total from quotes q where q.organization_id = $1 and q.number <> 894 order by q.number", [org])).rows;
    expect(after).toEqual(before);
    await page.goto("/quotes-invoices/quotes/QT-884");
    await expect(page.getByText("Quote approved by customer · Ready for invoicing")).toBeVisible();
    await expect(page.getByRole("region", { name: "Line items" })).toContainText(/Total\s*\$285\.00/);
    await page.goto("/quotes-invoices/invoices/INV-1044");
    await expect(page.locator("header").filter({ hasText: "INV-1044" }).last()).toContainText("Paid");
    await page.goto("/payments");
    const payments = page.getByRole("region", { name: "Payment totals" });
    await expect(payments).toContainText("$2,130.00");
    await expect(payments).toContainText("$680.00");
  });

  test("what is wrong is said beside the field, step by step, and nothing is stored until Create quote", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    const dialog = await openWizard(page);

    // No customer.
    await dialog.getByRole("button", { name: /^Next: Work/ }).click();
    await expect(dialog.getByRole("alert")).toContainText("Choose the customer this quote is for.");
    await dialog.getByRole("radio", { name: /^Sarah Mitchell/ }).check();
    await dialog.getByRole("button", { name: /^Next: Work/ }).click();
    await dialog.getByRole("button", { name: /^Next: Price/ }).click();

    // No lines at all.
    await dialog.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(dialog.getByRole("alert")).toContainText("Add at least one line item with a description and a price.");

    // A quantity that is not a quantity, a negative price, a price with a fraction of a cent, a missing description.
    await dialog.getByLabel("Quantity").fill("1.005");
    await dialog.getByLabel("Price each ($)").fill("-5");
    await dialog.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(dialog.getByText("Describe the work or the part.")).toBeVisible();
    await expect(dialog.getByText("Enter a number above zero, such as 1 or 1.5.")).toBeVisible();
    await expect(dialog.getByText("Enter a price, such as 89 or 89.50.")).toBeVisible();
    await dialog.getByLabel("Price each ($)").fill("10.005");
    await expect(dialog.getByText("Enter a price, such as 89 or 89.50.")).toBeVisible();

    // A line too large for one quote, and a day that has passed.
    await dialog.getByLabel("Description, line 1").fill("Everything");
    await dialog.getByLabel("Quantity").fill("99999.99");
    await dialog.getByLabel("Price each ($)").fill("99999999");
    await dialog.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(dialog.getByText("That comes to more than one line can hold.")).toBeVisible();
    await dialog.getByLabel("Quantity").fill("1");
    await dialog.getByLabel("Price each ($)").fill("100");
    await dialog.getByLabel("Price is good through").fill("2024-10-01");
    await dialog.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(dialog.getByText("Choose today or a later day.")).toBeVisible();
    await dialog.getByLabel("Price is good through").fill("2024-10-25");
    await dialog.getByRole("button", { name: /^Next: Review/ }).click();
    await expect(dialog.getByRole("heading", { name: /^Review quote/ })).toBeVisible();
    await expect(dialog.getByRole("table", { name: "Quote line items to create" })).toContainText("Everything");
    await expect(dialog.getByText(/Total\s*\$100\.00/)).toBeVisible();

    expect(await count(db, "quotes", org)).toBe(4);
  });

  test("closing with something entered asks first; with nothing entered it closes at once", async ({ page }) => {
    const dialog = await openWizard(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(wizard(page)).toHaveCount(0);

    const again = await openWizard(page);
    await again.getByRole("radio", { name: /^Elena Rodriguez/ }).check();
    await again.getByRole("button", { name: "Cancel" }).click();
    const ask = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Keep editing" }).click();
    await expect(again.getByRole("radio", { name: /^Elena Rodriguez/ })).toBeChecked();
    await again.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(wizard(page)).toHaveCount(0);
  });
});

test.describe("from the new quote to its invoice", () => {
  test("a draft cannot be invoiced; marked sent and then approved it can, and the invoice is unpaid and carries the lines at the same total", async ({ page, db, workerTenant }) => {
    const org = workerTenant.organizationId;
    await createQuote(page, { customer: /^Sarah Mitchell/, job: "JB-204", lines: THREE_LINES });
    const status = page.getByRole("region", { name: "Quote status" });

    // Draft: nothing to invoice yet.
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
    await expect(status.getByRole("button")).toHaveText(["Mark as sent"]);
    await status.getByRole("button", { name: "Mark as sent" }).click();
    await expect(toast(page)).toContainText("Quote #QT-894 is marked sent.");
    await expect(page.locator("header").filter({ hasText: "QT-894" }).last()).toContainText("Sent");
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);

    // Sent: the customer's answer is asked for, in words, and an answer that cannot be taken back asks first.
    await expect(status.getByRole("button")).toHaveText(["Customer approved", "Customer declined", "Mark expired"]);
    await status.getByRole("button", { name: "Customer approved" }).click();
    const ask = page.getByRole("dialog", { name: "Mark Quote #QT-894 as approved?" });
    await expect(ask).toContainText("It can't be undone");
    await expect(ask).toContainText("Approving does not create an invoice by itself.");
    await ask.getByRole("button", { name: "Cancel" }).click();
    expect((await storedQuote(db, org, 894)).quote.status).toBe("sent");
    await status.getByRole("button", { name: "Customer approved" }).click();
    await page.getByRole("dialog", { name: "Mark Quote #QT-894 as approved?" }).getByRole("button", { name: "Mark as approved" }).click();
    await expect(toast(page)).toContainText("Quote #QT-894 is approved. You can create its invoice now.");
    expect((await storedQuote(db, org, 894)).quote).toMatchObject({ status: "approved", sent_on: "2024-10-25", approved_on: "2024-10-25" });
    await expect(status.getByRole("button", { name: /^(Mark as sent|Customer approved|Customer declined|Mark expired)$/ })).toHaveCount(0);

    // Approved: still no invoice until one is created.
    expect(await count(db, "invoices", org)).toBe(9);
    await page.getByRole("button", { name: "Create invoice" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Create invoice" });
    await expect(dialog).toContainText("From approved Quote #QT-894");
    await expect(dialog.getByRole("table", { name: "Invoice items" }).locator("tbody tr")).toHaveCount(3);
    await dialog.getByRole("button", { name: "Create invoice" }).click();

    await expect(page).toHaveURL("/quotes-invoices/invoices/INV-1052");
    await expect(page.locator("header").filter({ hasText: "INV-1052" }).last()).toContainText("Unpaid");
    await expect(page.getByRole("link", { name: "From Quote #QT-894" })).toHaveAttribute("href", "/quotes-invoices/quotes/QT-894");
    await expect(page.getByRole("region", { name: "Payment summary" })).toContainText("$175.80");
    await expect(page.getByText("No payments recorded yet.")).toBeVisible();

    const invoice = (
      await db.query(
        `select i.number, q.number as quote, (select count(*)::int from invoice_line_items l where l.invoice_id = i.id) as lines,
                (select sum(l.line_total_cents)::int from invoice_line_items l where l.invoice_id = i.id) as total, (select count(*)::int from payments p where p.invoice_id = i.id) as payments
           from invoices i join quotes q on q.id = i.quote_id where i.organization_id = $1 and q.number = 894`,
        [org],
      )
    ).rows[0];
    expect(invoice).toEqual({ number: 1052, quote: 894, lines: 3, total: 17580, payments: 0 });
    // The quote now points at its invoice and cannot be invoiced twice; the money is as it was.
    await page.getByRole("link", { name: "From Quote #QT-894" }).click();
    await expect(page.getByRole("region", { name: "Quote status" })).toContainText("#INV-1052");
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
    expect(await count(db, "payments", org)).toBe(8);
  });

  test("a declined quote is final and cannot be invoiced", async ({ page, db, workerTenant }) => {
    await createQuote(page, { customer: /^David Chen/, lines: [{ description: "Tune-up", price: "129" }] });
    const status = page.getByRole("region", { name: "Quote status" });
    await status.getByRole("button", { name: "Mark as sent" }).click();
    await expect(toast(page)).toContainText("is marked sent");
    await status.getByRole("button", { name: "Customer declined" }).click();
    await page.getByRole("dialog", { name: "Mark Quote #QT-894 as declined?" }).getByRole("button", { name: "Mark as declined" }).click();
    await expect(page.locator("header").filter({ hasText: "QT-894" }).last()).toContainText("Declined");
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
    expect((await storedQuote(db, workerTenant.organizationId, 894)).quote.status).toBe("declined");
  });
});

test.describe("a business with no customers or quotes yet", () => {
  test.use({ storageState: NOT_SIGNED_IN });
  test.describe.configure({ timeout: 150_000 });

  test("is told what Quotes & Invoices is for, is sent to add a customer before it can quote one, and then creates its first quote", async ({ page }) => {
    await signUp(page, { name: "Pat Newcomer" });
    await completeOnboarding(page, { name: "First Quote Heating" });
    await page.goto("/quotes-invoices");
    await expect(page.getByRole("heading", { name: "No quotes yet" })).toBeVisible();
    await expect(page.getByText("Create a quote for a customer when you need to price work before invoicing.")).toBeVisible();
    // One Create quote on the page, in the empty state (the header has none while the page is empty).
    await expect(page.getByRole("button", { name: "Create quote" })).toHaveCount(1);

    await page.getByRole("button", { name: "Create quote" }).click();
    const dialog = wizard(page);
    await expect(dialog.getByText("Add a customer first")).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Next: Work/ })).toBeDisabled();
    await dialog.getByRole("link", { name: "Add a customer" }).click();
    await expect(page).toHaveURL(/\/customers\?new=1$/);

    const add = page.getByRole("dialog", { name: "Add customer" });
    await add.getByLabel(/^Full name/).fill("Dana Lee");
    await add.getByLabel(/^Email address/).fill("dana.lee@example.test");
    await add.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dana Lee" })).toBeVisible();

    const reference = await createQuote(page, { customer: /^Dana Lee/, lines: [{ description: "Furnace tune-up", price: "149" }] });
    // A new business's numbers start at 1001, like every other kind of document.
    expect(reference).toBe("QT-1001");
    await expect(page.getByText("Dana Lee has no jobs yet")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Line items" })).toContainText(/Total\s*\$149\.00/);
    await page.getByRole("link", { name: "Back to Quotes & Invoices" }).click();
    await expect(page.getByRole("table", { name: "Quotes" }).locator("tbody tr")).toHaveCount(1);
    await expectAccessible(page);
  });
});

/* ───────────────────────── the server decides ───────────────────────── */

test.describe("the server decides who may create a quote, for whom, and at what price", () => {
  test.describe.configure({ timeout: 120_000 });

  test("an owner's request, replayed with no session, as a member, as a platform administrator who is not in the business, or as another business's owner, stores nothing", async ({
    page,
    apiAs,
    db,
    workerTenant,
    clientAddresses,
    playwright,
  }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    const apex = (await db.query("select id from organizations where slug = 'apex-climate-heating-air'")).rows[0].id as string;
    const mine = await count(db, "quotes", org);
    const apexBefore = await count(db, "quotes", apex);

    // Nobody.
    const anonymous = await apiAs(null);
    const refused = await replay(anonymous, captured, captured.body, { maxRedirects: 0 });
    expect([307, 401, 403]).toContain(refused.status());

    // A member of Apex (read-only): told plainly, nothing written.
    const jamie = await apiAs("jamie");
    expect(await (await replay(jamie, captured)).text()).toContain("Only an owner or admin can change quotes, invoices and payments");

    // Someone with platform authority and no seat in this business is not its financial editor.
    const { pool, db: admin } = adminDb();
    const platform = await makePlatformAdmin("quoter", admin, pool);
    const platformApi = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(platform.email, platform.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });
    const platformText = await (await replay(platformApi, captured, captured.body, { maxRedirects: 0 })).text();
    expect(platformText).not.toContain("QT-");
    await platformApi.dispose();
    await pool.end();

    expect(await count(db, "quotes", org)).toBe(mine);
    expect(await count(db, "quotes", apex)).toBe(apexBefore);
  });

  test("an admin of the business may create one, in that business and no other", async ({ page, db, workerTenant, clientAddresses, playwright }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    const before = await count(db, "quotes", org);

    const { pool, db: admin } = adminDb();
    const account = await makeAccount("quote-admin", admin);
    await joinBusiness(admin, org, account.userId, "admin");
    await pool.end();
    const api = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(account.email, account.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });
    const answer = await (await replay(api, captured, withFirstArgument(captured, (args) => Object.assign(args, { message: "From the admin." })))).text();
    await api.dispose();
    expect(answer).toContain("QT-");
    expect(await count(db, "quotes", org)).toBe(before + 1);
    expect((await db.query("select message from quotes where organization_id = $1 and message = 'From the admin.'", [org])).rowCount).toBe(1);
  });

  test("naming another organization, or another business's customer, changes nothing there: a quote is written to the caller's workspace and its own customers", async ({
    page,
    apiAs,
    db,
    workerTenant,
    clientAddresses,
    playwright,
  }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    const northstar = (await db.query("select id from organizations where slug = 'northstar-heating-cooling'")).rows[0].id as string;
    const northstarBefore = await count(db, "quotes", northstar);
    const mine = await count(db, "quotes", org);

    // The owner, pointing the quote at a customer that exists only in Northstar: refused, in words.
    const owner = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });
    const foreign = await (await replay(owner, captured, withFirstArgument(captured, (args) => Object.assign(args, { customerId: "marta-olsen" })))).text();
    expect(foreign).toContain("That customer is not in your customers any more.");
    expect(errorOf(foreign)).not.toMatch(INTERNAL);
    await owner.dispose();

    // Northstar's owner, pointing the quote at Apex's customer, and naming Apex's organization besides: refused; nothing is written to Apex.
    const taylor = await apiAs("taylor");
    const forged = withFirstArgument(captured, (args) => Object.assign(args, { organizationId: org, customerId: "sarah-mitchell" }));
    const answer = await (await replay(taylor, captured, forged)).text();
    expect(answer).toContain("That customer is not in your customers any more.");
    expect(await count(db, "quotes", org)).toBe(mine);
    expect(await count(db, "quotes", northstar)).toBe(northstarBefore);

    // The same forged fields from someone whose business does have that customer: stored in THEIR business, none in the named one.
    const other = await ensureTestTenant(800 + test.info().parallelIndex);
    const otherApi = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(other.email, other.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });
    const otherBefore = await count(db, "quotes", other.organizationId);
    await replay(otherApi, captured, withFirstArgument(captured, (args) => Object.assign(args, { organizationId: org, status: "approved", createdOn: "2001-01-01" })));
    await otherApi.dispose();
    expect(await count(db, "quotes", other.organizationId)).toBe(otherBefore + 1);
    expect(await count(db, "quotes", org)).toBe(mine);
    const forgedStored = (await db.query("select status, created_on::text as created_on from quotes where organization_id = $1 order by number desc limit 1", [other.organizationId])).rows[0];
    expect(forgedStored).toEqual({ status: "draft", created_on: "2024-10-25" });
    const { pool, db: admin } = adminDb();
    await resetTestTenant(admin, other);
    await pool.end();
  });

  test("a job that is not there, or belongs to another customer, is refused", async ({ page, db, workerTenant, clientAddresses, playwright }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    const mine = await count(db, "quotes", org);
    const owner = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });

    // JB-201 is David Chen's job; the quote is for Sarah Mitchell.
    expect(await (await replay(owner, captured, withFirstArgument(captured, (args) => Object.assign(args, { jobId: "JB-201" })))).text()).toContain("That job or booking belongs to another customer.");
    expect(await (await replay(owner, captured, withFirstArgument(captured, (args) => Object.assign(args, { jobId: "JB-99999" })))).text()).toContain("That job no longer exists.");
    // JB-1001 exists, but only in Northstar: from this business it is as if it were not there, and nothing says that it is.
    const northstars = await (await replay(owner, captured, withFirstArgument(captured, (args) => Object.assign(args, { jobId: "JB-1001" })))).text();
    expect(northstars).toContain("That job no longer exists.");
    expect(errorOf(northstars)).not.toMatch(INTERNAL);
    expect(await (await replay(owner, captured, withFirstArgument(captured, (args) => Object.assign(args, { jobId: "invoice-5" })))).text()).toContain("The quote details were not understood.");
    expect(await count(db, "quotes", org)).toBe(mine);
    // Its own customer's job is accepted.
    await replay(owner, captured, withFirstArgument(captured, (args) => Object.assign(args, { jobId: "JB-204" })));
    expect(await count(db, "quotes", org)).toBe(mine + 1);
    await owner.dispose();
  });

  test("what is refused is refused in plain words, and leaves nothing behind: no customer, no lines, a bad quantity or price, a total that does not match, too much", async ({
    page,
    db,
    workerTenant,
    clientAddresses,
    playwright,
  }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    const mine = await count(db, "quotes", org);
    const owner = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });
    const line = (over: Record<string, unknown> = {}) => ({ description: "Visit", quantity: 1, rate: 100, ...over });
    const ask = async (change: (args: Record<string, unknown>) => void) => (await replay(owner, captured, withFirstArgument(captured, change))).text();

    const refusals: [string, (args: Record<string, unknown>) => void, string][] = [
      ["no customer", (args) => delete args.customerId, "Choose a customer, or enter the name of the person the quote is for."],
      // The rules read a quote for a named contact, but this action makes quotes for customers: a name alone is not a customer.
      ["a name instead of a customer", (args) => {
          delete args.customerId;
          args.contactName = "Pat Newcomer";
        }, "Choose the customer this quote is for."],
      ["no lines", (args) => Object.assign(args, { lines: [], expectedTotal: 0 }), "A quote needs between 1 and 50 line items."],
      ["fifty-one lines", (args) => Object.assign(args, { lines: Array.from({ length: 51 }, () => line()), expectedTotal: 5100 }), "A quote needs between 1 and 50 line items."],
      ["a line with no description", (args) => Object.assign(args, { lines: [line({ description: " " })] }), "Line 1: describe the work"],
      ["a zero quantity", (args) => Object.assign(args, { lines: [line({ quantity: 0 })] }), "Line 1: enter a quantity above zero"],
      ["a negative quantity", (args) => Object.assign(args, { lines: [line({ quantity: -2 })] }), "Line 1: enter a quantity above zero"],
      ["a quantity with a third decimal", (args) => Object.assign(args, { lines: [line({ quantity: 1.005 })] }), "Line 1: enter a quantity above zero"],
      ["a quantity sent as text", (args) => Object.assign(args, { lines: [line({ quantity: "1" })] }), "Line 1: enter a quantity above zero"],
      ["a negative price", (args) => Object.assign(args, { lines: [line({ rate: -1 })] }), "Line 1: enter a price of $0.00 or more"],
      ["a price with a fraction of a cent", (args) => Object.assign(args, { lines: [line({ rate: 12.345 })] }), "Line 1: enter a price of $0.00 or more"],
      ["a price that is not money", (args) => Object.assign(args, { lines: [line({ rate: "abc" }), line()] }), "Line 1: enter a price of $0.00 or more"],
      ["a second line that is wrong", (args) => Object.assign(args, { lines: [line(), line({ rate: "1e3" })] }), "Line 2: enter a price of $0.00 or more"],
      ["a line larger than a line can hold", (args) => Object.assign(args, { lines: [line({ quantity: 99999.99, rate: 99999999 })], expectedTotal: 0 }), "more than one line can hold"],
      ["a total larger than a quote can hold", (args) => Object.assign(args, { lines: Array.from({ length: 3 }, () => line({ quantity: 1, rate: 9_000_000 })), expectedTotal: 27_000_000 }), "more than a quote can hold"],
      ["a total that is not the lines'", (args) => Object.assign(args, { expectedTotal: 1 }), "The total on screen does not match the line items."],
      ["a total that is not money", (args) => Object.assign(args, { expectedTotal: "lots" }), "The total was not understood."],
      ["a day that has passed", (args) => Object.assign(args, { validThrough: "2024-10-24" }), "The quote can't be good through a day that has already passed."],
      ["a day that is not a date", (args) => Object.assign(args, { validThrough: "2024-02-30" }), "Enter a valid date the quote is good through."],
      ["a note that is too long", (args) => Object.assign(args, { message: "x".repeat(2001) }), "Keep the message under 2,000 characters."],
      ["a service that is not in the catalog", (args) => Object.assign(args, { serviceId: "no-such-service" }), "That service is not in your catalog any more."],
    ];
    for (const [name, change, message] of refusals) {
      const text = await ask(change);
      expect(text, name).toContain(message);
      expect(errorOf(text), `${name} leaks`).not.toMatch(INTERNAL);
    }
    expect(await count(db, "quotes", org)).toBe(mine);
    await owner.dispose();
  });

  test("a total sent with the request is never what is stored: the server adds the lines up, and ignores a subtotal, a line total or a status that comes with them", async ({ page, db, workerTenant, clientAddresses, playwright }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    const owner = await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } });
    await replay(
      owner,
      captured,
      withFirstArgument(captured, (args) =>
        Object.assign(args, {
          total: 1,
          subtotal: 1,
          totalCents: 1,
          status: "approved",
          number: 5,
          expectedTotal: 150.5,
          lines: [
            { description: "Forged", quantity: 2, rate: 50.25, lineTotal: 1, lineTotalCents: 1, total: 1, unitPriceCents: 1 },
            { description: "Honest", quantity: 1, rate: 50, amount: 1 },
          ],
        }),
      ),
    );
    await owner.dispose();
    const stored = (await db.query("select number, status from quotes where organization_id = $1 order by number desc limit 1", [org])).rows[0];
    expect(stored.status).toBe("draft");
    expect(stored.number).toBeGreaterThanOrEqual(894);
    const { lines } = await storedQuote(db, org, stored.number);
    expect(lines.map((line) => [line.unit_price_cents, line.line_total_cents])).toEqual([[5025, 10050], [5000, 5000]]);
  });

  test("twelve quotes created at the same moment get twelve different numbers, with nothing missing and every line stored", async ({ page, db, workerTenant, clientAddresses, playwright }) => {
    const captured = await captureCreate(page);
    const org = workerTenant.organizationId;
    expect((await db.query("select next_value from organization_sequences where organization_id = $1 and kind = 'quote'", [org])).rows[0].next_value).toBe(895);
    const owners: APIRequestContext[] = [];
    for (let index = 0; index < 12; index += 1) {
      owners.push(await playwright.request.newContext({ baseURL: ORIGIN, storageState: await signInOverHttp(workerTenant.email, workerTenant.password, clientAddresses()), extraHTTPHeaders: { origin: ORIGIN } }));
    }
    const answers = await Promise.all(
      owners.map((api, index) =>
        replay(
          api,
          captured,
          withFirstArgument(captured, (args) => Object.assign(args, { lines: [{ description: `Race ${index}`, quantity: 1, rate: 10 + index }, { description: "Second line", quantity: 2, rate: 5 }], expectedTotal: 20 + index })),
        ).then((response) => response.text()),
      ),
    );
    await Promise.all(owners.map((api) => api.dispose()));
    for (const answer of answers) expect(answer).toContain("QT-");

    const made = (await db.query("select number, (select count(*)::int from quote_line_items l where l.quote_id = q.id) as lines from quotes q where organization_id = $1 and number >= 895 order by number", [org])).rows;
    expect(made.map((row) => row.number)).toEqual(Array.from({ length: 12 }, (_, index) => 895 + index));
    expect(made.every((row) => row.lines === 2)).toBe(true);
    expect((await db.query("select next_value from organization_sequences where organization_id = $1 and kind = 'quote'", [org])).rows[0].next_value).toBe(907);
    const totals = (await db.query("select sum(l.line_total_cents)::int as total from quotes q join quote_line_items l on l.quote_id = q.id where q.organization_id = $1 and q.number >= 895", [org])).rows[0].total;
    // 12 x (2 x $5.00) + $10.00 .. $21.00
    expect(totals).toBe(12 * 1000 + (10 + 21) * 6 * 100);
  });
});
