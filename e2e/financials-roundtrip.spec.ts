/**
 * The seed and the application's database layer agree for the financials too: what the seed wrote is what the application reads
 * back, field for field (amounts, dates, links, statuses, void history), the sample records keep the same database identity every
 * time the database is rebuilt, and seeding again changes nothing: no duplicate document, no moved counter.
 *
 * These read through the restricted runtime role under the tenant context (the way a page does).
 */
import { test, expect } from "playwright/test";
import { Pool } from "pg";
import type { Invoice, Payment, Quote } from "../src/data/financials";
import { loadFinancials } from "../src/db/fin-queries";
import { stableId } from "../src/db/stable-id";
import { withTenant } from "../src/db/tenant";
import { seedDevelopmentData } from "../scripts/db/seed-lib";
import { NORTHSTAR_FINANCIALS } from "../scripts/db/seed-data/northstar";
import { FINANCIALS } from "./apex-data";

let admin: Pool;
const ids = { apex: "", northstar: "", alex: "", taylor: "" };

test.beforeAll(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  const one = async (sql: string) => (await admin.query<{ id: string }>(sql)).rows[0].id;
  ids.apex = await one("select id from organizations where slug = 'apex-climate-heating-air'");
  ids.northstar = await one("select id from organizations where slug = 'northstar-heating-cooling'");
  ids.alex = await one("select id from auth_user where email = 'alex.morgan@apex.test'");
  ids.taylor = await one("select id from auth_user where email = 'taylor.brooks@northstar.test'");
});

test.afterAll(async () => {
  await admin.end();
});

const number = (record: { id: string }) => Number(record.id.replace(/^\D+-/, ""));
const byNumber = (a: { id: string }, b: { id: string }) => number(a) - number(b);
const sorted = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort(byNumber);

test.describe("what was seeded is what is read", () => {
  test("Apex: quotes, invoices and payments come back exactly as seeded", async () => {
    const financials = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadFinancials(tx, ids.apex, "America/Chicago"));
    expect(sorted<Quote>(financials.quotes)).toEqual(sorted(FINANCIALS.quotes));
    expect(sorted<Invoice>(financials.invoices)).toEqual(sorted(FINANCIALS.invoices));
    expect(sorted<Payment>(financials.payments)).toEqual(sorted(FINANCIALS.payments));
  });

  test("Northstar: its own, smaller set comes back exactly as seeded", async () => {
    const financials = await withTenant({ userId: ids.taylor, organizationId: ids.northstar }, (tx) => loadFinancials(tx, ids.northstar, "America/Denver"));
    expect(sorted<Quote>(financials.quotes)).toEqual(sorted(NORTHSTAR_FINANCIALS.quotes));
    expect(sorted<Invoice>(financials.invoices)).toEqual(sorted(NORTHSTAR_FINANCIALS.invoices));
    expect(sorted<Payment>(financials.payments)).toEqual(sorted(NORTHSTAR_FINANCIALS.payments));
  });

  test("an organization sees none of another's financials through the same function", async () => {
    const crossed = await withTenant({ userId: ids.taylor, organizationId: ids.apex }, (tx) => loadFinancials(tx, ids.apex, "America/Chicago"));
    expect(crossed).toEqual({ quotes: [], invoices: [], payments: [] });
    const other = await withTenant({ userId: ids.alex, organizationId: ids.northstar }, (tx) => loadFinancials(tx, ids.northstar, "America/Denver"));
    expect(other).toEqual({ quotes: [], invoices: [], payments: [] });
  });

  test("the void is read in the business's own time zone: PAY-1001 was voided on Oct 25 in Austin", async () => {
    const financials = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadFinancials(tx, ids.apex, "America/Chicago"));
    const voided = financials.payments.find((payment) => payment.id === "PAY-1001")!;
    expect(voided.void).toEqual({ reason: "Payment entered by mistake", on: "2024-10-25", by: "alex-morgan", note: undefined });
    // The same stored instant, read in a zone far away, lands on another calendar day: the date is a function of the zone, not a stored string.
    const tokyo = await withTenant({ userId: ids.alex, organizationId: ids.apex }, (tx) => loadFinancials(tx, ids.apex, "Asia/Tokyo"));
    expect(tokyo.payments.find((payment) => payment.id === "PAY-1001")!.void!.on).toBe("2024-10-26");
    // A business date never moves.
    expect(tokyo.payments.find((payment) => payment.id === "PAY-1001")!.date).toBe("2024-10-25");
  });
});

test.describe("identity and repeatability", () => {
  test("the sample records have deterministic ids, so a rebuilt database gives the same ones", async () => {
    const quote = await admin.query<{ id: string }>("select id from quotes where organization_id = $1 and number = 884", [ids.apex]);
    expect(quote.rows[0].id).toBe(stableId(ids.apex, "quote", "QT-884"));
    const invoice = await admin.query<{ id: string }>("select id from invoices where organization_id = $1 and number = 1050", [ids.apex]);
    expect(invoice.rows[0].id).toBe(stableId(ids.apex, "invoice", "INV-1050"));
    const payment = await admin.query<{ id: string }>("select id from payments where organization_id = $1 and number = 1008", [ids.apex]);
    expect(payment.rows[0].id).toBe(stableId(ids.apex, "payment", "PAY-1008"));
    // The same reference in another business is a different record.
    expect(stableId(ids.northstar, "invoice", "INV-1001")).not.toBe(stableId(ids.apex, "invoice", "INV-1001"));
  });

  test("seeding again changes nothing: the same rows, the same counters", async () => {
    const snapshot = async () =>
      (
        await admin.query(
          `select (select count(*)::int from quotes) as quotes, (select count(*)::int from quote_line_items) as quote_lines,
                  (select count(*)::int from invoices) as invoices, (select count(*)::int from invoice_line_items) as invoice_lines,
                  (select count(*)::int from payments) as payments,
                  (select count(*)::int from payments where status = 'voided') as voided,
                  (select string_agg(organization_id::text || kind || next_value, ',' order by organization_id, kind) from organization_sequences where organization_id in ($1, $2) and kind in ('quote', 'invoice', 'payment')) as counters,
                  (select max(updated_at)::text from payments where organization_id in ($1, $2)) as payment_updated,
                  (select max(updated_at)::text from invoices where organization_id in ($1, $2)) as invoice_updated`,
          [ids.apex, ids.northstar],
        )
      ).rows[0];
    const before = await snapshot();
    await seedDevelopmentData();
    expect(await snapshot()).toEqual(before);
  });

  test("no business ever holds the same document number twice", async () => {
    for (const [table, label] of [["quotes", "QT"], ["invoices", "INV"], ["payments", "PAY"]] as const) {
      const duplicates = (await admin.query(`select organization_id, number, count(*)::int as n from ${table} group by organization_id, number having count(*) > 1`)).rows;
      expect(duplicates, `${label} numbers`).toEqual([]);
    }
  });
});
