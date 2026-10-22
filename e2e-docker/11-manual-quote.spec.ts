/**
 * Docker side, part 11: a quote made by hand, and the invoice made from it, on the production-shaped stack.
 *
 * The first business (made in part 2) has a customer and no quote. Its owner signs in again, finds Quotes & Invoices empty and offering Create quote, makes a
 * quote for that customer through the real flow (Customer, Work, Price, Review), and takes it on: marked sent, approved, and invoiced. Everything is checked
 * where it lands, in the production database, written by the application's restricted role through Row Level Security and the business's own counters:
 * a draft numbered from 1001, lines stored as whole cents with a half-cent rounded up, a total that is the sum of them, no invoice until one is asked for, and
 * an invoice that carries the same lines at the same total and records no payment.
 */
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "playwright/test";
import { PASSWORD, waitsForHydration } from "../e2e/saas";
import { one, sql, stack } from "./stack";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let state: { email: string; business: string; slug: string };
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  state = JSON.parse(readFileSync(".data/docker-state.json", "utf8"));
  context = await browser.newContext({ baseURL: stack.origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  page = waitsForHydration(await context.newPage());
  // Sign-in is rate limited per client address (three in ten seconds) and the parts before this one signed people in: wait out the window.
  await new Promise((resolve) => setTimeout(resolve, 10_500));
});
test.afterAll(async () => {
  await context.close();
});

const quotes = () => Number(one(`select count(*) from quotes q join organizations o on o.id = q.organization_id where o.slug = '${state.slug}'`));

test("the owner signs in and finds Quotes & Invoices empty, offering one Create quote", async () => {
  await page.goto("/login");
  await page.getByLabel(/^Email/).fill(state.email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  expect(quotes()).toBe(0);

  await page.goto("/quotes-invoices");
  await expect(page.getByRole("heading", { name: "No quotes yet" })).toBeVisible();
  await expect(page.getByText("Create a quote for a customer when you need to price work before invoicing.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create quote" })).toHaveCount(1);
});

test("a quote is created through the flow: a draft numbered QT-1001, with its lines stored as whole cents and the total as their sum", async () => {
  await page.getByRole("button", { name: "Create quote" }).click();
  const dialog = page.getByRole("dialog", { name: "Create quote" });
  await dialog.getByRole("radio", { name: /^Pat Walker/ }).check();
  await dialog.getByRole("button", { name: /^Next: Work/ }).click();
  await dialog.getByLabel("Note for the customer").fill("Prices hold for thirty days.");
  await dialog.getByRole("button", { name: /^Next: Price/ }).click();
  await dialog.getByLabel("Description, line 1").fill("Furnace inspection");
  await dialog.getByLabel("Price each ($)").fill("129");
  await dialog.getByRole("button", { name: "Add line item" }).click();
  await dialog.getByLabel("Description, line 2").fill("Blower capacitor");
  await dialog.getByLabel("Quantity").nth(1).fill("1.5");
  await dialog.getByLabel("Price each ($)").nth(1).fill("33.33");
  await dialog.getByRole("button", { name: /^Next: Review/ }).click();
  await expect(dialog.getByText(/Total\s*\$179\.00/)).toBeVisible();
  await dialog.getByRole("button", { name: "Create quote" }).click();

  await expect(page).toHaveURL(/\/quotes-invoices\/quotes\/QT-1001$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quote #QT-1001" })).toBeVisible();
  await expect(page.locator("header").filter({ hasText: "QT-1001" }).last()).toContainText("Draft");
  await expect(page.getByRole("region", { name: "Line items" })).toContainText(/Total\s*\$179\.00/);

  expect(sql(`select q.number, q.status, c.slug, q.message from quotes q join customers c on c.id = q.customer_id join organizations o on o.id = q.organization_id where o.slug = '${state.slug}'`)).toEqual([
    ["1001", "draft", "pat-walker", "Prices hold for thirty days."],
  ]);
  // 1.5 x 3333 = 4999.5 cents, rounded up to $50.00, so the quote is $129.00 + $50.00: the sum is of the stored whole-cent line totals, never of dollars.
  expect(sql("select l.sort_order, l.description, l.quantity, l.unit_price_cents, l.line_total_cents from quote_line_items l join quotes q on q.id = l.quote_id where q.number = 1001 order by l.sort_order")).toEqual([
    ["1", "Furnace inspection", "1.00", "12900", "12900"],
    ["2", "Blower capacitor", "1.50", "3333", "5000"],
  ]);
  expect(one("select sum(l.line_total_cents) from quote_line_items l join quotes q on q.id = l.quote_id where q.number = 1001")).toBe("17900");
  expect(one("select next_value from organization_sequences s join organizations o on o.id = s.organization_id where o.slug = '" + state.slug + "' and s.kind = 'quote'")).toBe("1002");
  // Nothing was invoiced by making a quote.
  expect(Number(one("select count(*) from invoices"))).toBe(0);
});

test("marked sent and approved, it is invoiced: the invoice is unpaid, carries the same lines at the same total, and the payment table is untouched", async () => {
  const status = page.getByRole("region", { name: "Quote status" });
  await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
  await status.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.locator("header").filter({ hasText: "QT-1001" }).last()).toContainText("Sent");
  await status.getByRole("button", { name: "Customer approved" }).click();
  await page.getByRole("dialog", { name: "Mark Quote #QT-1001 as approved?" }).getByRole("button", { name: "Mark as approved" }).click();
  await expect(page.locator("header").filter({ hasText: "QT-1001" }).last()).toContainText("Approved");
  expect(Number(one("select count(*) from invoices"))).toBe(0);

  await page.getByRole("button", { name: "Create invoice" }).first().click();
  await page.getByRole("dialog", { name: "Create invoice" }).getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/quotes-invoices\/invoices\/INV-1001$/);
  await expect(page.getByRole("link", { name: "From Quote #QT-1001" })).toBeVisible();

  expect(sql("select i.number, q.number, (select count(*) from invoice_line_items l where l.invoice_id = i.id), (select sum(l.line_total_cents) from invoice_line_items l where l.invoice_id = i.id) from invoices i join quotes q on q.id = i.quote_id")).toEqual([
    ["1001", "1001", "2", "17900"],
  ]);
  expect(Number(one("select count(*) from payments"))).toBe(0);
  expect(one("select status from quotes where number = 1001")).toBe("approved");
});
