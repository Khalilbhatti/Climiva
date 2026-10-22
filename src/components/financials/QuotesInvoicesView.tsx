"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, Clock, FileCheck2, FileText, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useOpenedByLink } from "@/components/ui/useOpenedByLink";
import { invoiceHref, quoteHref } from "@/config/routes";
import {
  INVOICE_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  getInvoiceBalance,
  getInvoiceStatus,
  getInvoiceTotal,
  getQuoteTotal,
  getRelatedWork,
  newestFirst,
  type Invoice,
  type InvoiceStatus,
  type Quote,
  type QuoteStatus,
} from "@/data/financials";
import { getPartyName } from "@/data/operations";
import { formatMonthDay } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { CreateQuoteModal } from "./CreateQuoteModal";
import { useFinancials } from "./FinancialProvider";
import { InvoiceStatusBadge, QuoteStatusBadge } from "./StatusBadges";
import { PartyName, usd } from "./shared";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan } from "@/components/workspace/WorkspaceProvider";

type TabId = "quotes" | "invoices";

const QUOTE_STATUSES = Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[];
const INVOICE_STATUSES = Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[];

function StatusFilter<T extends string>({
  label,
  options,
  value,
  counts,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: "all" | T;
  counts: Record<"all" | T, number>;
  onChange: (value: "all" | T) => void;
}) {
  const all = [{ id: "all" as const, label: "All" }, ...options];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {all.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            value === option.id ? "bg-primary text-white" : "bg-surface-low text-ink-muted hover:text-ink",
          )}
        >
          {option.label} ({counts[option.id]})
        </button>
      ))}
    </div>
  );
}

