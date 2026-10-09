/**
 * Test-only data builders for the specs that check what the financial SELECTORS answer for a given set of records.
 *
 * They do not model the application: recording, voiding and invoicing happen on the server, in PostgreSQL, and are tested there
 * (financials-database.spec.ts, financials-flows.spec.ts). These only put a payment (or a void) into a plain FinancialData value
 * so a pure spec can ask the selectors what the totals would be.
 */
import type { FinancialData, Invoice, Payment, PaymentMethod, PaymentTerms } from "../src/data/financials";

const numberOf = (reference: string) => Number(reference.replace(/^\D+-/, ""));

/** `data` with one more recorded payment, numbered after the highest. */
export function withPayment(data: FinancialData, invoiceId: string, amount: number, details: { method?: PaymentMethod; date?: string } = {}): { data: FinancialData; payment: Payment } {
  const next = Math.max(0, ...data.payments.map((payment) => numberOf(payment.id))) + 1;
  const payment: Payment = { id: `PAY-${next}`, invoiceId, amount, method: details.method ?? "check", date: details.date ?? "2024-10-25", status: "recorded" };
  return { data: { ...data, payments: [...data.payments, payment] }, payment };
}

/** `data` with an unpaid invoice made from a quote's lines, numbered after the highest. Not imported: it is an invoice made since the baseline. */
export function withInvoiceFromQuote(data: FinancialData, quoteId: string, terms: PaymentTerms = "due-on-receipt"): { data: FinancialData; invoice: Invoice } {
  const quote = data.quotes.find((item) => item.id === quoteId);
  if (!quote) throw new Error(`No quote ${quoteId}`);
  const next = Math.max(0, ...data.invoices.map((invoice) => numberOf(invoice.id))) + 1;
  const invoice: Invoice = {
    id: `INV-${next}`,
    customerId: quote.customerId,
    contactName: quote.contactName,
    propertyId: quote.propertyId,
    serviceId: quote.serviceId,
    jobId: quote.jobId,
    bookingId: quote.bookingId,
    quoteId: quote.id,
    date: "2024-10-25",
    terms,
    lineItems: quote.lineItems,
  };
  return { data: { ...data, invoices: [...data.invoices, invoice] }, invoice };
}

/** `data` with one payment marked voided. */
export function withVoid(data: FinancialData, paymentId: string, reason = "Duplicate payment"): FinancialData {
  return {
    ...data,
    payments: data.payments.map((payment) => (payment.id === paymentId && payment.status === "recorded" ? { ...payment, status: "voided", void: { reason, on: "2024-10-25" } } : payment)),
  };
}
