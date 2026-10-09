"use server";

import { PROTOTYPE_NOW } from "@/data/fixtures";
import type { FinancialData, Invoice, Payment, Quote } from "@/data/financials";
import { createInvoiceFromQuoteTx, createQuoteTx, loadFinancials, loadFinRefs, recordPaymentTx, updateQuoteStatusTx, voidPaymentTx, type FinContext } from "@/db/fin-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_FINANCIALS, NOT_FOUND, failure, ok, type ActionResult } from "@/lib/action-result";
import { stampInstant } from "@/lib/business-time";
import {
  financialNumber,
  parseInvoiceFromQuote,
  parseNewPayment,
  parseNewQuote,
  parseQuoteStatus,
  parseVoidPayment,
} from "@/lib/financial-rules";
import { Refusal, refuse } from "@/lib/refusal";
import type { Parsed } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Financial writes: payments, voids, invoices and quotes. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "financials:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement), so someone who is not signed in learns nothing about what a valid request looks like,
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, resolves every id it names inside
 *      the verified organization, locks what it spends (an invoice's balance), and checks the change is one the record may make,
 *   5. writes, reads the business's financials back and answers with them, so the screen shows exactly what is stored.
 * No argument names an organization. A refusal at any point rolls the whole change back, so nothing is half done, and a number
 * taken for a document is given back. PostgreSQL holds the money rules again (an overpayment, a second invoice for a quote, a
 * payment's identity), so they hold even if this code were bypassed.
 */

type Answer = { financials: FinancialData };

/** The value of a parsed argument, or a refusal that says what was wrong with it. */
function valid<T>(parsed: Parsed<T>): T {
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "payments_overpayment") return failure("That payment is more than the invoice's balance. Reload the page to see the balance.");
  if (constraint === "invoices_org_quote_unique") return failure("That quote already has an invoice.");
  if (constraint === "payments_final") return failure("That payment has already been voided.");
  if (constraint === "quotes_final" || constraint === "quotes_status_transition") return failure("That quote can't make that change now. Reload the page and try again.");
  if (uniqueViolationOf(error)) return failure("Someone changed this at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[financials] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

/** Authorize, open the tenant transaction, run the change, and answer with the financials as stored. */
async function mutate<T extends object = object>(change: (ctx: FinContext) => Promise<T>): Promise<ActionResult<Answer & T>> {
  const auth = await authorize("financials:manage", NOT_ALLOWED_FINANCIALS);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const refs = await loadFinRefs(tx, organizationId);
      const extra = await change({
        tx,
        organizationId,
        timeZone: organization.timezone,
        refs,
        today: snapshot.clock.today,
        stamp: stampInstant(snapshot.hasSampleData, organization.timezone, PROTOTYPE_NOW),
        actorUserId: userId,
      });
      return ok({ financials: await loadFinancials(tx, organizationId, organization.timezone, refs), ...extra });
    });
  } catch (error) {
    return translate(error);
  }
}

/* ───────────────────────── payments ───────────────────────── */

/** Record money received against an invoice. The amount must be above zero and no more than the balance due. */
export async function recordPaymentAction(input: unknown): Promise<ActionResult<Answer & { payment: Payment }>> {
  return mutate(async (ctx) => {
    const payment = valid(parseNewPayment(input));
    const reference = await recordPaymentTx(ctx, payment);
    return { reference };
  }).then((result) => {
    if (!result.ok) return result;
    const { reference, ...rest } = result.data;
    const stored = result.data.financials.payments.find((candidate) => candidate.id === reference);
    return stored ? ok({ ...rest, payment: stored }) : failure(NOT_FOUND);
  });
}

/** Void a recorded payment: it stays in history, stops counting, and reopens the invoice's balance. */
export async function voidPaymentAction(paymentReference: unknown, reason: unknown, note?: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    await voidPaymentTx(ctx, valid(parseVoidPayment(paymentReference, reason, note)));
    return {};
  });
}

/* ───────────────────────── invoices ───────────────────────── */

/** Create an unpaid invoice from an approved quote that has none. It records no payment and does not change the quote. */
export async function createInvoiceFromQuoteAction(quoteReference: unknown, input: unknown): Promise<ActionResult<Answer & { invoice: Invoice }>> {
  return mutate(async (ctx) => {
    const reference = await createInvoiceFromQuoteTx(ctx, valid(parseInvoiceFromQuote(quoteReference, input)));
    return { reference };
  }).then((result) => {
    if (!result.ok) return result;
    const { reference, ...rest } = result.data;
    const stored = result.data.financials.invoices.find((candidate) => candidate.id === reference);
    return stored ? ok({ ...rest, invoice: stored }) : failure(NOT_FOUND);
  });
}

/* ───────────────────────── quotes ───────────────────────── */

/** Create a draft quote with its line items. No screen offers it yet; the rules and the numbering are in place for when one does. */
export async function createQuoteAction(input: unknown): Promise<ActionResult<Answer & { quote: Quote }>> {
  return mutate(async (ctx) => {
    const reference = await createQuoteTx(ctx, valid(parseNewQuote(input)));
    return { reference };
  }).then((result) => {
    if (!result.ok) return result;
    const { reference, ...rest } = result.data;
    const stored = result.data.financials.quotes.find((candidate) => candidate.id === reference);
    return stored ? ok({ ...rest, quote: stored }) : failure(NOT_FOUND);
  });
}

/** Move a quote forward (draft → sent → approved, declined or expired). Approving does not create an invoice. */
export async function updateQuoteStatusAction(quoteReference: unknown, status: unknown): Promise<ActionResult<Answer>> {
  return mutate(async (ctx) => {
    const number = financialNumber("QT", quoteReference) ?? refuse(NOT_FOUND);
    const to = parseQuoteStatus(status) ?? refuse("That status was not understood.");
    await updateQuoteStatusTx(ctx, number, to);
    return {};
  });
}
