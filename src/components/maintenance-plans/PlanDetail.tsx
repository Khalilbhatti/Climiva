"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, ClipboardList, History, SearchX } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { BookingStatusBadge } from "@/components/operations/StatusBadges";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { customerHref, customerPropertiesHref, jobHref } from "@/config/routes";
import { getCustomerById } from "@/data/customers";
import {
  COVERAGE,
  PLAN_CADENCE_LABEL,
  VISIT_STATE_LABEL,
  formatPlanPrice,
  getCompletedVisitCount,
  getNextVisit,
  getPlanById,
  getVisitBooking,
  getVisitState,
  type MaintenancePlan,
  type PlanVisit,
} from "@/data/maintenance-plans";
import { getAssigneeName } from "@/data/operations";
import { formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { formatDate, formatMonthYear, toTelHref } from "@/lib/format";
import { useMaintenancePlans } from "./MaintenancePlansProvider";
import { ScheduleVisitModal } from "./ScheduleVisitModal";
import { PlanCustomerName, PlanStatusBadge, planCustomerName, planProperty, visitTitle } from "./plan-ui";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

export function PlanDetail({ planId }: { planId: string }) {
  const { data } = useMaintenancePlans();
  const plan = getPlanById(planId, data);

  if (!plan) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Plan not found"
        description="This plan isn't in the list. Plans created in this session are cleared when the page reloads."
        action={<ButtonLink href="/maintenance-plans">Back to Maintenance Plans</ButtonLink>}
      />
    );
  }
  return <PlanPage plan={plan} />;
}

