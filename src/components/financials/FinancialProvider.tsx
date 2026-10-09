"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { FINANCIALS, type FinancialData, type Invoice, type Payment } from "@/data/financials";
import * as state from "@/lib/financial-state";

type FinancialContextValue = {
  /** The working data: canonical fixtures plus any demo changes made in this session. */
  data: FinancialData;
  /** Returns the new payment, or undefined when the amount is not valid for the invoice. */
  recordPayment: (input: state.NewPaymentInput) => Payment | undefined;
  voidPayment: (paymentId: string, reason: string, note?: string) => void;
  /** Returns the new invoice, or undefined when the quote can't be invoiced. */
  createInvoiceFromQuote: (quoteId: string, input: state.NewInvoiceInput) => Invoice | undefined;
};

const FinancialContext = createContext<FinancialContextValue | null>(null);

/**
 * The demo copy of quotes, invoices and payments for the whole workspace. It starts as the canonical
 * fixtures, lives only in memory (a reload restores the baseline) and never writes back to
 * data/financials.ts. It sits in the workspace layout so Payments, Quotes & Invoices and the Overview
 * always agree on what has been recorded this session, however the user navigates between them.
 */
export function FinancialProvider({ initial = FINANCIALS, children }: { initial?: FinancialData; children: ReactNode }) {
  const [data, setData] = useState<FinancialData>(initial);
  // The ref lets actions that return a value read the latest data synchronously.
  const latest = useRef(data);

  const commit = useCallback((next: FinancialData) => {
    latest.current = next;
    setData(next);
  }, []);

  const value = useMemo<FinancialContextValue>(
    () => ({
      data,
      recordPayment: (input) => {
        const result = state.recordPayment(latest.current, input);
        commit(result.data);
        return result.payment;
      },
      voidPayment: (id, reason, note) => commit(state.voidPayment(latest.current, id, reason, note)),
      createInvoiceFromQuote: (quoteId, input) => {
        const result = state.createInvoiceFromQuote(latest.current, quoteId, input);
        commit(result.data);
        return result.invoice;
      },
    }),
    [data, commit],
  );

  return <FinancialContext value={value}>{children}</FinancialContext>;
}

export function useFinancials(): FinancialContextValue {
  const context = useContext(FinancialContext);
  if (!context) throw new Error("useFinancials must be used inside <FinancialProvider>.");
  return context;
}
