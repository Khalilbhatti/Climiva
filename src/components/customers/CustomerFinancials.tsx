"use client";

import Link from "next/link";
import { CircleDollarSign } from "lucide-react";
import { useFinancials } from "@/components/financials/FinancialProvider";
import { InvoiceStatusBadge, PaymentStatusBadge, QuoteStatusBadge } from "@/components/financials/StatusBadges";
import { usd } from "@/components/financials/shared";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { invoiceHref, paymentHref, quoteHref } from "@/config/routes";
import { getCustomerFinancials, getInvoiceBalance, getInvoicePaid, getInvoiceStatus, getInvoiceTotal, getQuoteTotal } from "@/data/financials";
import { formatDate } from "@/lib/format";
import { addMoney } from "@/lib/money";

/**
 * The customer's quotes, invoices and payments, read from the business's shared financial records (the same ones Payments and
 * Quotes & Invoices show), so a payment recorded or voided anywhere is reflected here. Read-only: the documents are changed on
 * their own pages. Voided payments stay in the list, marked, and count toward nothing.
 */
export function CustomerFinancialsCard({ customerId }: { customerId: string }) {
  const { data } = useFinancials();
  const { quotes, invoices, payments } = getCustomerFinancials(customerId, data);

  return (
    <SectionCard title="Financial history" icon={CircleDollarSign}>
      {quotes.length === 0 && invoices.length === 0 && payments.length === 0 ? (
        <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No quotes, invoices or payments are recorded for this customer yet.</p>
      ) : (
        <div className="space-y-5">
          <KeyValueList
            layout="tiles"
            items={[
              { label: "Invoiced", value: usd(addMoney(...invoices.map(getInvoiceTotal))) },
              { label: "Paid", value: usd(addMoney(...invoices.map((invoice) => getInvoicePaid(invoice, data)))) },
              { label: "Balance due", value: <strong>{usd(addMoney(...invoices.map((invoice) => getInvoiceBalance(invoice, data))))}</strong> },
            ]}
          />

          <HistoryList title="Invoices" empty="No invoices yet.">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-low p-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Link href={invoiceHref(invoice.id)} className="text-primary hover:underline">
                      Invoice #{invoice.id}
                    </Link>
                    <InvoiceStatusBadge status={getInvoiceStatus(invoice, data)} />
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">{formatDate(invoice.date)}</p>
                </div>
                <p className="text-right text-sm text-ink">
                  <span className="font-semibold">{usd(getInvoiceTotal(invoice))}</span>
                  <span className="block text-xs text-ink-muted">Balance due {usd(getInvoiceBalance(invoice, data))}</span>
                </p>
              </li>
            ))}
          </HistoryList>

          <HistoryList title="Payments" empty="No payments yet.">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-low p-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Link href={paymentHref(payment.id)} className="text-primary hover:underline">
                      Payment #{payment.id}
                    </Link>
                    <PaymentStatusBadge status={payment.status} />
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {formatDate(payment.date)} · Invoice #{payment.invoiceId}
                  </p>
                </div>
                <p className="text-right text-sm font-semibold text-ink">
                  {usd(payment.amount)}
                  {payment.status === "voided" && <span className="block text-xs font-normal text-ink-muted">Not counted</span>}
                </p>
              </li>
            ))}
          </HistoryList>

          <HistoryList title="Quotes" empty="No quotes yet.">
            {quotes.map((quote) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-low p-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Link href={quoteHref(quote.id)} className="text-primary hover:underline">
                      Quote #{quote.id}
                    </Link>
                    <QuoteStatusBadge status={quote.status} />
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">{formatDate(quote.createdOn)}</p>
                </div>
                <p className="text-sm font-semibold text-ink">{usd(getQuoteTotal(quote))}</p>
              </li>
            ))}
          </HistoryList>
        </div>
      )}
    </SectionCard>
  );
}

function HistoryList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-ink-muted">{title}</h3>
      {children.length === 0 ? <p className="text-sm text-ink-muted">{empty}</p> : <ul className="space-y-2">{children}</ul>}
    </div>
  );
}
