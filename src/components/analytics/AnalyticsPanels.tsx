"use client";

import Link from "next/link";
import { Banknote, CalendarCheck, CircleCheck, ReceiptText } from "lucide-react";
import { BookingStatusBadge, JobStatusBadge } from "@/components/operations/StatusBadges";
import { PaymentStatusBadge } from "@/components/financials/StatusBadges";
import { useMarketplace } from "@/components/marketplace/MarketplaceProvider";
import { useOperations } from "@/components/operations/OperationsProvider";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { jobHref, paymentHref } from "@/config/routes";
import { getPropertyById, formatPropertyAddress } from "@/data/customers";
import { PAYMENT_METHOD_LABEL, getInvoiceById, type FinancialData } from "@/data/financials";
import { BOOKING_TABS, getPartyName, getServiceNameFor, type Booking, type BookingSource, type Job } from "@/data/operations";
import type { AnalyticsReport } from "@/lib/analytics-rules";
import type { RecentRecords, SourceCounts } from "@/lib/analytics-state";
import { formatMonthDay, formatTime } from "@/lib/dates";
import { paymentReference } from "@/lib/financial-rules";
import { formatUSD } from "@/lib/format";
import { fromCents } from "@/lib/money";
import { OwnerLink, ServiceActivityTable, StatTile, WeeklyChart } from "./parts";
import type { Directory } from "@/data/directory";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

type PanelProps = { report: AnalyticsReport };

const dateOf = (timestamp: string) => timestamp.slice(0, 10);
const usd = (cents: number, fractionDigits = 0) => formatUSD(fromCents(cents), fractionDigits);

