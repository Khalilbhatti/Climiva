"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, Info, PauseCircle, Plus, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useReporting } from "@/components/reporting/ReportingProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import {
  PLAN_STATUS_LABEL,
  VISIT_STATE_LABEL,
  formatPlanPrice,
  getCompletedVisitCount,
  getNextVisit,
  getPlanMetrics,
  getUpcomingVisits,
  getVisitBooking,
  getVisitState,
  isRenewingSoon,
  type MaintenancePlan,
  type PlanMetrics,
  type PlanStatus,
  type PlansData,
  type PlanVisit,
  type VisitState,
} from "@/data/maintenance-plans";
import { formatDate } from "@/lib/format";
import { formatTime } from "@/lib/dates";
import { CreatePlanModal } from "./CreatePlanModal";
import { useMaintenancePlans } from "./MaintenancePlansProvider";
import { ScheduleVisitModal } from "./ScheduleVisitModal";
import { PlanCustomerName, PlanStatusBadge, dueText, planCustomerName, planProperty, visitTitle } from "./plan-ui";
import { useDirectory } from "@/components/workspace/DirectoryProvider";
import { useCan, useClock } from "@/components/workspace/WorkspaceProvider";

type View = "active" | "upcoming" | "all";
const VIEWS: View[] = ["active", "upcoming", "all"];
const ZERO: PlanMetrics = { active: 0, visitsDue: 0, renewals: 0, paused: 0, ended: 0, pausedOrEnded: 0, all: 0 };

function nextServiceText(plan: MaintenancePlan, visit: PlanVisit | undefined, ops: ReturnType<typeof useOperations>["data"]) {
  if (plan.statusNote) return plan.statusNote;
  if (!visit) return "All visits completed for term";
  const booking = getVisitBooking(visit, ops);
  return booking ? `Scheduled · ${formatDate(booking.date)}` : dueText(visit);
}

