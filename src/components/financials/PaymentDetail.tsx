"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, History, Info, SearchX } from "lucide-react";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { invoiceHref } from "@/config/routes";
import {
  PAYMENT_METHOD_LABEL,
  getInvoiceBalance,
  getInvoiceById,
  getPaymentById,
  getRelatedWork,
  type Invoice,
  type Payment,
} from "@/data/financials";
import { getTeamMemberById } from "@/data/team";
import { formatDate } from "@/lib/format";
import { useFinancials } from "./FinancialProvider";
import { PaymentStatusBadge } from "./StatusBadges";
import { CustomerCard, PartyName, RelatedRecords, usd } from "./shared";
import { VoidPaymentModal } from "./VoidPaymentModal";

export function PaymentDetail({ paymentId }: { paymentId: string }) {
  const { data } = useFinancials();
  const payment = getPaymentById(paymentId, data);
  const invoice = payment ? getInvoiceById(payment.invoiceId, data) : undefined;

  if (!payment || !invoice) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Payment not found"
        description="This payment isn't in the list. Payments recorded in this session are cleared when the page reloads."
        action={<ButtonLink href="/payments">Back to Payments</ButtonLink>}
      />
    );
  }
  return <PaymentPage payment={payment} invoice={invoice} />;
}

function PaymentPage({ payment, invoice }: { payment: Payment; invoice: Invoice }) {
  const business = useBusiness();
  const { data } = useFinancials();
  const [voiding, setVoiding] = useState(false);

  const voided = payment.status === "voided";
  const remaining = getInvoiceBalance(invoice, data);
  const recordedBy = getTeamMemberById(payment.recordedBy)?.name ?? "Team member";
  const voidedBy = payment.void ? (getTeamMemberById(payment.void.by)?.name ?? "Team member") : undefined;

  return (
    <>
      <BackLink href="/payments">Back to Payments</BackLink>

      <header className={cardClasses("lg", "flex flex-col justify-between gap-4 lg:flex-row lg:items-start")}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Payment #{payment.id}</h1>
            <PaymentStatusBadge status={payment.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <PartyName record={invoice} /> · Invoice #{invoice.id} · {getRelatedWork(invoice)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={invoiceHref(invoice.id)} variant="secondary">
            View invoice
          </ButtonLink>
          {!voided && (
            <Button variant="destructive" onClick={() => setVoiding(true)}>
              <Ban aria-hidden className="size-4" />
              Void payment
            </Button>
          )}
        </div>
      </header>

      {voided && payment.void && (
        <section aria-label="Voided payment" className="rounded-card border border-danger-line bg-danger-soft p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Ban aria-hidden className="size-4 text-danger" />
            This payment was voided and no longer affects the invoice balance.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Void reason: {payment.void.reason} · Void date: {formatDate(payment.void.on)} · Voided by: {voidedBy}
            {payment.void.note ? ` · Note: ${payment.void.note}` : ""}
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard title="Payment summary">
            <div className="mb-4 flex items-baseline gap-2">
              <span className={voided ? "text-3xl font-bold text-ink-muted line-through" : "text-3xl font-bold text-ink"}>{usd(payment.amount)}</span>
              <span className="text-xs font-semibold text-ink-muted">USD</span>
              {voided && <span className="text-xs font-medium text-ink-muted">Original recorded amount · not counted</span>}
            </div>
            <KeyValueList
              layout="tiles"
              items={[
                { label: "Payment ID", value: `#${payment.id}` },
                { label: "Payment date", value: formatDate(payment.date) },
                {
                  label: "Payment method",
                  value: payment.checkNumber ? `${PAYMENT_METHOD_LABEL[payment.method]} #${payment.checkNumber}` : PAYMENT_METHOD_LABEL[payment.method],
                },
                { label: "Status", value: <PaymentStatusBadge status={payment.status} /> },
                {
                  label: "Invoice",
                  value: (
                    <Link href={invoiceHref(invoice.id)} className="text-primary hover:underline">
                      Invoice #{invoice.id}
                    </Link>
                  ),
                },
                { label: "Recorded by", value: `${recordedBy} · ${business.name}` },
                { label: "Contribution to invoice", value: usd(voided ? 0 : payment.amount) },
                { label: "Invoice remaining balance", value: usd(remaining) },
              ]}
            />
            <p className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
              {voided
                ? `This payment was voided on ${formatDate(payment.void?.on ?? payment.date)}. It does not contribute to the invoice balance.`
                : `Recorded against Invoice #${invoice.id}. Remaining balance on invoice: ${usd(remaining)}.`}
            </p>
          </SectionCard>

          <SectionCard title="Internal note" description="Visible only to your team.">
            <p className="text-sm text-ink-muted">{payment.note ?? "No internal note added."}</p>
          </SectionCard>

          <SectionCard title="Activity" icon={History} description={`${voided ? 2 : 1} ${voided ? "entries" : "entry"}`}>
            <ol className="space-y-3">
              {voided && payment.void && (
                <li className="rounded-card bg-surface-low p-4">
                  <p className="text-sm font-semibold text-ink">Payment voided by {voidedBy}</p>
                  <p className="text-xs text-ink-muted">
                    {formatDate(payment.void.on)} · Reason: {payment.void.reason}
                  </p>
                </li>
              )}
              <li className="rounded-card bg-surface-low p-4">
                <p className="text-sm font-semibold text-ink">Payment recorded by {recordedBy}</p>
                <p className="text-xs text-ink-muted">
                  {formatDate(payment.date)} · {usd(payment.amount)} {PAYMENT_METHOD_LABEL[payment.method].toLowerCase()} recorded against Invoice #
                  {invoice.id}
                </p>
              </li>
            </ol>
          </SectionCard>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CustomerCard record={invoice} />
          <RelatedRecords
            invoiceId={invoice.id}
            quoteId={invoice.quoteId}
            jobId={invoice.jobId}
            bookingId={invoice.bookingId}
            serviceId={invoice.serviceId}
          />
        </div>
      </div>

      {voiding && <VoidPaymentModal payment={payment} onClose={() => setVoiding(false)} />}
    </>
  );
}
