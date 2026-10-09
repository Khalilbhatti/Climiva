/**
 * Pure state transitions for the financial demo: record a payment, void a payment, create an invoice from
 * an approved quote. Nothing here mutates its input, so the fixtures in data/financials.ts stay untouched.
 *
 * Totals are never written anywhere: after each transition the invoice status, balances, outstanding list
 * and Payments / Overview totals are re-derived from the records by the selectors in data/financials.
 * Recording a payment never creates or edits an invoice, and creating an invoice never creates a payment.
 */
import { PROTOTYPE_NOW, PROTOTYPE_TODAY } from "@/data/fixtures";
import {
  getInvoiceBalance,
  getInvoiceById,
  getInvoicesForQuote,
  getQuoteById,
  roundMoney,
  type FinancialData,
  type Invoice,
  type Payment,
  type PaymentMethod,
  type PaymentTerms,
} from "@/data/financials";
import { nextId } from "./next-id";

/** Every demo change is made by the signed-in user. */
const ACTOR_ID = "alex-morgan";

export type NewPaymentInput = {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  /** "2024-10-25" */
  date: string;
  checkNumber?: string;
  note?: string;
};

/**
 * Records a payment against an invoice. The amount must be above zero and no more than the balance;
 * anything else is refused and the data comes back unchanged.
 */
export function recordPayment(data: FinancialData, input: NewPaymentInput): { data: FinancialData; payment?: Payment } {
  const invoice = getInvoiceById(input.invoiceId, data);
  const amount = roundMoney(input.amount);
  if (!invoice || !(amount > 0) || amount > getInvoiceBalance(invoice, data)) return { data };

  const payment: Payment = {
    id: nextId("PAY", data.payments.map((item) => item.id)),
    invoiceId: invoice.id,
    amount,
    method: input.method,
    date: input.date,
    checkNumber: input.method === "check" ? input.checkNumber?.trim() || undefined : undefined,
    note: input.note?.trim() || undefined,
    status: "recorded",
    recordedBy: ACTOR_ID,
  };
  return { data: { ...data, payments: [...data.payments, payment] }, payment };
}

/**
 * Voids a recorded payment. The record stays in history as Voided and stops counting toward the invoice and
 * every total; the invoice balance reopens by that amount. Related quote, job and booking are not touched.
 */
export function voidPayment(data: FinancialData, paymentId: string, reason: string, note?: string): FinancialData {
  return {
    ...data,
    payments: data.payments.map((payment) =>
      payment.id === paymentId && payment.status === "recorded"
        ? {
            ...payment,
            status: "voided",
            void: { reason, on: PROTOTYPE_TODAY, by: ACTOR_ID, note: note?.trim() || undefined },
          }
        : payment,
    ),
  };
}

export type NewInvoiceInput = { terms: PaymentTerms; message?: string };

/**
 * Creates an unpaid invoice from an approved quote that has no invoice yet. The quote is not modified: its
 * invoice is found through the invoice's `quoteId`.
 */
export function createInvoiceFromQuote(
  data: FinancialData,
  quoteId: string,
  input: NewInvoiceInput,
): { data: FinancialData; invoice?: Invoice } {
  const quote = getQuoteById(quoteId, data);
  if (!quote || quote.status !== "approved" || getInvoicesForQuote(quote.id, data).length > 0) return { data };

  const invoice: Invoice = {
    id: nextId("INV", data.invoices.map((item) => item.id)),
    customerId: quote.customerId,
    contactName: quote.contactName,
    propertyId: quote.propertyId,
    quoteId: quote.id,
    serviceId: quote.serviceId,
    jobId: quote.jobId,
    bookingId: quote.bookingId,
    date: PROTOTYPE_NOW.slice(0, 10),
    terms: input.terms,
    lineItems: quote.lineItems,
    message: input.message?.trim() || undefined,
  };
  return { data: { ...data, invoices: [...data.invoices, invoice] }, invoice };
}