export function MaintenancePlansView() {
  const dir = useDirectory();
  const { data: stored } = useMaintenancePlans();
  const { data: ops } = useOperations();
  const { today } = useClock();
  const { adjustments } = useReporting();
  const canManage = useCan("maintenance:manage");
  const router = useRouter();
  const params = useSearchParams();

  const view: View = VIEWS.find((id) => id === params.get("view")) ?? "active";
  const creating = params.get("new") === "1";
  const presetCustomerId = params.get("customer") ?? undefined;
  // "?state=empty" previews the approved empty state without having to delete every plan.
  const previewEmpty = params.get("state") === "empty";

  const [query, setQuery] = useState("");
  const [planName, setPlanName] = useState("all");
  const [status, setStatus] = useState<"all" | PlanStatus>("all");
  const [bookingState, setBookingState] = useState<"all" | VisitState>("all");
  const [scheduling, setScheduling] = useState<{ plan: MaintenancePlan; visit: PlanVisit } | null>(null);

  const data: PlansData = useMemo(() => (previewEmpty ? { plans: [] } : stored), [previewEmpty, stored]);
  // The sample business reports the approved workspace totals its stored plans are a sample of; any other business counts its own.
  const metrics = previewEmpty ? ZERO : getPlanMetrics(data, ops, today, adjustments.plans);

  function setParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace((qs ? `/maintenance-plans?${qs}` : "/maintenance-plans") as Route, { scroll: false });
  }

  const needle = query.trim().toLowerCase();
  const matches = (plan: MaintenancePlan) =>
    `${planCustomerName(plan, dir)} ${plan.name} ${planProperty(plan, dir).street}`.toLowerCase().includes(needle) &&
    (planName === "all" || plan.name === planName);

  const activePlans = data.plans.filter((plan) => plan.status === "active").filter(matches);
  const allPlans = data.plans.filter(matches).filter((plan) => status === "all" || plan.status === status);
  const upcoming = getUpcomingVisits(data, ops).filter(({ plan, visit }) => matches(plan) && (bookingState === "all" || getVisitState(visit, ops) === bookingState));
  const planNames = [...new Set(data.plans.map((plan) => plan.name))].sort();
  const filtering = needle !== "" || planName !== "all" || (view === "all" && status !== "all") || (view === "upcoming" && bookingState !== "all");

  const clear = () => {
    setQuery("");
    setPlanName("all");
    setStatus("all");
    setBookingState("all");
  };

  const rows = (plans: MaintenancePlan[], note: boolean) =>
    plans.length === 0 ? (
      <tr>
        <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
          {filtering ? "No plans match your filters." : "No plans to show."}
        </td>
      </tr>
    ) : (
      plans.map((plan) => {
        const property = planProperty(plan, dir);
        const next = getNextVisit(plan, ops);
        const completed = getCompletedVisitCount(plan, ops);
        return (
          <TableRow key={plan.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar name={planCustomerName(plan, dir)} />
                <span className="font-semibold whitespace-nowrap">
                  <PlanCustomerName plan={plan} />
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="font-medium">{property.street}</div>
              <div className="text-xs text-ink-muted">{property.cityLine}</div>
            </TableCell>
            <TableCell>
              <div className="font-medium">{plan.name}</div>
              <div className="text-xs text-ink-muted">{formatPlanPrice(plan)}</div>
            </TableCell>
            <TableCell>
              <div className="whitespace-nowrap">{plan.visitsPerYear} visits / year</div>
              <div className="text-xs text-ink-muted">
                {completed} of {plan.visitsPerYear} used
              </div>
            </TableCell>
            <TableCell className="max-w-48">
              <div className={note || !plan.statusNote ? "" : "text-ink-muted"}>{nextServiceText(plan, next, ops)}</div>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <div>{plan.endDate ? formatDate(plan.endDate) : "Open-ended"}</div>
              {isRenewingSoon(plan, today) && <StatusBadge tone="warning">Renews soon</StatusBadge>}
            </TableCell>
            <TableCell>
              <PlanStatusBadge status={plan.status} />
            </TableCell>
            <TableCell className="text-right">
              <Link
                href={`/maintenance-plans/${plan.id}`}
                aria-label={`View plan: ${plan.name} for ${planCustomerName(plan, dir)}`}
                className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
              >
                View plan
              </Link>
            </TableCell>
          </TableRow>
        );
      })
    );

  const planHead = (
    <TableHead>
      <tr>
        <TableHeaderCell>Customer</TableHeaderCell>
        <TableHeaderCell>Property</TableHeaderCell>
        <TableHeaderCell>Plan</TableHeaderCell>
        <TableHeaderCell>Included visits</TableHeaderCell>
        <TableHeaderCell>{view === "all" ? "Next service / note" : "Next service"}</TableHeaderCell>
        <TableHeaderCell>Renewal / end</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell>
          <span className="sr-only">Actions</span>
        </TableHeaderCell>
      </tr>
    </TableHead>
  );

  return (
    <>
      <PageHeader
        title="Maintenance Plans"
        description="Manage recurring HVAC service agreements, included visits, and upcoming maintenance."
        actions={
          canManage && (
            <Button size="lg" onClick={() => setParams({ new: "1" })}>
              <Plus aria-hidden className="size-[18px]" />
              Create plan
            </Button>
          )
        }
      />

      <section aria-label="Maintenance plan totals" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active plans" value={metrics.active} icon={ShieldCheck} hint="Currently active agreements" />
        <KpiCard label="Visits due" value={metrics.visitsDue} icon={Wrench} hint="Maintenance visits due soon" />
        <KpiCard label="Upcoming renewals" value={metrics.renewals} icon={RefreshCw} hint="Agreements ending within 60 days" />
        <KpiCard
          label="Paused or ended"
          value={metrics.pausedOrEnded}
          icon={PauseCircle}
          hint={`${metrics.paused} paused · ${metrics.ended} ended`}
        />
      </section>

      {data.plans.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No maintenance plans yet"
          description="Create recurring service agreements for customers who receive scheduled HVAC maintenance."
          action={
            canManage && (
              <Button size="lg" onClick={() => setParams({ new: "1" })}>
                <Plus aria-hidden className="size-[18px]" />
                Create plan
              </Button>
            )
          }
        />
      ) : (
        <Card padding="md" className="space-y-4">
          <Tabs
            label="Maintenance plan views"
            idPrefix="plans"
            value={view}
            onChange={(id) => {
              clear();
              setParams({ view: id === "active" ? null : id });
            }}
            tabs={[
              { id: "active", label: "Active", count: metrics.active },
              { id: "upcoming", label: "Upcoming service", count: metrics.visitsDue },
              { id: "all", label: "All plans", count: metrics.all },
            ]}
          />

          <div className="flex flex-wrap items-end gap-3">
            <SearchInput
              wrapperClassName="min-w-60 flex-1"
              aria-label="Search plans"
              placeholder="Search customer, property or plan..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="w-56">
              <Select label="Plan" hideLabel value={planName} onChange={(event) => setPlanName(event.target.value)}>
                <option value="all">Plan: All</option>
                {planNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </Select>
            </div>
            {view === "all" && (
              <div className="w-52">
                <Select label="Status" hideLabel value={status} onChange={(event) => setStatus(event.target.value as "all" | PlanStatus)}>
                  <option value="all">Status: All statuses</option>
                  {(Object.keys(PLAN_STATUS_LABEL) as PlanStatus[]).map((id) => (
                    <option key={id} value={id}>
                      {PLAN_STATUS_LABEL[id]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {view === "upcoming" && (
              <div className="w-56">
                <Select label="Booking status" hideLabel value={bookingState} onChange={(event) => setBookingState(event.target.value as "all" | VisitState)}>
                  <option value="all">Booking status: All</option>
                  <option value="needs-scheduling">Needs scheduling</option>
                  <option value="not-scheduled">Not scheduled</option>
                  <option value="scheduled">Scheduled</option>
                </Select>
              </div>
            )}
            {filtering && (
              <Button variant="tertiary" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>

          <div role="tabpanel" id={`plans-panel-${view}`} aria-labelledby={`plans-tab-${view}`} className="space-y-3">
            {view === "upcoming" ? (
              <>
                <Table aria-label="Upcoming service">
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Customer</TableHeaderCell>
                      <TableHeaderCell>Property</TableHeaderCell>
                      <TableHeaderCell>Plan</TableHeaderCell>
                      <TableHeaderCell>Service due</TableHeaderCell>
                      <TableHeaderCell>Due period</TableHeaderCell>
                      <TableHeaderCell>Booking</TableHeaderCell>
                      <TableHeaderCell>
                        <span className="sr-only">Action</span>
                      </TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {upcoming.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
                          {filtering ? "No visits match your filters." : "No maintenance visits are due."}
                        </td>
                      </tr>
                    ) : (
                      upcoming.map(({ plan, visit }) => {
                        const property = planProperty(plan, dir);
                        const booking = getVisitBooking(visit, ops);
                        const state = getVisitState(visit, ops);
                        return (
                          <TableRow key={visit.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar name={planCustomerName(plan, dir)} />
                                <span className="font-semibold whitespace-nowrap">
                                  <PlanCustomerName plan={plan} />
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{property.street}</div>
                              <div className="text-xs text-ink-muted">{property.cityLine}</div>
                            </TableCell>
                            <TableCell className="font-medium">{plan.name}</TableCell>
                            <TableCell>
                              <div className="font-medium">{visit.label}</div>
                              <div className="text-xs text-ink-muted">{visitTitle(plan, visit)} included</div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{dueText(visit)}</TableCell>
                            <TableCell>
                              {booking ? (
                                <>
                                  <div className="font-medium text-ink">Booking #{booking.id}</div>
                                  <div className="text-xs text-ink-muted">
                                    {formatDate(booking.date)} at {formatTime(booking.start)}
                                  </div>
                                </>
                              ) : (
                                <StatusBadge tone="warning">{VISIT_STATE_LABEL[state]}</StatusBadge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {booking ? (
                                <Link
                                  href={`/bookings?tab=upcoming&booking=${booking.id}`}
                                  aria-label={`View booking ${booking.id}`}
                                  className="rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary-subtle"
                                >
                                  View booking
                                </Link>
                              ) : (
                                canManage && (
                                  <button
                                    type="button"
                                    onClick={() => setScheduling({ plan, visit })}
                                    aria-label={`Schedule visit for ${planCustomerName(plan, dir)}`}
                                    className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary-subtle"
                                  >
                                    <CalendarPlus aria-hidden className="size-4" />
                                    Schedule visit
                                  </button>
                                )
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                <p aria-live="polite" className="text-xs text-ink-muted">
                  Showing {upcoming.length} of {metrics.visitsDue} visits due
                </p>
              </>
            ) : view === "active" ? (
              <>
                <Table aria-label="Active plans">
                  {planHead}
                  <TableBody>{rows(activePlans, false)}</TableBody>
                </Table>
                <p aria-live="polite" className="text-xs text-ink-muted">
                  Showing {activePlans.length} of {metrics.active} active plans
                </p>
              </>
            ) : (
              <>
                <Table aria-label="All plans">
                  {planHead}
                  <TableBody>{rows(allPlans, true)}</TableBody>
                </Table>
                <p aria-live="polite" className="text-xs text-ink-muted">
                  Showing {allPlans.length} of {metrics.all} total plans
                </p>
              </>
            )}
          </div>
        </Card>
      )}

      <aside className="flex items-start gap-3 rounded-card border border-line bg-surface-low p-4 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="font-semibold text-ink">Operational notice. </span>
          Maintenance Plans define recurring service coverage. Scheduling an included visit creates a Booking; Jobs, Invoices and Payments remain
          separate records.
        </p>
      </aside>

      {creating && canManage && (
        <CreatePlanModal
          presetCustomerId={presetCustomerId}
          onClose={() => setParams({ new: null, customer: null })}
          onScheduleFirstVisit={(plan) => {
            setParams({ new: null, customer: null });
            setScheduling({ plan, visit: plan.visits[0] });
          }}
        />
      )}
      {scheduling && canManage && <ScheduleVisitModal plan={scheduling.plan} visit={scheduling.visit} onClose={() => setScheduling(null)} />}
    </>
  );
}