function PlanPage({ plan }: { plan: MaintenancePlan }) {
  const dir = useDirectory();
  const { data: ops } = useOperations();
  const [scheduling, setScheduling] = useState<PlanVisit | null>(null);

  const customer = plan.customerId ? getCustomerById(plan.customerId, dir) : undefined;
  const property = planProperty(plan, dir);
  const name = planCustomerName(plan, dir);
  const next = getNextVisit(plan, ops);
  const completed = getCompletedVisitCount(plan, ops);
  const percent = plan.visitsPerYear > 0 ? Math.round((completed / plan.visitsPerYear) * 100) : 0;
  const canSchedule = plan.status === "active" && next && !getVisitBooking(next, ops);

  // The plan's story, read from the records it points at.
  const activity = [
    ...plan.visits.flatMap((visit) => {
      const booking = getVisitBooking(visit, ops);
      return [
        ...(booking?.status === "completed" || visit.completedOn
          ? [{ on: visit.completedOn ?? booking!.date, text: `${visit.label} visit completed${booking?.jobId ? ` (Job #${booking.jobId})` : ""}` }]
          : []),
        ...(booking?.receivedAt
          ? [{ on: booking.receivedAt.slice(0, 10), text: `Booking #${booking.id} scheduled for ${visit.label.toLowerCase()}` }]
          : []),
      ];
    }),
    ...(plan.startDate ? [{ on: plan.startDate, text: `Plan created and activated for ${name}` }] : []),
  ].sort((a, b) => b.on.localeCompare(a.on));

  return (
    <>
      <BackLink href="/maintenance-plans">Back to Maintenance Plans</BackLink>

      <header className={cardClasses("lg", "flex flex-col justify-between gap-4 lg:flex-row lg:items-start")}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{plan.name}</h1>
            <PlanStatusBadge status={plan.status} />
            <span className="rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-ink-muted">
              {plan.cadence === "year" ? "Annual plan" : `${PLAN_CADENCE_LABEL[plan.cadence]} plan`}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <PlanCustomerName plan={plan} /> · {property.street}
            {property.cityLine && `, ${property.cityLine}`}
          </p>
          {plan.statusNote && <p className="mt-1 text-sm text-ink-muted">{plan.statusNote}</p>}
        </div>
        {canSchedule && (
          <Button onClick={() => setScheduling(next)}>
            <CalendarPlus aria-hidden className="size-4" />
            Schedule visit
          </Button>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-card border border-line bg-surface p-5 shadow-card md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Customer", value: <PlanCustomerName plan={plan} />, sub: customer ? "Residential account" : "No customer record yet" },
          { label: "Service property", value: property.street, sub: property.cityLine },
          { label: "Plan price", value: formatPlanPrice(plan), sub: "Service agreement" },
          { label: "Service frequency", value: `${plan.visitsPerYear} visits / yr`, sub: plan.visitsPerYear === 2 ? "Biannual tune-ups" : undefined },
          { label: "Start date", value: plan.startDate ? formatDate(plan.startDate) : "—", sub: plan.startDate ? "Original activation" : undefined },
          { label: "Renewal / end", value: plan.endDate ? formatDate(plan.endDate) : "Open-ended", sub: plan.endDate ? "Annual term window" : undefined },
        ].map((fact) => (
          <div key={fact.label}>
            <dt className="text-micro font-bold tracking-wider text-ink-muted uppercase">{fact.label}</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{fact.value}</dd>
            {fact.sub && <p className="text-xs text-ink-muted">{fact.sub}</p>}
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <SectionCard title="Upcoming included service" icon={CalendarPlus}>
            {next ? <UpcomingVisit plan={plan} visit={next} onSchedule={canSchedule ? () => setScheduling(next) : undefined} /> : (
              <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">All included visits for this term are completed.</p>
            )}
          </SectionCard>

          <SectionCard title="Plan coverage" description="Services and maintenance visits included in this agreement.">
            {plan.coverage.length === 0 ? (
              <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">
                {plan.visitsPerYear} included seasonal maintenance visits per year.
              </p>
            ) : (
              <ul className="space-y-3">
                {plan.coverage.map((item) => {
                  const definition = COVERAGE[item.coverageId];
                  const visits = plan.visits.filter((visit) => visit.coverageId === item.coverageId);
                  const fulfilled = visits.every((visit) => getVisitState(visit, ops) === "completed");
                  const visit = visits.find((candidate) => getVisitState(candidate, ops) !== "completed") ?? visits[0];
                  const booking = visit ? getVisitBooking(visit, ops) : undefined;
                  return (
                    <li key={item.coverageId} className="rounded-card bg-surface-low p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-ink">{definition.name}</h3>
                        <span className="text-xs font-semibold text-ink-muted">
                          {item.visits} visit{item.visits === 1 ? "" : "s"} included{fulfilled ? " (Fulfilled)" : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-muted">{definition.detail}</p>
                      <p className="mt-1 text-xs font-medium text-ink">
                        {fulfilled
                          ? visit?.completedOn
                            ? `Completed on ${formatDate(visit.completedOn)}`
                            : "Completed"
                          : booking
                            ? `Scheduled ${formatDate(booking.date)} (Booking #${booking.id})`
                            : visit?.windowStart
                              ? `Scheduled window: ${formatMonthYear(visit.windowStart.slice(0, 7))}`
                              : "Not scheduled yet"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Total: {plan.visitsPerYear} seasonal maintenance visits per year · Resets when the term renews
            </p>
          </SectionCard>

          <SectionCard title="Current service period" description="Active agreement schedule cycle">
            <p className="text-sm font-semibold text-ink">
              {plan.startDate ? `${formatDate(plan.startDate)} – ` : "Until "}
              {plan.endDate ? formatDate(plan.endDate) : "open-ended"}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Progress: {completed} of {plan.visitsPerYear} included visits completed
            </p>
            <div
              role="progressbar"
              aria-label="Included visits completed"
              aria-valuemin={0}
              aria-valuemax={plan.visitsPerYear}
              aria-valuenow={completed}
              className="mt-2 h-2 overflow-hidden rounded-full bg-line"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-ink-muted">
              <span>{percent}% completed</span>
              <span>
                {completed} Completed visit{completed === 1 ? "" : "s"}
              </span>
              <span>
                {plan.visitsPerYear - completed} Remaining visit{plan.visitsPerYear - completed === 1 ? "" : "s"}
              </span>
            </p>
          </SectionCard>

          <SectionCard title="Plan service history" icon={ClipboardList} description="Completed and scheduled visits under this plan.">
            <Table aria-label="Plan service history">
              <TableHead>
                <tr>
                  <TableHeaderCell>Service</TableHeaderCell>
                  <TableHeaderCell>Scheduled date</TableHeaderCell>
                  <TableHeaderCell>Booking</TableHeaderCell>
                  <TableHeaderCell>Job</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {plan.visits.filter((visit) => getVisitState(visit, ops) !== "needs-scheduling" && getVisitState(visit, ops) !== "not-scheduled").length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">
                      No visits have been scheduled or completed yet.
                    </td>
                  </tr>
                ) : (
                  plan.visits
                    .filter((visit) => ["completed", "scheduled"].includes(getVisitState(visit, ops)))
                    .map((visit) => {
                      const booking = getVisitBooking(visit, ops);
                      const state = getVisitState(visit, ops);
                      return (
                        <TableRow key={visit.id}>
                          <TableCell className="font-medium">{visit.label}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {booking ? formatDate(booking.date) : visit.completedOn ? formatDate(visit.completedOn) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {booking ? (
                              <Link href={`/bookings?tab=${booking.status === "completed" ? "past" : "upcoming"}&booking=${booking.id}`} className="text-primary hover:underline">
                                #{booking.id}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {booking?.jobId ? (
                              <Link href={jobHref(booking.jobId)} className="text-primary hover:underline">
                                #{booking.jobId}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={state === "completed" ? "neutral" : "positive"}>{VISIT_STATE_LABEL[state]}</StatusBadge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                )}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-ink-muted">Completed plan visits stay linked to their Booking and Job records.</p>
          </SectionCard>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <SectionCard title="Customer & property">
            <p className="text-sm font-semibold text-ink">{name}</p>
            {customer ? (
              <>
                <p className="text-xs text-ink-muted">
                  <a href={toTelHref(customer.phone)} className="hover:underline">
                    {customer.phone}
                  </a>
                </p>
                <Link href={customerHref(customer.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  View customer
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </>
            ) : (
              <p className="text-xs text-ink-muted">No customer record yet.</p>
            )}
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-sm font-semibold text-ink">{property.label ? `${property.label} property` : "Service property"}</p>
              <p className="text-sm text-ink">{property.street}</p>
              <p className="text-xs text-ink-muted">{property.cityLine}</p>
              {customer && (
                <Link href={customerPropertiesHref(customer.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  View property
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Plan details">
            <KeyValueList
              items={[
                { label: "Plan name", value: plan.name },
                { label: "Status", value: <PlanStatusBadge status={plan.status} /> },
                { label: "Price", value: formatPlanPrice(plan) },
                { label: "Frequency", value: `${plan.visitsPerYear} visits / year` },
                { label: "Start date", value: plan.startDate ? formatDate(plan.startDate) : "—" },
                { label: "Renewal / end", value: plan.endDate ? formatDate(plan.endDate) : "Open-ended" },
                { label: "Internal note", value: plan.note ?? "No internal notes added." },
              ]}
            />
          </SectionCard>

          <SectionCard title="Customer financials">
            <p className="text-sm text-ink-muted">
              Invoices and Payments for this customer are managed separately. Maintenance Plans define service coverage only.
            </p>
          </SectionCard>

          <SectionCard title="Plan activity" icon={History}>
            <ol className="space-y-3">
              {activity.map((entry) => (
                <li key={`${entry.on}-${entry.text}`}>
                  <p className="text-xs font-semibold text-ink-muted">{formatDate(entry.on)}</p>
                  <p className="text-sm text-ink">{entry.text}</p>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      {scheduling && <ScheduleVisitModal plan={plan} visit={scheduling} onClose={() => setScheduling(null)} />}
    </>
  );
}

function UpcomingVisit({ plan, visit, onSchedule }: { plan: MaintenancePlan; visit: PlanVisit; onSchedule?: () => void }) {
  const dir = useDirectory();
  const { data: ops } = useOperations();
  const booking = getVisitBooking(visit, ops);
  const state = getVisitState(visit, ops);
  const definition = visit.coverageId ? COVERAGE[visit.coverageId] : undefined;

  return (
    <div className="rounded-card bg-surface-low p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        {visitTitle(plan, visit)}
        <StatusBadge tone={booking ? "positive" : "warning"}>{VISIT_STATE_LABEL[state]}</StatusBadge>
      </p>
      <p className="mt-1 text-base font-semibold text-primary">{visit.label}</p>
      {definition && <p className="text-sm text-ink-muted">Included seasonal {visit.coverageId} maintenance visit.</p>}
      {booking ? (
        <div className="mt-3 rounded-btn bg-surface p-3 text-sm text-ink">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Booking #{booking.id} <BookingStatusBadge status={booking.status} />
          </p>
          <p className="mt-1">
            {formatWeekdayDate(booking.date)}, {formatDate(booking.date)} · {formatTimeRange(booking.start, booking.end)}
          </p>
          <p className="text-xs text-ink-muted">Technician: {getAssigneeName(booking, dir) ?? "Unassigned"}</p>
          <Link
            href={`/bookings?tab=upcoming&booking=${booking.id}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            View booking
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            Target service window: {visit.windowStart ? `Due ${formatMonthYear(visit.windowStart.slice(0, 7))}` : "Available now"}
            <br />
            Schedule this included maintenance visit as a Booking.
          </p>
          {onSchedule && (
            <Button size="sm" onClick={onSchedule}>
              <CalendarPlus aria-hidden className="size-4" />
              Schedule visit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
