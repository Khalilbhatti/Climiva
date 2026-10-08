"use client";

import Link from "next/link";
import { Banknote, CalendarCheck, CircleCheck, ReceiptText, Wrench } from "lucide-react";
import { BookingStatusBadge, JobStatusBadge } from "@/components/operations/StatusBadges";
import { PaymentStatusBadge } from "@/components/financials/StatusBadges";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { jobHref, paymentHref } from "@/config/routes";
import { getPropertyById, formatPropertyAddress } from "@/data/customers";
import { PAYMENT_METHOD_LABEL, getInvoiceById, type FinancialData } from "@/data/financials";
import { BOOKING_TABS, getPartyName, getServiceNameFor, type Booking, type Job } from "@/data/operations";
import { formatMonthDay, formatTime } from "@/lib/dates";
import { formatUSD } from "@/lib/format";
import type { AnalyticsModel } from "@/lib/analytics-state";
import { OwnerLink, ServiceActivityTable, StatTile, WeeklyChart } from "./parts";

type PanelProps = { model: AnalyticsModel };

const dateOf = (timestamp: string) => timestamp.slice(0, 10);

/** The five headline totals. At the baseline they are the Overview's, and the money ones follow the session. */
export function KpiRow({ kpis }: { kpis: AnalyticsModel["kpis"] }) {
  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
      <KpiCard label="Bookings" value={kpis.bookings} icon={CalendarCheck} hint="Bookings created" href="/bookings" />
      <KpiCard label="Jobs completed" value={kpis.completedJobs} icon={CircleCheck} hint="Completed Jobs" href="/jobs" />
      <KpiCard label="Quote value" value={formatUSD(kpis.quoteValue)} icon={ReceiptText} hint="Quotes created" href="/quotes-invoices" />
      <KpiCard label="Invoiced" value={formatUSD(kpis.invoiced)} icon={ReceiptText} hint="Invoice total" href="/quotes-invoices" />
      <KpiCard label="Payments received" value={formatUSD(kpis.paymentsReceived)} icon={Banknote} tone="positive" hint="Recorded non-voided Payments" href="/payments" />
    </section>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

export function OverviewPanel({ model }: PanelProps) {
  return (
    <div className="space-y-6">
      <KpiRow kpis={model.kpis} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <SectionCard title="Operational activity" description="Weekly volume of Bookings and completed Jobs" className="xl:col-span-3">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-btn bg-surface-low px-4 py-2.5 text-sm">
            <span className="text-ink-muted">Selected period summary</span>
            <span className="font-semibold text-ink">
              {model.bookings.total} Bookings · {model.jobs.completed} Completed Jobs
            </span>
          </div>
          <div aria-hidden className="mb-4 flex items-center justify-end gap-4 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary" />
              Bookings
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-warning" />
              Completed Jobs
            </span>
          </div>
          <WeeklyChart weekly={model.weekly} />
        </SectionCard>

        <SectionCard title="Service activity" description="Bookings and completed Jobs by Service" className="xl:col-span-2">
          <ServiceActivityTable services={model.services} />
        </SectionCard>
      </div>

      <SectionCard title="Financial record totals" description="These totals are separate record types for the selected period.">
        <ul className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Quotes created", detail: `${model.quotes.count} quotes`, value: model.kpis.quoteValue },
            { label: "Invoices created", detail: `${model.invoices.count} invoices`, value: model.invoices.total },
            { label: "Payments recorded", detail: `${model.payments.recorded} payments`, value: model.payments.received },
          ].map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 rounded-card bg-surface-low px-4 py-3">
              <span>
                <span className="block text-sm font-semibold text-ink">{row.label}</span>
                <span className="block text-xs text-ink-muted">{row.detail}</span>
              </span>
              <span className="text-lg font-bold text-primary">{formatUSD(row.value)}</span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

/* ───────────────────────── Bookings & Jobs ───────────────────────── */

function bookingHref(booking: Booking) {
  const tab = BOOKING_TABS.find((item) => item.status === booking.status)?.id ?? "requests";
  return `/bookings?tab=${tab}&booking=${booking.id}` as const;
}

function jobLocation(job: Job): string {
  const property = job.propertyId ? getPropertyById(job.propertyId) : undefined;
  return property ? formatPropertyAddress(property) : "No property on record";
}

export function BookingsJobsPanel({ model }: PanelProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard title="Bookings" description={`${model.bookings.total} total logged`} action={<OwnerLink href="/bookings">View all in Bookings</OwnerLink>}>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Confirmed" value={model.bookings.confirmed} />
            <StatTile label="Completed" value={model.bookings.completed} />
            <StatTile label="Pending confirmation" value={model.bookings.pending} />
            <StatTile label="Cancelled" value={model.bookings.cancelled} />
          </div>
        </SectionCard>
        <SectionCard title="Jobs" description={`${model.jobs.total} total logged`} action={<OwnerLink href="/jobs">View all in Jobs</OwnerLink>}>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Completed" value={model.jobs.completed} />
            <StatTile label="Scheduled" value={model.jobs.scheduled} />
            <StatTile label="In progress" value={model.jobs.inProgress} />
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <SectionCard title="Recent booking records" description="The latest bookings on the calendar" className="xl:col-span-3">
          <Table aria-label="Recent booking records">
            <TableHead>
              <tr>
                <TableHeaderCell>Ref #</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Service</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {model.recentBookings.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell className="font-semibold whitespace-nowrap">
                    <Link href={bookingHref(booking)} className="text-primary hover:underline">
                      #{booking.id}
                    </Link>
                  </TableCell>
                  <TableCell>{getPartyName(booking)}</TableCell>
                  <TableCell>{getServiceNameFor(booking)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatMonthDay(booking.date)}, {formatTime(booking.start)}
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard title="Recent completed Jobs" description="The latest finished work" className="xl:col-span-2">
          <ul className="space-y-3">
            {model.recentCompletedJobs.map((job) => (
              <li key={job.id} className="flex items-start justify-between gap-3 rounded-card bg-surface-low p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    <Link href={jobHref(job.id)} className="text-primary hover:underline">
                      #{job.id}
                    </Link>{" "}
                    · {getServiceNameFor(job)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {getPartyName(job)} — {jobLocation(job)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <JobStatusBadge status={job.status} />
                  <p className="mt-1 text-xs text-ink-muted">{formatMonthDay(dateOf(job.completion?.at ?? job.date))}</p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}

/* ───────────────────────── Financial Records ───────────────────────── */

export function FinancialPanel({ model, financial }: PanelProps & { financial: FinancialData }) {
  const { quotes, invoices, payments } = model;
  return (
    <div className="space-y-6">
      <SectionCard title="Quotes" description="Estimates and proposed HVAC system servicing" action={<OwnerLink href="/quotes-invoices">View all in Quotes & Invoices</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Total quoted value" value={formatUSD(quotes.totalValue)} hint={`${quotes.count} quotes in total estimates`} />
          <StatTile label="Approved quote value" value={formatUSD(quotes.approvedValue)} hint={`${quotes.counts.approved} approved`} tone="positive" />
        </div>
        <h3 className="mt-5 mb-2 text-mini font-bold tracking-wider text-ink-muted uppercase">Quote status breakdown</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Approved" value={quotes.counts.approved} />
          <StatTile label="Sent" value={quotes.counts.sent} />
          <StatTile label="Draft" value={quotes.counts.draft} />
          <StatTile label="Declined" value={quotes.counts.declined} />
          <StatTile label="Expired" value={quotes.counts.expired} />
        </div>
      </SectionCard>

      <SectionCard title="Invoices" description="Completed work and recurring maintenance charges" action={<OwnerLink href="/payments">View outstanding invoices in Payments</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Total invoiced" value={formatUSD(invoices.total)} hint={`${invoices.count} invoices billed to customers`} />
          <StatTile label="Outstanding balance" value={formatUSD(invoices.outstanding)} hint="Due across unpaid and partially paid invoices" tone="warning" />
        </div>
        <h3 className="mt-5 mb-2 text-mini font-bold tracking-wider text-ink-muted uppercase">Invoice status counts</h3>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Paid" value={invoices.counts.paid} />
          <StatTile label="Unpaid" value={invoices.counts.unpaid} />
          <StatTile label="Partially paid" value={invoices.counts["partially-paid"]} />
        </div>
      </SectionCard>

      <SectionCard title="Payments" description="Payments recorded against invoices" action={<OwnerLink href="/payments">View all in Payments</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Payments recorded" value={payments.recorded} hint="Recorded entries" />
          <StatTile label="Amount received" value={formatUSD(payments.received)} hint="Recorded, non-voided" tone="positive" />
          <StatTile
            label="Voided payments"
            value={payments.voided.length}
            hint={
              payments.voided.length > 0
                ? `${payments.voided.map((payment) => `#${payment.id} for ${formatUSD(payment.amount, 2)}`).join(", ")} — excluded from received totals`
                : "Excluded from received totals"
            }
          />
        </div>
        <h3 className="mt-5 mb-2 text-mini font-bold tracking-wider text-ink-muted uppercase">Recent payments</h3>
        <ul className="space-y-2">
          {payments.recent.map((payment) => {
            const invoice = getInvoiceById(payment.invoiceId, financial);
            return (
              <li key={payment.id} className="flex items-center justify-between gap-3 rounded-card bg-surface-low px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <Link href={paymentHref(payment.id)} className="text-primary hover:underline">
                      #{payment.id}
                    </Link>
                    <PaymentStatusBadge status={payment.status} />
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {invoice ? getPartyName(invoice) : "Unknown customer"} · {PAYMENT_METHOD_LABEL[payment.method]}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-ink">{formatUSD(payment.amount, 2)}</p>
                  <p className="text-xs text-ink-muted">{formatMonthDay(payment.date)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </div>
  );
}

/* ───────────────────────── Maintenance Plans & Services ───────────────────────── */

export function PlansPanel({ model }: PanelProps) {
  const { plans } = model;
  return (
    <div className="space-y-6">
      <SectionCard
        title="Maintenance Plans"
        description="Agreement volume and the seasonal visits still to schedule"
        action={<OwnerLink href="/maintenance-plans">Manage plans in Maintenance Plans</OwnerLink>}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Active plans" value={plans.active} hint="Recurring care" />
          <StatTile label="Visits due" value={plans.visitsDue} hint="Included visits to schedule" />
          <StatTile label="Upcoming renewals" value={plans.renewals} hint="Next 30 days" />
          <StatTile label="Paused or ended" value={plans.pausedOrEnded} hint="Not active" />
        </div>
      </SectionCard>

      <SectionCard
        title="Service activity"
        description="Bookings and completed Jobs by Service"
        icon={Wrench}
        action={<OwnerLink href="/services">Review catalog in Services</OwnerLink>}
      >
        <ServiceActivityTable services={model.services} />
      </SectionCard>
    </div>
  );
}