/** The five headline totals of the selected range. */
export function KpiRow({ kpis }: { kpis: AnalyticsReport["kpis"] }) {
  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
      <KpiCard label="Bookings" value={kpis.bookings} icon={CalendarCheck} hint="Bookings created" href="/bookings" />
      <KpiCard label="Jobs completed" value={kpis.completedJobs} icon={CircleCheck} hint="Completed Jobs" href="/jobs" />
      <KpiCard label="Quote value" value={usd(kpis.quoteValueCents)} icon={ReceiptText} hint="Quotes created" href="/quotes-invoices" />
      <KpiCard label="Invoiced" value={usd(kpis.invoicedCents)} icon={ReceiptText} hint="Invoice total" href="/quotes-invoices" />
      <KpiCard label="Payments received" value={usd(kpis.paymentsReceivedCents)} icon={Banknote} tone="positive" hint="Recorded non-voided Payments" href="/payments" />
    </section>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

export function OverviewPanel({ report }: PanelProps) {
  return (
    <div className="space-y-6">
      <KpiRow kpis={report.kpis} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <SectionCard title="Operational activity" description="Weekly volume of Bookings and completed Jobs" className="xl:col-span-3">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-btn bg-surface-low px-4 py-2.5 text-sm">
            <span className="text-ink-muted">Selected period summary</span>
            <span className="font-semibold text-ink">
              {report.bookings.total} Bookings · {report.jobs.completed} Completed Jobs
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
          <WeeklyChart weekly={report.weekly} />
        </SectionCard>

        <SectionCard title="Service activity" description="Bookings and completed Jobs by Service" className="xl:col-span-2">
          <ServiceActivityTable services={report.services} />
        </SectionCard>
      </div>

      <SectionCard title="Financial record totals" description="These totals are separate record types for the selected period.">
        <ul className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Quotes created", detail: `${report.quotes.count} quotes`, value: report.kpis.quoteValueCents },
            { label: "Invoices created", detail: `${report.invoices.count} invoices`, value: report.invoices.totalCents },
            { label: "Payments recorded", detail: `${report.payments.recorded} payments`, value: report.payments.receivedCents },
          ].map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 rounded-card bg-surface-low px-4 py-3">
              <span>
                <span className="block text-sm font-semibold text-ink">{row.label}</span>
                <span className="block text-xs text-ink-muted">{row.detail}</span>
              </span>
              <span className="text-lg font-bold text-primary">{usd(row.value)}</span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

/* ───────────────────────── Bookings ───────────────────────── */

function bookingHref(booking: Booking) {
  const tab = BOOKING_TABS.find((item) => item.status === booking.status)?.id ?? "requests";
  return `/bookings?tab=${tab}&booking=${booking.id}` as const;
}

function jobLocation(job: Job, dir: Directory): string {
  const property = job.propertyId ? getPropertyById(job.propertyId, dir) : undefined;
  return property ? formatPropertyAddress(property) : "No property on record";
}

/** Where the booking records of the range came from, as bars. Counted from the records, and says so. */
function SourceBars({ sources, imported }: { sources: SourceCounts; imported: boolean }) {
  if (sources.recorded === 0) {
    return (
      <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
        {sources.records === 0 ? "No booking records fall in these dates." : "None of the booking records in these dates say where they came from."}
      </p>
    );
  }
  const peak = Math.max(...sources.bySource.map((entry) => entry.count));
  return (
    <div className="space-y-3">
      <ul aria-label="Bookings by source" className="space-y-2.5">
        {sources.bySource.map((entry) => (
          <li key={entry.source} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
            <span className={entry.source === "Marketplace" ? "font-semibold text-ink" : "text-ink"}>{entry.source}</span>
            <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-surface-low">
              <span className={`block h-full rounded-full ${entry.source === "Marketplace" ? "bg-primary" : "bg-ink-muted"}`} style={{ width: `${(entry.count / peak) * 100}%` }} />
            </span>
            <span className="font-semibold text-ink tabular-nums">{entry.count}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">
        {sources.recorded} of the {sources.records} {sources.records === 1 ? "booking" : "bookings"} made in Climvia in these dates say where {sources.recorded === 1 ? "it" : "they"} came from.
        {imported ? " Bookings imported from your earlier history have no source, so they are not counted here." : ""}
      </p>
    </div>
  );
}

export function BookingsPanel({ report, recent, sources }: PanelProps & { recent: RecentRecords; sources: SourceCounts }) {
  const dir = useDirectory();
  return (
    <div className="space-y-6">
      <SectionCard
        title="How many bookings are we getting?"
        description={`${report.bookings.total} in this period, week by week`}
        action={<OwnerLink href="/bookings">View all in Bookings</OwnerLink>}
      >
        <WeeklyChart weekly={report.weekly} series="bookings" />
      </SectionCard>

      <SectionCard title="What state are they in?" description="Every booking in this period, by where it stands">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Confirmed" value={report.bookings.confirmed} />
          <StatTile label="Completed" value={report.bookings.completed} />
          <StatTile label="Pending confirmation" value={report.bookings.pending} hint="Waiting for your answer" />
          <StatTile label="Cancelled" value={report.bookings.cancelled} />
        </div>
      </SectionCard>

      <SectionCard title="Where are they coming from?" description="Your website, the Marketplace, and bookings your team entered" action={<OwnerLink href="/bookings">See each in Bookings</OwnerLink>}>
        <SourceBars sources={sources} imported={report.imported.included} />
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
        <SectionCard title="Which Services do people book?" description="Bookings and completed Jobs by Service" action={<OwnerLink href="/services">Review catalog in Services</OwnerLink>} className="2xl:col-span-2">
          <ServiceActivityTable services={report.services} />
        </SectionCard>

        <SectionCard title="Recent booking records" description="The latest bookings on the calendar" className="2xl:col-span-3">
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
              {recent.bookings.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell className="font-semibold whitespace-nowrap">
                    <Link href={bookingHref(booking)} className="text-primary hover:underline">
                      #{booking.id}
                    </Link>
                  </TableCell>
                  <TableCell>{getPartyName(booking, dir)}</TableCell>
                  <TableCell>{getServiceNameFor(booking, dir)}</TableCell>
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
      </div>
    </div>
  );
}

/* ───────────────────────── Jobs ───────────────────────── */

export function JobsPanel({ report, recent }: PanelProps & { recent: RecentRecords }) {
  const dir = useDirectory();
  return (
    <div className="space-y-6">
      <SectionCard
        title="How much work is being completed?"
        description={`${report.jobs.completed} Jobs completed in this period, week by week`}
        action={<OwnerLink href="/jobs">View all in Jobs</OwnerLink>}
      >
        <WeeklyChart weekly={report.weekly} series="jobs" />
      </SectionCard>

      <SectionCard title="What is still scheduled or in progress?" description={`${report.jobs.total} Jobs in this period in all`}>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Completed" value={report.jobs.completed} />
          <StatTile label="Scheduled" value={report.jobs.scheduled} hint="Not started yet" />
          <StatTile label="In progress" value={report.jobs.inProgress} hint="Being worked on" />
        </div>
      </SectionCard>

      <SectionCard title="Recent completed Jobs" description="The latest finished work">
        {recent.completedJobs.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No Job was completed in these dates.</p>
        ) : (
          <ul className="space-y-3">
            {recent.completedJobs.map((job) => (
              <li key={job.id} className="flex items-start justify-between gap-3 rounded-card bg-surface-low p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    <Link href={jobHref(job.id)} className="text-primary hover:underline">
                      #{job.id}
                    </Link>{" "}
                    · {getServiceNameFor(job, dir)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {getPartyName(job, dir)} — {jobLocation(job, dir)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <JobStatusBadge status={job.status} />
                  <p className="mt-1 text-xs text-ink-muted">{formatMonthDay(dateOf(job.completion?.at ?? job.date))}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/* ───────────────────────── Revenue ───────────────────────── */

export function RevenuePanel({ report, recent, financial }: PanelProps & { recent: RecentRecords; financial: FinancialData }) {
  const dir = useDirectory();
  const { quotes, invoices, payments } = report;
  return (
    <div className="space-y-6">
      <SectionCard title="What have we invoiced?" description="Invoices created in this period" action={<OwnerLink href="/quotes-invoices?tab=invoices">View all in Quotes & Invoices</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Total invoiced" value={usd(invoices.totalCents)} hint={`${invoices.count} invoices billed to customers`} />
          <StatTile label="Invoices created" value={invoices.count} hint="Completed work and recurring maintenance charges" />
        </div>
        <h3 className="mt-5 mb-2 text-mini font-bold tracking-wider text-ink-muted uppercase">Invoice status counts</h3>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Paid" value={invoices.counts.paid} />
          <StatTile label="Unpaid" value={invoices.counts.unpaid} />
          <StatTile label="Partially paid" value={invoices.counts["partially-paid"]} />
        </div>
      </SectionCard>

      <SectionCard title="What has been paid?" description="Payments recorded against invoices" action={<OwnerLink href="/payments">View all in Payments</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Payments recorded" value={payments.recorded} hint="Recorded entries" />
          <StatTile label="Amount received" value={usd(payments.receivedCents)} hint="Recorded, non-voided" tone="positive" />
          <StatTile
            label="Voided payments"
            value={payments.voided.length}
            hint={
              payments.voided.length > 0
                ? `${payments.voided.map((payment) => `#${paymentReference(payment.number)} for ${usd(payment.amountCents, 2)}`).join(", ")} — excluded from received totals`
                : "Excluded from received totals"
            }
          />
        </div>
        <h3 className="mt-5 mb-2 text-mini font-bold tracking-wider text-ink-muted uppercase">Recent payments</h3>
        {recent.payments.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No payment was recorded in these dates.</p>
        ) : (
          <ul className="space-y-2">
            {recent.payments.map((payment) => {
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
                      {invoice ? getPartyName(invoice, dir) : "Unknown customer"} · {PAYMENT_METHOD_LABEL[payment.method]}
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
        )}
      </SectionCard>

      <SectionCard title="What is still outstanding?" description="Money customers still owe on these invoices" action={<OwnerLink href="/payments?tab=outstanding">View outstanding invoices in Payments</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Outstanding balance" value={usd(invoices.outstandingCents)} hint="Due across unpaid and partially paid invoices" tone="warning" />
          <StatTile label="Unpaid invoices" value={invoices.counts.unpaid} />
          <StatTile label="Partially paid invoices" value={invoices.counts["partially-paid"]} />
        </div>
      </SectionCard>

      <SectionCard title="What have we quoted?" description="Estimates and proposed HVAC system servicing" action={<OwnerLink href="/quotes-invoices">View all in Quotes & Invoices</OwnerLink>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Total quoted value" value={usd(quotes.totalValueCents)} hint={`${quotes.count} quotes in total estimates`} />
          <StatTile label="Approved quote value" value={usd(quotes.approvedValueCents)} hint={`${quotes.counts.approved} approved`} tone="positive" />
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
    </div>
  );
}

/* ───────────────────────── Marketplace ───────────────────────── */

/** The Marketplace's own bookings, set beside the other ways people book. Counted from the booking records; no rate, trend or estimate is made up. */
export function MarketplacePanel({ report, sources }: PanelProps & { sources: SourceCounts }) {
  const dir = useDirectory();
  const { listing } = useMarketplace();
  const { data } = useOperations();
  const count = (...names: BookingSource[]) => sources.bySource.filter((entry) => names.includes(entry.source)).reduce((total, entry) => total + entry.count, 0);
  const marketplace = count("Marketplace");
  const own = count("Website", "Booking link");
  const byHand = count("Phone / Front desk", "Email", "Walk-in", "Other");
  const plans = count("Maintenance plan");
  const rows = [
    { label: "Marketplace", value: marketplace, emphasis: true },
    { label: "Your website and booking link", value: own, emphasis: false },
    { label: "Entered by your team (phone, email, walk-in, other)", value: byHand, emphasis: false },
    { label: "Maintenance plan visits", value: plans, emphasis: false },
  ].filter((row) => row.value > 0 || row.emphasis);
  const peak = Math.max(1, ...rows.map((row) => row.value));
  const here = data.bookings
    .filter((booking) => booking.source === "Marketplace" && booking.date >= report.range.from && booking.date <= report.range.to)
    .sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`))
    .slice(0, 5);
  const pending = here.length > 0 ? data.bookings.filter((booking) => booking.source === "Marketplace" && booking.status === "pending" && booking.date >= report.range.from && booking.date <= report.range.to).length : 0;
  const listed = listing.status === "published" && !listing.suspended;

  return (
    <div className="space-y-6">
      <SectionCard
        title="How many bookings came from the Marketplace?"
        description="Bookings made on your Marketplace profile in this period"
        action={<OwnerLink href="/marketplace-listing">Open Marketplace Listing</OwnerLink>}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Marketplace bookings" value={marketplace} hint="Made in these dates" />
          <StatTile label="Waiting for your answer" value={pending} hint="Requests you have not answered" tone={pending > 0 ? "warning" : "default"} />
          <StatTile label="Listing" value={listing.suspended ? "Suspended" : listing.status === "published" ? "Published" : listing.status === "hidden" ? "Hidden" : "Not set up"} hint={listed ? "Homeowners can find you" : "Homeowners cannot find you yet"} />
        </div>
        {!listed && (
          <p className="mt-4 rounded-card bg-surface-low p-4 text-sm text-ink-muted">
            {listing.suspended
              ? "Climvia has suspended your Marketplace Listing, so nothing new can come from it until it is allowed again."
              : "Publish your Marketplace Listing and homeowners searching for HVAC help can book you here."}{" "}
            <Link href="/marketplace-listing" className="font-semibold text-primary hover:underline">
              Open Marketplace Listing
            </Link>
          </p>
        )}
      </SectionCard>

      <SectionCard title="How does the Marketplace compare with other ways people book?" description="Bookings made in Climvia in these dates, by how they were booked">
        {sources.recorded === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No booking record in these dates says where it came from, so there is nothing to compare yet.</p>
        ) : (
          <div className="space-y-3">
            <ul aria-label="Marketplace compared with other sources" className="space-y-2.5">
              {rows.map((row) => (
                <li key={row.label} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className={row.emphasis ? "font-semibold text-ink" : "text-ink"}>{row.label}</span>
                  <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-surface-low">
                    <span className={`block h-full rounded-full ${row.emphasis ? "bg-primary" : "bg-ink-muted"}`} style={{ width: `${(row.value / peak) * 100}%` }} />
                  </span>
                  <span className="font-semibold text-ink tabular-nums">{row.value}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              Counted from the {sources.recorded} {sources.recorded === 1 ? "booking" : "bookings"} made in Climvia that say where they came from.
              {report.imported.included ? " Bookings imported from your earlier history have no source, so they are not counted here." : ""}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Latest Marketplace bookings" description="The most recent in these dates">
        {here.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No booking came from the Marketplace in these dates.</p>
        ) : (
          <ul className="space-y-2">
            {here.map((booking) => (
              <li key={booking.id} className="flex items-center justify-between gap-3 rounded-card bg-surface-low px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <Link href={bookingHref(booking)} className="text-primary hover:underline">
                      #{booking.id}
                    </Link>
                    <BookingStatusBadge status={booking.status} />
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {getPartyName(booking, dir)} · {getServiceNameFor(booking, dir)}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-ink-muted">
                  {formatMonthDay(booking.date)}, {formatTime(booking.start)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/* ───────────────────────── Customer retention ───────────────────────── */

/** Maintenance Plans and Reviews: the two things that say whether customers stay and are happy. Both are as of today, not limited to the dates. */
export function RetentionPanel({ report }: PanelProps) {
  const { plans, reviews } = report;
  return (
    <div className="space-y-6">
      <SectionCard
        title="How many customers are on a Maintenance Plan?"
        description="Agreement volume and the seasonal visits still to schedule, as of today"
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
        title="What do customers say about our work?"
        description="Reviews and review requests, as of today"
        action={<OwnerLink href="/reviews">Read them in Reviews</OwnerLink>}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Total reviews" value={reviews.total} />
          <StatTile label="Average rating" value={reviews.total > 0 ? reviews.average.toFixed(1) : "—"} hint={reviews.total > 0 ? "Out of 5 stars" : "No reviews yet"} />
          <StatTile label="Awaiting reply" value={reviews.awaiting} hint="Reviews without a response" tone={reviews.awaiting > 0 ? "warning" : "default"} />
          <StatTile label="Review requests" value={reviews.requests} hint="Customers you have asked" />
        </div>
      </SectionCard>
    </div>
  );
}
