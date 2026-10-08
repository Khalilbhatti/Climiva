"use client";

import { useState } from "react";
import Link from "next/link";
import { Info, ReceiptText, SearchX, Wallet } from "lucide-react";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { jobHref, paymentHref, quoteHref } from "@/config/routes";
import {
  PAYMENT_METHOD_LABEL,
  getInvoiceBalance,
  getInvoiceById,
  getInvoiceDue,
  getInvoicePaid,
  getInvoiceStatus,
  getInvoiceTotal,
  getLineAmount,
  getLineItemsTotal,
  getPaymentsForInvoice,
  getRelatedWork,
  type Invoice,
} from "@/data/financials";
import { formatDate } from "@/lib/format";
import { useFinancials } from "./FinancialProvider";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { InvoiceStatusBadge, PaymentStatusBadge } from "./StatusBadges";
import { CustomerCard, PartyName, RelatedRecords, usd } from "./shared";

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { data } = useFinancials();
  const invoice = getInvoiceById(invoiceId, data);

  if (!invoice) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Invoice not found"
        description="This invoice isn't in the list. Invoices created in this session are cleared when the page reloads."
        action={<ButtonLink href="/quotes-invoices?tab=invoices">Back to Quotes & Invoices</ButtonLink>}
      />
    );
  }
  return <InvoicePage invoice={invoice} />;
}

function InvoicePage({ invoice }: { invoice: Invoice }) {
  const business = useBusiness();
  const { data } = useFinancials();
  const [recording, setRecording] = useState(false);

  const total = getInvoiceTotal(invoice);
  const balance = getInvoiceBalance(invoice, data);
  const status = getInvoiceStatus(invoice, data);
  const payments = getPaymentsForInvoice(invoice.id, data);
  const activePaid = payments.filter((payment) => payment.status === "recorded").reduce((sum, payment) => sum + payment.amount, 0);
  const lastVoided = payments.find((payment) => payment.status === "voided");
  const reopened = balance > 0 && lastVoided !== undefined;
  const due = getInvoiceDue(invoice);
  const work = getRelatedWork(invoice);

  return (
    <>
      <BackLink href="/quotes-invoices?tab=invoices">Back to Quotes & Invoices</BackLink>

      <header className={cardClasses("lg", "flex flex-col justify-between gap-4 lg:flex-row lg:items-start")}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Invoice #{invoice.id}</h1>
            <InvoiceStatusBadge status={status} />
            {invoice.quoteId && (
              <Link
                href={quoteHref(invoice.quoteId)}
                className="rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-ink-muted hover:text-primary"
              >
                From Quote #{invoice.quoteId}
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <PartyName record={invoice} /> · {work}
          </p>
        </div>
        {balance > 0 && (
          <Button onClick={() => setRecording(true)}>
            <Wallet aria-hidden className="size-4" />
            Record payment
          </Button>
        )}
      </header>

      {reopened && lastVoided && (
        <p role="status" className="flex items-start gap-2 rounded-card border border-warning-line bg-warning-soft p-4 text-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          Payment #{lastVoided.id} was voided. Invoice #{invoice.id} now has a balance due of {usd(balance)}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard title="Invoice summary" icon={ReceiptText}>
            <KeyValueList
              layout="tiles"
              items={[
                { label: "Billed by", value: business.name },
                { label: "Invoice number", value: `#${invoice.id}` },
                { label: "Invoice date", value: formatDate(invoice.date) },
                { label: "Payment terms", value: due.dueDate ? `${due.terms} · due ${formatDate(due.dueDate)}` : due.terms },
                {
                  label: "Source quote",
                  value: invoice.quoteId ? (
                    <Link href={quoteHref(invoice.quoteId)} className="text-primary hover:underline">
                      #{invoice.quoteId}
                    </Link>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "Related job",
                  value: invoice.jobId ? (
                    <Link href={jobHref(invoice.jobId)} className="text-primary hover:underline">
                      #{invoice.jobId}
                    </Link>
                  ) : (
                    "None"
                  ),
                },
                { label: "Payment status", value: <InvoiceStatusBadge status={status} /> },
                { label: "Currency", value: "USD ($)" },
              ]}
            />
          </SectionCard>

          <SectionCard title="Invoice items" description={`${invoice.lineItems.length} billable item${invoice.lineItems.length === 1 ? "" : "s"}`}>
            <Table aria-label="Invoice items">
              <TableHead>
                <tr>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell>Qty</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {invoice.lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.description}</div>
                      {item.detail && <div className="text-xs text-ink-muted">{item.detail}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.quantity}
                      {item.unit && ` ${item.unit}`}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {usd(item.rate)}
                      {item.unit === "hrs" && "/hr"}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{usd(getLineAmount(item))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <KeyValueList
              className="mt-4 ml-auto max-w-xs"
              items={[
                { label: "Subtotal", value: usd(getLineItemsTotal(invoice.lineItems)) },
                { label: "Tax", value: usd(0) },
                { label: "Invoice total", value: <strong>{usd(total)}</strong> },
                ...(invoice.previouslyPaid ? [{ label: "Previously paid", value: usd(invoice.previouslyPaid) }] : []),
                { label: "Payments received", value: usd(activePaid) },
                { label: "Balance due", value: <strong>{usd(balance)}</strong> },
              ]}
            />
          </SectionCard>

          {invoice.message && (
            <SectionCard title="Message to customer">
              <p className="text-sm text-ink italic">“{invoice.message}”</p>
            </SectionCard>
          )}

          <SectionCard title="Payments" description={`${payments.filter((payment) => payment.status === "recorded").length} recorded`}>
            {payments.length === 0 ? (
              <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
                No payments recorded yet. Payments recorded against this invoice will appear here.
                {invoice.previouslyPaid ? ` ${usd(invoice.previouslyPaid)} was received before payments were recorded.` : ""}
              </p>
            ) : (
              <Table aria-label="Payments for this invoice">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Payment</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Method</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Action</span>
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-semibold whitespace-nowrap text-primary">
                        <Link href={paymentHref(payment.id)} className="hover:underline">
                          #{payment.id}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(payment.date)}</TableCell>
                      <TableCell className="whitespace-nowrap">{PAYMENT_METHOD_LABEL[payment.method]}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{usd(payment.amount)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          <PaymentStatusBadge status={payment.status} />
                          {payment.status === "voided" && <span className="text-xs text-ink-muted">Not counted</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={paymentHref(payment.id)}
                          aria-label={`View payment ${payment.id}`}
                          className="rounded-btn px-2 py-1 text-sm font-semibold text-primary hover:bg-primary-subtle"
                        >
                          View payment
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-3 text-xs text-ink-muted">Payments are recorded separately and linked to this invoice.</p>
          </SectionCard>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CustomerCard record={invoice} />
          <SectionCard title="Payment summary">
            <KeyValueList
              items={[
                { label: "Invoice total", value: usd(total) },
                { label: "Payments received", value: usd(getInvoicePaid(invoice, data)) },
                { label: "Status", value: <InvoiceStatusBadge status={status} /> },
                { label: "Balance due", value: <strong>{usd(balance)}</strong> },
              ]}
            />
            {balance > 0 && (
              <Button className="mt-4 w-full" onClick={() => setRecording(true)}>
                Record payment
              </Button>
            )}
          </SectionCard>
          <RelatedRecords
            quoteId={invoice.quoteId}
            jobId={invoice.jobId}
            bookingId={invoice.bookingId}
            serviceId={invoice.serviceId}
          />
        </div>
      </div>

      {recording && <RecordPaymentModal initialInvoiceId={invoice.id} onClose={() => setRecording(false)} />}
    </>
  );
}

