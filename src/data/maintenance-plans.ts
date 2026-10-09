/**
 * Maintenance Plans: recurring service agreements with included visits.
 *
 * A plan is coverage information, nothing more: no billing, no card charging, no entitlement engine and no predictions. The
 * records live in PostgreSQL, per organization, and reach the browser for the ACTIVE organization only (src/db/maint-queries,
 * components/maintenance-plans/MaintenancePlansProvider). The canonical Apex Climate plans are seed data
 * (scripts/db/seed-data/maintenance.ts) and ship to no browser.
 *
 * Plans point at the Customers and Properties by id (a person without a Customers record is a name and address snapshot, like
 * bookings and jobs). A visit that has been scheduled points at its Booking through the database, and the Booking is the ONE
 * record of the appointment, which Bookings and the Schedule already show: whether a visit is completed, scheduled or still to
 * book is derived from that Booking here, so the screens cannot disagree with it. (The database keeps the visit's own status in
 * step with its booking, so the two agree after a reload too.)
 *
 * "Cooling maintenance" and "Heating maintenance" are plan coverage concepts, not public Services. Each names the canonical
 * Service its visit is booked as (`bookingServiceId`), which is what lets a visit become a Booking without adding anything to
 * the Service catalog. A business whose catalog has no such Service books the visit as one of its own Services.
 *
 * Sources: design-reference/stitch/ maintenance_plans_*, maintenance_plan_detail_comfort_care, create_maintenance_plan_flow and
 * schedule_included_maintenance_visit_flow_*. Every conflict is listed in docs/stitch-screen-map.md §10. In short:
 *  - Sarah Mitchell's Comfort Care is locked ($189/year, 2 visits/year, May 14, 2024 to May 14, 2025, Active).
 *  - The workspace totals (14 active, 5 visits due, 3 renewals, 1 paused, 1 ended) are the sample business's reporting
 *    aggregates: its stored plans are a representative sample (marked `imported`), and getPlanMetrics adds the plans created
 *    since. Any other business's totals are counted from its own plans.
 *  - Plans that conflict with other modules (a commercial plan, Elena Rodriguez's address, plans that name Bookings which do not
 *    exist) are left out rather than resolved by invention.
 */
import { addDays } from "@/lib/dates";
import type { Booking, OperationsData } from "./operations";

/* ───────────────────────── types ───────────────────────── */

export type PlanStatus = "active" | "pending" | "paused" | "ended";
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  active: "Active",
  pending: "Pending",
  paused: "Paused",
  ended: "Ended",
};

export type PlanCadence = "year" | "month" | "one-time";
export const PLAN_CADENCE_LABEL: Record<PlanCadence, string> = { year: "Yearly", month: "Monthly", "one-time": "One-time" };

export type CoverageId = "cooling" | "heating";

/** What a plan can include. These are maintenance visit definitions, separate from the public Service catalog. */
export const COVERAGE: Record<CoverageId, { name: string; description: string; detail: string; bookingServiceId: string }> = {
  cooling: {
    name: "Cooling maintenance",
    description: "Seasonal cooling maintenance visit.",
    detail: "Comprehensive seasonal AC tune-up, coil inspection, electrical tightening, and refrigerant safety check.",
    bookingServiceId: "annual-cooling-tune-up",
  },
  heating: {
    name: "Heating maintenance",
    description: "Seasonal heating maintenance visit.",
    detail: "Pre-winter furnace diagnostic, burner cleaning, heat exchanger integrity check, and safety controls test.",
    bookingServiceId: "furnace-safety-inspection",
  },
};
export const COVERAGE_IDS = Object.keys(COVERAGE) as CoverageId[];

export type PlanVisit = {
  id: string;
  /** Position in the plan: "Visit 2 of 2". */
  sequence: number;
  label: string;
  coverageId?: CoverageId;
  /** Target service window, "2024-11-01" to "2024-11-30". Without one the visit can be booked any time. */
  windowStart?: string;
  windowEnd?: string;
  /** Fulfilled: before this system kept records, or because its Booking was completed. */
  completed?: boolean;
  completedOn?: string;
};