export function QuotesInvoicesView() {
  const dir = useDirectory();
  const { data } = useFinancials();
  // An owner or admin creates quotes (the server asks again). The one action is in the header, or in the empty page while there is nothing else to show.
  const canManage = useCan("financials:manage");
  const link = useOpenedByLink("/quotes-invoices", canManage);
  const [creating, setCreating] = useState(false);
  const createQuote = canManage && (
    <Button size="lg" onClick={() => setCreating(true)}>
      <Plus aria-hidden className="size-[18px]" />
      Create quote
    </Button>
  );
  const creator = canManage && (creating || link.asked) && (
    <CreateQuoteModal
      onClose={() => {
        setCreating(false);
        link.done();
      }}
    />
  );
  const router = useRouter();
  const params = useSearchParams();
  const tabId: TabId = params.get("tab") === "invoices" ? "invoices" : "quotes";

  const [query, setQuery] = useState("");
  const [quoteStatus, setQuoteStatus] = useState<"all" | QuoteStatus>("all");
  const [invoiceStatus, setInvoiceStatus] = useState<"all" | InvoiceStatus>("all");
  const [customer, setCustomer] = useState("all");
  const [service, setService] = useState("all");

  const quotes = [...data.quotes].sort(newestFirst);
  const invoices = [...data.invoices].sort(newestFirst);
  const statusOf = (id: string) => getInvoiceStatus(data.invoices.find((invoice) => invoice.id === id)!, data);

  const needle = query.trim().toLowerCase();
  const matches = (record: Quote | Invoice) =>
    `${record.id} ${getPartyName(record, dir)} ${getRelatedWork(record, dir.services)}`.toLowerCase().includes(needle) &&
    (customer === "all" || getPartyName(record, dir) === customer) &&
    (service === "all" || record.serviceId === service);

  const visibleQuotes = quotes.filter((quote) => matches(quote) && (quoteStatus === "all" || quote.status === quoteStatus));
  const visibleInvoices = invoices.filter((invoice) => matches(invoice) && (invoiceStatus === "all" || statusOf(invoice.id) === invoiceStatus));
  const filtering = needle !== "" || customer !== "all" || service !== "all" || (tabId === "quotes" ? quoteStatus !== "all" : invoiceStatus !== "all");

  const customerNames = [...new Set([...quotes, ...invoices].map((record) => getPartyName(record, dir)))].sort();
  const quoteCounts = Object.fromEntries([
    ["all", quotes.length],
    ...QUOTE_STATUSES.map((status) => [status, quotes.filter((quote) => quote.status === status).length]),
  ]) as Record<"all" | QuoteStatus, number>;
  const invoiceCounts = Object.fromEntries([
    ["all", invoices.length],
    ...INVOICE_STATUSES.map((status) => [status, invoices.filter((invoice) => statusOf(invoice.id) === status).length]),
  ]) as Record<"all" | InvoiceStatus, number>;

  function clear() {
    setQuery("");
    setCustomer("all");
    setService("all");
    setQuoteStatus("all");
    setInvoiceStatus("all");
  }

  // Nothing has been created yet: say what this page holds, instead of four zero totals over two empty tables.
  if (quotes.length === 0 && invoices.length === 0) {
    return (
      <>
        <PageHeader title="Quotes & Invoices" description="What you have quoted and billed your customers." />
        <EmptyState
          icon={FileText}
          title="No quotes yet"
          description={
            canManage
              ? "Create a quote for a customer when you need to price work before invoicing."
              : "Quotes your business creates appear here, and the invoices made from approved quotes."
          }
          action={createQuote || undefined}
        />
        {creator}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Quotes & Invoices" description="What you have quoted and billed your customers." actions={createQuote || undefined} />
      {creator}

      <section aria-label="Quote and invoice totals" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open quotes"
          value={quotes.filter((quote) => quote.status === "draft" || quote.status === "sent").length}
          icon={Clock}
          hint="Draft or awaiting customer decision"
        />
        <KpiCard label="Approved quotes" value={quoteCounts.approved} icon={FileCheck2} hint="Ready for work or invoicing" />
        <KpiCard label="Unpaid invoices" value={invoiceCounts.unpaid + invoiceCounts["partially-paid"]} icon={FileText} hint="Payment outstanding" />
        <KpiCard label="Paid invoices" value={invoiceCounts.paid} icon={CircleCheck} hint="Payment recorded" tone="positive" />
      </section>

      <Card padding="md" className="space-y-4">
        <Tabs
          label="Quotes and invoices"
          idPrefix="quotes-invoices"
          value={tabId}
          onChange={(id) => {
            clear();
            router.replace((id === "invoices" ? "/quotes-invoices?tab=invoices" : "/quotes-invoices") as Route, { scroll: false });
          }}
          tabs={[
            { id: "quotes", label: "Quotes", count: quotes.length },
            { id: "invoices", label: "Invoices", count: invoices.length },
          ]}
        />

        <div role="tabpanel" id={`quotes-invoices-panel-${tabId}`} aria-labelledby={`quotes-invoices-tab-${tabId}`} className="space-y-4">
          {tabId === "quotes" ? (
            <StatusFilter
              label="Filter quotes by status"
              value={quoteStatus}
              counts={quoteCounts}
              onChange={setQuoteStatus}
              options={QUOTE_STATUSES.map((id) => ({ id, label: QUOTE_STATUS_LABEL[id] }))}
            />
          ) : (
            <StatusFilter
              label="Filter invoices by status"
              value={invoiceStatus}
              counts={invoiceCounts}
              onChange={setInvoiceStatus}
              options={INVOICE_STATUSES.map((id) => ({ id, label: INVOICE_STATUS_LABEL[id] }))}
            />
          )}

          <div className="flex flex-wrap items-end gap-3">
            <SearchInput
              wrapperClassName="min-w-60 flex-1"
              aria-label={tabId === "quotes" ? "Search quotes" : "Search invoices"}
              placeholder="Search by number, customer or work..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="w-52">
              <Select label="Customer" hideLabel value={customer} onChange={(event) => setCustomer(event.target.value)}>
                <option value="all">Customer: All</option>
                {customerNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </Select>
            </div>
            <div className="w-56">
              <Select label="Service" hideLabel value={service} onChange={(event) => setService(event.target.value)}>
                <option value="all">Service: All</option>
                {dir.services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>
            {filtering && (
              <Button variant="tertiary" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>

          {tabId === "quotes" ? (
            <>
              <Table aria-label="Quotes">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Quote</TableHeaderCell>
                    <TableHeaderCell>Customer</TableHeaderCell>
                    <TableHeaderCell>Related work</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Last updated</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {visibleQuotes.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                        {filtering ? "No quotes match your filters." : "No quotes yet."}
                      </td>
                    </tr>
                  ) : (
                    visibleQuotes.map((quote) => (
                      <TableRow key={quote.id}>
                        <TableCell className="font-semibold whitespace-nowrap text-primary">
                          <Link href={quoteHref(quote.id)} className="hover:underline">
                            #{quote.id}
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          <PartyName record={quote} />
                        </TableCell>
                        <TableCell className="max-w-56">
                          <div>{getRelatedWork(quote, dir.services)}</div>
                          {quote.jobId && <div className="text-xs text-ink-muted">Job #{quote.jobId}</div>}
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{usd(getQuoteTotal(quote))}</TableCell>
                        <TableCell>
                          <QuoteStatusBadge status={quote.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-ink-muted">{formatMonthDay(quote.updatedOn)}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={quoteHref(quote.id)}
                            aria-label={`View quote ${quote.id}`}
                            className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                          >
                            View quote
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p aria-live="polite" className="text-xs text-ink-muted">
                Showing {visibleQuotes.length} of {quotes.length} quotes
              </p>
            </>
          ) : (
            <>
              <Table aria-label="Invoices">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Customer</TableHeaderCell>
                    <TableHeaderCell>Related work</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell className="text-right">Balance due</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Invoice date</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {visibleInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
                        {filtering ? "No invoices match your filters." : "No invoices yet."}
                      </td>
                    </tr>
                  ) : (
                    visibleInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-semibold whitespace-nowrap text-primary">
                          <Link href={invoiceHref(invoice.id)} className="hover:underline">
                            #{invoice.id}
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          <PartyName record={invoice} />
                        </TableCell>
                        <TableCell className="max-w-56">
                          <div>{getRelatedWork(invoice, dir.services)}</div>
                          {invoice.jobId && <div className="text-xs text-ink-muted">Job #{invoice.jobId}</div>}
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{usd(getInvoiceTotal(invoice))}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{usd(getInvoiceBalance(invoice, data))}</TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={statusOf(invoice.id)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-ink-muted">{formatDate(invoice.date)}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={invoiceHref(invoice.id)}
                            aria-label={`View invoice ${invoice.id}`}
                            className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                          >
                            View invoice
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p aria-live="polite" className="text-xs text-ink-muted">
                Showing {visibleInvoices.length} of {invoices.length} invoices
              </p>
            </>
          )}
        </div>
      </Card>

      <aside className="flex items-start gap-3 rounded-card border border-line bg-surface-low p-4 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="font-semibold text-ink">Quote and invoice workflow. </span>
          Quotes help customers review proposed work before approval. Invoices are created separately when your business is ready to bill
          for approved work, using the Create invoice action on an approved quote.
        </p>
      </aside>
    </>
  );
}
