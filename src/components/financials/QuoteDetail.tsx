"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, History, Receipt, SearchX } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { invoiceHref, jobHref } from "@/config/routes";
import {
  getInvoiceStatus,
  getInvoicesForQuote,
  getLineAmount,
  getQuoteById,
  getQuoteTotal,
  getRelatedWork,
  type Quote,
} from "@/data/financials";
import { formatDate } from "@/lib/format";
import { CreateInvoiceModal } from "./CreateInvoiceModal";
import { useFinancials } from "./FinancialProvider";
import { InvoiceStatusBadge, QuoteStatusBadge } from "./StatusBadges";
import { CustomerCard, PartyName, RelatedRecords, usd } from "./shared";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan } from "@/components/workspace/WorkspaceProvider";

export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const { data } = useFinancials();
  const quote = getQuoteById(quoteId, data);

  if (!quote) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Quote not found"
        description="This quote isn't in this workspace. It may have been mistyped, or it belongs to another business."
        action={<ButtonLink href="/quotes-invoices">Back to Quotes & Invoices</ButtonLink>}
      />
    );
  }
  return <QuotePage quote={quote} />;
}

function QuotePage({ quote }: { quote: Quote }) {
  const dir = useDirectory();
  const { data } = useFinancials();
  const canManage = useCan("financials:manage");
  const [creating, setCreating] = useState(false);

  const invoices = getInvoicesForQuote(quote.id, data);
  const canInvoice = quote.status === "approved" && invoices.length === 0 && canManage;
  const total = getQuoteTotal(quote);

  return (
    <>
      <BackLink href="/quotes-invoices">Back to Quotes & Invoices</BackLink>

      <header className={cardClasses("lg", "flex flex-col justify-between gap-4 lg:flex-row lg:items-start")}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Quote #{quote.id}</h1>
            <QuoteStatusBadge status={quote.status} />
            {quote.jobId && (
              <Link
                href={jobHref(quote.jobId)}
                className="rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-ink-muted hover:text-primary"
              >
                Linked to Job #{quote.jobId}
              </Link>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <PartyName record={quote} /> · {getRelatedWork(quote, dir.services)}
          </p>
        </div>
        {canInvoice && (
          <Button onClick={() => setCreating(true)}>
            <Receipt aria-hidden className="size-4" />
            Create invoice
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard title="Quote summary">
            <KeyValueList
              layout="tiles"
              items={[
                { label: "Quote ID", value: `#${quote.id}` },
                { label: "Status", value: <QuoteStatusBadge status={quote.status} /> },
                { label: "Customer", value: <PartyName record={quote} /> },
                { label: "Created date", value: formatDate(quote.createdOn) },
                { label: "Approval date", value: quote.approvedOn ? formatDate(quote.approvedOn) : "Not approved" },
                { label: "Primary service", value: getRelatedWork(quote, dir.services) },
              ]}
            />
          </SectionCard>

          <SectionCard title="Line items" description={`${quote.lineItems.length} item${quote.lineItems.length === 1 ? "" : "s"} listed`}>
            <Table aria-label="Quote line items">
              <TableHead>
                <tr>
                  <TableHeaderCell>Item & description</TableHeaderCell>
                  <TableHeaderCell>Qty</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rate</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {quote.lineItems.map((item) => (
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
                { label: "Subtotal", value: usd(total) },
                { label: "Tax", value: "Uses business tax settings" },
                { label: "Total", value: <strong>{usd(total)}</strong> },
              ]}
            />
          </SectionCard>

          {quote.message && (
            <SectionCard title="Customer message">
              <p className="text-sm text-ink italic">“{quote.message}”</p>
            </SectionCard>
          )}

          <SectionCard title="Quote terms">
            <ul className="space-y-1.5 text-sm text-ink">
              {quote.validThrough && <li>Quote valid through: {formatDate(quote.validThrough)}</li>}
              <li>Payment: Due after invoicing</li>
              <li>Approval: Customer approval is required before quoted repair work is billed.</li>
            </ul>
          </SectionCard>

          {quote.status === "approved" && (
            <p className="flex items-center gap-2 rounded-card border border-positive-line bg-positive-soft p-4 text-sm font-medium text-ink">
              <CircleCheck aria-hidden className="size-4 text-positive" />
              {invoices.length === 0 ? "Quote approved by customer · Ready for invoicing" : "Quote approved by customer · Invoiced"}
            </p>
          )}
        </div>

        <div className="space-y-6 lg:col-span-4">
          <CustomerCard record={quote} />
          <SectionCard title="Quote status">
            <KeyValueList
              items={[
                { label: "Current state", value: <QuoteStatusBadge status={quote.status} /> },
                { label: "Customer approval", value: quote.status === "approved" ? "Approved by customer" : "Not approved" },
                {
                  label: "Invoice",
                  value:
                    invoices.length === 0 ? (
                      "No invoice created yet"
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        <Link href={invoiceHref(invoices[0].id)} className="text-primary hover:underline">
                          #{invoices[0].id}
                        </Link>
                        <InvoiceStatusBadge status={getInvoiceStatus(invoices[0], data)} />
                      </span>
                    ),
                },
              ]}
            />
            <p className="mt-3 text-xs text-ink-muted">An approved quote remains separate from its invoice until an invoice is created.</p>
            {canInvoice && (
              <Button className="mt-3 w-full" onClick={() => setCreating(true)}>
                Create invoice
              </Button>
            )}
          </SectionCard>
          <RelatedRecords jobId={quote.jobId} bookingId={quote.bookingId} serviceId={quote.serviceId} invoiceId={invoices[0]?.id} />
          <SectionCard title="Quote activity" icon={History}>
            <ol className="space-y-2 text-sm">
              {quote.activity.map((entry) => (
                <li key={entry.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink">{entry.label}</span>
                  <span className="text-xs text-ink-muted">{formatDate(entry.on)}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      {creating && <CreateInvoiceModal quote={quote} onClose={() => setCreating(false)} />}
    </>
  );
}