export type MaintenancePlan = {
  id: string;
  /** Exactly one of customerId / contactName. */
  customerId?: string;
  contactName?: string;
  propertyId?: string;
  /** Address snapshot for someone without a Customers record. */
  propertyText?: string;
  name: string;
  status: PlanStatus;
  price: number;
  cadence: PlanCadence;
  startDate?: string;
  /** Renewal / end date. */
  endDate?: string;
  coverage: readonly { coverageId: CoverageId; visits: number }[];
  visitsPerYear: number;
  visits: readonly PlanVisit[];
  /** Why a plan is paused or ended. */
  statusNote?: string;
  note?: string;
  /** Carried in with the sample business's history: already inside its reported workspace totals. */
  imported?: boolean;
};

export type PlansData = { plans: readonly MaintenancePlan[] };

/** The workspace-level totals Stitch shows for the sample business. Its stored plans are a representative sample of them. */
export const PLAN_BASELINE = {
  active: 14,
  visitsDue: 5,
  renewals: 3,
  paused: 1,
  ended: 1,
} as const;

/** What a business that has no reporting history starts from: nothing. */
export const NO_PLAN_BASELINE: PlanBaseline = { active: 0, visitsDue: 0, renewals: 0, paused: 0, ended: 0 };

export type PlanBaseline = { readonly active: number; readonly visitsDue: number; readonly renewals: number; readonly paused: number; readonly ended: number };

/** A plan comes up for renewal when its end date falls within this many days. */
export const RENEWAL_WINDOW_DAYS = 60;

/* ───────────────────────── selectors ───────────────────────── */

export const getPlanById = (id: string, data: PlansData) => data.plans.find((plan) => plan.id === id);

/** The plan visit a booking schedules, found through the booking's own pointer. */
export function getPlanVisitForBooking(booking: Pick<Booking, "planVisit">, data: PlansData): { plan: MaintenancePlan; visit: PlanVisit } | undefined {
  if (!booking.planVisit) return undefined;
  const plan = getPlanById(booking.planVisit.planId, data);
  const visit = plan?.visits.find((item) => item.id === booking.planVisit!.visitId);
  return plan && visit ? { plan, visit } : undefined;
}

/** What the Customers screens show about a customer's plan: the plan record when there is one. */
export type PlanSummary = { name: string; status: string; price?: string; visitsPerYear?: number; planId?: string };

export function getCustomerPlanSummary(
  customer: { id: string; maintenancePlan?: { name: string; status: string; pricePerYear?: number; visitsPerYear?: number } },
  data: PlansData,
): PlanSummary | undefined {
  const plan = getCurrentPlanForCustomer(customer.id, data);
  if (plan) {
    return {
      name: plan.name,
      status: PLAN_STATUS_LABEL[plan.status],
      price: plan.cadence === "year" ? `$${plan.price}/yr` : plan.cadence === "month" ? `$${plan.price}/mo` : `$${plan.price}`,
      visitsPerYear: plan.visitsPerYear,
      planId: plan.id,
    };
  }
  const legacy = customer.maintenancePlan;
  return legacy
    ? { name: legacy.name, status: legacy.status, price: legacy.pricePerYear === undefined ? undefined : `$${legacy.pricePerYear}/yr`, visitsPerYear: legacy.visitsPerYear }
    : undefined;
}

export function getPlansForCustomer(customerId: string, data: PlansData): MaintenancePlan[] {
  return data.plans.filter((plan) => plan.customerId === customerId);
}

/** The customer's current plan: their first active (or pending) one. */
export function getCurrentPlanForCustomer(customerId: string, data: PlansData): MaintenancePlan | undefined {
  const plans = getPlansForCustomer(customerId, data);
  return plans.find((plan) => plan.status === "active") ?? plans.find((plan) => plan.status === "pending");
}

