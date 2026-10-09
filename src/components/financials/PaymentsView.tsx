"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Banknote, CircleDollarSign, Hourglass, Info, Plus, ReceiptText, Wallet } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { invoiceHref, paymentHref } from "@/config/routes";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  getInvoiceBalance,
  getInvoiceById,
  getInvoicePaid,
  getInvoiceStatus,
  getInvoiceTotal,
  getOutstandingBalance,
  getOutstandingInvoices,
  getPaymentsReceivedTotal,
  getRecordedPaymentsCount,
  getRelatedWork,
  newestFirst,
  type FinancialData,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/data/financials";
import { getPartyName } from "@/data/operations";
import { formatDate } from "@/lib/format";
import { useFinancials } from "./FinancialProvider";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { InvoiceStatusBadge, PaymentStatusBadge } from "./StatusBadges";
import { PartyName, usd } from "./shared";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan } from "@/components/workspace/WorkspaceProvider";

type TabId = "payments" | "outstanding";

/** The invoices behind the approved "no payments yet" state: three open invoices and nothing recorded. */
const EMPTY_PREVIEW_INVOICES = ["INV-1044", "INV-1050", "INV-1051"];

export function PaymentsView() {
  const dir = useDirectory();
  const canManage = useCan("financials:manage");
  const { data: live } = useFinancials();
  const router = useRouter();
  const params = useSearchParams();

  const tabId: TabId = params.get("tab") === "outstanding" ? "outstanding" : "payments";
  const recording = params.get("record") === "1";
  const presetInvoice = params.get("invoice") ?? undefined;
  // "?state=empty" previews the approved empty state without having to void every payment.
  const previewEmpty = params.get("state") === "empty";

  const data: FinancialData = useMemo(
    () => (previewEmpty ? { ...live, payments: [], invoices: live.invoices.filter((invoice) => EMPTY_PREVIEW_INVOICES.includes(invoice.id)) } : live),
    [live, previewEmpty],
  );

  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<"all" | PaymentMethod>("all");
  const [status, setStatus] = useState<"all" | PaymentStatus>("all");
  const [customer, setCustomer] = useState("all");
  const [invoiceStatus, setInvoiceStatus] = useState<"all" | InvoiceStatus>("all");

  function setParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace((qs ? `/payments?${qs}` : "/payments") as Route, { scroll: false });
  }

  const payments = [...data.payments].sort(newestFirst);
  const outstanding = getOutstandingInvoices(data);
  const partyOf = (invoiceId: string) => getInvoiceById(invoiceId, data);
  const customerNames = [...new Set(payments.map((payment) => getPartyName(partyOf(payment.invoiceId)!, dir)))].sort();

  const needle = query.trim().toLowerCase();
  const visiblePayments = payments.filter((payment) => {
    const invoice = partyOf(payment.invoiceId)!;
    const name = getPartyName(invoice, dir);
    return (
      `${payment.id} ${payment.invoiceId} ${name}`.toLowerCase().includes(needle) &&
      (method === "all" || payment.method === method) &&
      (status === "all" || payment.status === status) &&
      (customer === "all" || name === customer)
    );
  });
  const filteringPayments = needle !== "" || method !== "all" || status !== "all" || customer !== "all";

  const visibleOutstanding = outstanding.filter(
    (invoice) =>
      `${invoice.id} ${getPartyName(invoice, dir)} ${getRelatedWork(invoice, dir.services)}`.toLowerCase().includes(needle) &&
      (invoiceStatus === "all" || getInvoiceStatus(invoice, data) === invoiceStatus),
  );
  const filteringOutstanding = needle !== "" || invoiceStatus !== "all";

  return (
    <>
      <PageHeader
        title="Payments"
        description="Track payments recorded against customer Invoices and review outstanding balances."
        actions={
          canManage && (
            <Button size="lg" onClick={() => setParams({ record: "1", invoice: null })}>
              <Plus aria-hidden className="size-[18px]" />
              Record payment
            </Button>
          )
        }
      />

      <section aria-label="Payment totals" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Payments recorded" value={getRecordedPaymentsCount(data)} icon={ReceiptText} hint="Active non-voided payments" />
        <KpiCard
          label="Amount received"
          value={usd(getPaymentsReceivedTotal(data))}
          icon={Banknote}
          tone="positive"
          hint="Sum of active recorded payments"
        />
        <KpiCard label="Outstanding invoices" value={outstanding.length} icon={Hourglass} hint="Invoices with balance > $0" />
        <KpiCard label="Outstanding balance" value={usd(getOutstandingBalance(data))} icon={Wallet} hint="Total remaining across open Invoices" />
      </section>

      <Card padding="md" className="space-y-4">
        <Tabs
          label="Payment lists"
          idPrefix="payments"
          value={tabId}
          onChange={(id) => {
            setQuery("");
            setParams({ tab: id === "outstanding" ? "outstanding" : null });
          }}
          tabs={[
            { id: "payments", label: "Payments", count: payments.length },
            { id: "outstanding", label: "Outstanding invoices", count: outstanding.length },
          ]}
        />

        <div role="tabpanel" id={`payments-panel-${tabId}`} aria-labelledby={`payments-tab-${tabId}`} className="space-y-4">
          {tabId === "payments" ? (
            payments.length === 0 ? (
              <EmptyState
                icon={CircleDollarSign}
                title="No payments recorded yet"
                description="Payments will appear here when you record money received against an Invoice."
                action={
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {canManage && (
                      <Button size="lg" onClick={() => setParams({ record: "1", invoice: null })}>
                        <Plus aria-hidden className="size-[18px]" />
                        Record payment
                      </Button>
                    )}
                    <Button size="lg" variant="secondary" onClick={() => setParams({ tab: "outstanding" })}>
                      View outstanding invoices
                    </Button>
                  </div>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <SearchInput
                    wrapperClassName="min-w-60 flex-1"
                    aria-label="Search payments"
                    placeholder="Search payment, invoice or customer..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <div className="w-52">
                    <Select label="Method" hideLabel value={method} onChange={(event) => setMethod(event.target.value as "all" | PaymentMethod)}>
                      <option value="all">Method: All methods</option>
                      {PAYMENT_METHODS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-52">
                    <Select label="Status" hideLabel value={status} onChange={(event) => setStatus(event.target.value as "all" | PaymentStatus)}>
                      <option value="all">Status: All statuses</option>
                      <option value="recorded">Recorded</option>
                      <option value="voided">Voided</option>
                    </Select>
                  </div>
                  <div className="w-60">
                    <Select label="Customer" hideLabel value={customer} onChange={(event) => setCustomer(event.target.value)}>
                      <option value="all">Customer: All customers</option>
                      {customerNames.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </Select>
                  </div>
                  {filteringPayments && (
                    <Button
                      variant="tertiary"
                      onClick={() => {
                        setQuery("");
                        setMethod("all");
                        setStatus("all");
                        setCustomer("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>

                <Table aria-label="Payments">
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Payment</TableHeaderCell>
                      <TableHeaderCell>Customer</TableHeaderCell>
                      <TableHeaderCell>Invoice</TableHeaderCell>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Method</TableHeaderCell>
                      <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>
                        <span className="sr-only">Actions</span>
                      </TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {visiblePayments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
                          No payments match your filters.
                        </td>
                      </tr>
                    ) : (
                      visiblePayments.map((payment) => {
                        const invoice = partyOf(payment.invoiceId)!;
                        const name = getPartyName(invoice, dir);
                        return (
                          <TableRow key={payment.id}>
                            <TableCell className="font-semibold whitespace-nowrap text-primary">
                              <Link href={paymentHref(payment.id)} className="hover:underline">
                                #{payment.id}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <Avatar name={name} />
                                <span className="font-medium whitespace-nowrap">
                                  <PartyName record={invoice} />
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Link href={invoiceHref(payment.invoiceId)} className="text-primary hover:underline">
                                #{payment.invoiceId}
                              </Link>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{formatDate(payment.date)}</TableCell>
                            <TableCell className="whitespace-nowrap">{PAYMENT_METHOD_LABEL[payment.method]}</TableCell>
                            <TableCell className="text-right font-semibold whitespace-nowrap">{usd(payment.amount)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-0.5">
                                <PaymentStatusBadge status={payment.status} />
                                {payment.status === "voided" && <span className="text-xs text-ink-muted">Excluded from total</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Link
                                href={paymentHref(payment.id)}
                                aria-label={`View payment ${payment.id}`}
                                className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                              >
                                View payment
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                <p aria-live="polite" className="text-xs text-ink-muted">
                  Showing {visiblePayments.length} of {payments.length} payments
                </p>
              </>
            )
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold text-ink">Outstanding invoices</h2>
                <p className="text-xs text-ink-muted">Invoices with a remaining balance. Record payments as money is received from customers.</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <SearchInput
                  wrapperClassName="min-w-60 flex-1"
                  aria-label="Search outstanding invoices"
                  placeholder="Search invoice, customer or work..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className="w-56">
                  <Select
                    label="Payment status"
                    hideLabel
                    value={invoiceStatus}
                    onChange={(event) => setInvoiceStatus(event.target.value as "all" | InvoiceStatus)}
                  >
                    <option value="all">Payment status: All (Unpaid, Partially paid)</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="partially-paid">Partially paid</option>
                  </Select>
                </div>
                {filteringOutstanding && (
                  <Button
                    variant="tertiary"
                    onClick={() => {
                      setQuery("");
                      setInvoiceStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>

              <Table aria-label="Outstanding invoices">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Customer</TableHeaderCell>
                    <TableHeaderCell>Invoice date</TableHeaderCell>
                    <TableHeaderCell className="text-right">Invoice total</TableHeaderCell>
                    <TableHeaderCell className="text-right">Paid</TableHeaderCell>
                    <TableHeaderCell className="text-right">Balance due</TableHeaderCell>
                    <TableHeaderCell>Payment status</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {visibleOutstanding.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
                        {filteringOutstanding ? "No outstanding invoices match your filters." : "No invoices have an outstanding balance."}
                      </td>
                    </tr>
                  ) : (
                    visibleOutstanding.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <Link href={invoiceHref(invoice.id)} className="font-semibold whitespace-nowrap text-primary hover:underline">
                            #{invoice.id}
                          </Link>
                          <div className="max-w-52 text-xs text-ink-muted">{getRelatedWork(invoice, dir.services)}</div>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          <PartyName record={invoice} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(invoice.date)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{usd(getInvoiceTotal(invoice))}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{usd(getInvoicePaid(invoice, data))}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{usd(getInvoiceBalance(invoice, data))}</TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={getInvoiceStatus(invoice, data)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => setParams({ record: "1", invoice: invoice.id })}
                                aria-label={`Record payment for invoice ${invoice.id}`}
                                className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                              >
                                Record payment
                              </button>
                            )}
                            <Link
                              href={invoiceHref(invoice.id)}
                              aria-label={`View invoice ${invoice.id}`}
                              className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
                            >
                              View invoice
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p aria-live="polite" className="text-xs text-ink-muted">
                Showing {visibleOutstanding.length} of {outstanding.length} outstanding invoices · Total remaining open balance:{" "}
                {usd(getOutstandingBalance(data))}
              </p>
            </>
          )}
        </div>
      </Card>

      <aside className="flex items-start gap-3 rounded-card border border-line bg-surface-low p-4 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="font-semibold text-ink">Operational notice. </span>
          Payments are separate records linked to Invoices. Voided Payments remain in history but no longer count toward the Invoice balance.
          Invoices update to Paid once their balance due reaches $0.00.
        </p>
      </aside>

      {recording && canManage && (
        <RecordPaymentModal
          key={presetInvoice ?? "pick"}
          initialInvoiceId={presetInvoice}
          onClose={() => setParams({ record: null, invoice: null })}
        />
      )}
    </>
  );
}
