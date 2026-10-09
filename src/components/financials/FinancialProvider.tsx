"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { FinancialData, Invoice, Payment, PaymentMethod, PaymentTerms } from "@/data/financials";
import type { ActionResult } from "@/lib/action-result";
import { send } from "@/lib/send-action";
import { createInvoiceFromQuoteAction, recordPaymentAction, voidPaymentAction } from "@/server/actions/financials";

/** What every change resolves with: the financials as stored, or why it was refused. */
type Done = Promise<ActionResult<{ financials: FinancialData }>>;

export type NewPaymentInput = {
  invoiceId: string;
  /** Dollars, with at most two decimals. */
  amount: number;
  method: PaymentMethod;
  /** "2024-10-25": the day the money was received. */
  date: string;
  checkNumber?: string;
  note?: string;
};

type FinancialContextValue = {
  /** The business's quotes, invoices and payments, as stored. Balances and statuses are derived from them by the selectors. */
  data: FinancialData;
  /** Records money received against an invoice. The server checks the amount against the balance. */
  recordPayment: (input: NewPaymentInput) => Promise<ActionResult<{ financials: FinancialData; payment: Payment }>>;
  /** Voids a recorded payment: it stays in history and stops counting. */
  voidPayment: (paymentId: string, reason: string, note?: string) => Done;
  /** Creates an unpaid invoice from an approved quote that has none. */
  createInvoiceFromQuote: (quoteId: string, input: { terms: PaymentTerms; message?: string }) => Promise<ActionResult<{ financials: FinancialData; invoice: Invoice }>>;
};

const FinancialContext = createContext<FinancialContextValue | null>(null);

/**
 * The business's quotes, invoices and payments for the whole workspace. `initial` is what the server read from PostgreSQL for this
 * page load, for the ACTIVE organization only. Every change goes to the server, which authorizes it (owner or admin), validates
 * it, stores it in one transaction and answers with the financials as stored; only then does the working copy change, so the
 * screen is never ahead of the database. It sits in the workspace layout so Payments, Quotes & Invoices, the customer pages and
 * the Overview always agree on what has been recorded.
 */
export function FinancialProvider({ initial, children }: { initial: FinancialData; children: ReactNode }) {
  const [data, setData] = useState<FinancialData>(initial);

  /** Adopt the financials a successful change answered with. */
  const adopt = useCallback(<T extends { financials: FinancialData }>(result: ActionResult<T>): ActionResult<T> => {
    if (result.ok) setData(result.data.financials);
    return result;
  }, []);

  const value = useMemo<FinancialContextValue>(
    () => ({
      data,
      recordPayment: async (input) => adopt(await send(() => recordPaymentAction(input))),
      voidPayment: async (id, reason, note) => adopt(await send(() => voidPaymentAction(id, reason, note))),
      createInvoiceFromQuote: async (quoteId, input) => adopt(await send(() => createInvoiceFromQuoteAction(quoteId, input))),
    }),
    [data, adopt],
  );

  return <FinancialContext value={value}>{children}</FinancialContext>;
}

export function useFinancials(): FinancialContextValue {
  const context = useContext(FinancialContext);
  if (!context) throw new Error("useFinancials must be used inside <FinancialProvider>.");
  return context;
}