export function formatPlanPrice(plan: Pick<MaintenancePlan, "price" | "cadence">): string {
  const amount = Number.isInteger(plan.price) ? `$${plan.price}` : `$${plan.price.toFixed(2)}`;
  return plan.cadence === "one-time" ? `${amount} one-time` : `${amount} / ${plan.cadence}`;
}

/* ── visits ── */

export type VisitState = "completed" | "scheduled" | "needs-scheduling" | "not-scheduled";
export const VISIT_STATE_LABEL: Record<VisitState, string> = {
  completed: "Completed",
  scheduled: "Scheduled",
  "needs-scheduling": "Needs scheduling",
  "not-scheduled": "Not scheduled",
};

/**
 * The visit's Booking: the stored Booking the visit points at, unless it was cancelled (the visit is then open to book again).
 * The plan holds no copy of the appointment, so what the plan shows is always what is stored.
 */
export function getVisitBooking(visit: PlanVisit, ops: OperationsData): Booking | undefined {
  return ops.bookings.find((booking) => booking.planVisit?.visitId === visit.id && booking.status !== "cancelled");
}

export function getVisitState(visit: PlanVisit, ops: OperationsData): VisitState {
  const booking = getVisitBooking(visit, ops);
  if (visit.completed || booking?.status === "completed") return "completed";
  if (booking) return "scheduled";
  return visit.windowStart ? "needs-scheduling" : "not-scheduled";
}

export const getCompletedVisitCount = (plan: MaintenancePlan, ops: OperationsData) =>
  plan.visits.filter((visit) => getVisitState(visit, ops) === "completed").length;

/** The next visit still to happen: the first one that is not completed. Only this one is "due". */
export function getNextVisit(plan: MaintenancePlan, ops: OperationsData): PlanVisit | undefined {
  return plan.visits.find((visit) => getVisitState(visit, ops) !== "completed");
}

/** Active plans' next visits, for the Upcoming service view. */
export function getUpcomingVisits(data: PlansData, ops: OperationsData): { plan: MaintenancePlan; visit: PlanVisit }[] {
  return data.plans.flatMap((plan) => {
    const visit = plan.status === "active" ? getNextVisit(plan, ops) : undefined;
    return visit ? [{ plan, visit }] : [];
  });
}

/** Whether an active plan's end date falls within the renewal window from `today` (the business's own today). */
export const isRenewingSoon = (plan: MaintenancePlan, today: string) =>
  plan.status === "active" && plan.endDate !== undefined && plan.endDate >= today && plan.endDate <= addDays(today, RENEWAL_WINDOW_DAYS);

/* ── workspace totals ── */

export type PlanMetrics = {
  active: number;
  visitsDue: number;
  renewals: number;
  paused: number;
  ended: number;
  pausedOrEnded: number;
  all: number;
};

/**
 * The totals on the Maintenance Plans screens: the reporting `baseline` (the sample business's approved workspace figures; none
 * for any other business), plus the plans not carried in with that history, counted the way the approved ones are (active plans,
 * plans renewing soon, a due next visit). Stored plans marked `imported` are already inside the baseline and are never counted
 * twice; nothing is ever subtracted from it.
 */
export function getPlanMetrics(data: PlansData, ops: OperationsData, today: string, baseline: PlanBaseline = NO_PLAN_BASELINE): PlanMetrics {
  const created = data.plans.filter((plan) => !plan.imported);
  const active = created.filter((plan) => plan.status === "active");
  const metrics = {
    active: baseline.active + active.length,
    visitsDue: baseline.visitsDue + active.filter((plan) => getNextVisit(plan, ops)).length,
    renewals: baseline.renewals + created.filter((plan) => isRenewingSoon(plan, today)).length,
    paused: baseline.paused + created.filter((plan) => plan.status === "paused").length,
    ended: baseline.ended + created.filter((plan) => plan.status === "ended").length,
  };
  const pausedOrEnded = metrics.paused + metrics.ended;
  return { ...metrics, pausedOrEnded, all: metrics.active + pausedOrEnded + created.filter((plan) => plan.status === "pending").length };
}
