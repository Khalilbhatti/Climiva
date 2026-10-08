/**
 * Maintenance Plans: recurring service agreements with included visits.
 *
 * A plan is coverage information, nothing more: no billing, no card charging, no entitlement engine and no
 * predictions. Plans point at the Customers and Properties fixtures by id. A visit that has been scheduled
 * points at its Booking by id, and the Booking points back (`Booking.planVisit`), so there is exactly one
 * appointment record: the Booking, which Bookings and the Schedule already show. Whether a visit is
 * completed, scheduled or still to book is derived from that Booking, never stored twice.
 *
 * "Cooling maintenance" and "Heating maintenance" are plan coverage concepts, not public Services. Each names
 * the canonical Service its visit is booked as (`bookingServiceId`), which is what lets a visit become a
 * Booking without adding anything to the Service catalog.
 *
 * Sources: design-reference/stitch/ maintenance_plans_*, maintenance_plan_detail_comfort_care,
 * create_maintenance_plan_flow and schedule_included_maintenance_visit_flow_*. Every conflict is listed in
 * docs/stitch-screen-map.md §10. In short:
 *  - Sarah Mitchell's Comfort Care is locked ($189/year, 2 visits/year, May 14, 2024 to May 14, 2025, Active).
 *  - Plans for people without a Customers record are name and address snapshots, like bookings and jobs.
 *  - The workspace totals (14 active, 5 visits due, 3 renewals, 1 paused, 1 ended) are aggregates: this file
 *    holds representative records only, and getPlanMetrics adds what is created during a session.
 *  - Plans whose Stitch details conflict with other modules (a commercial plan, Elena Rodriguez's address, plans
 *    that name Bookings which do not exist) are left out rather than resolved by invention.
 *
 * Fixtures are read-only. Demo changes (create a plan, schedule a visit) live in
 * components/maintenance-plans/MaintenancePlansProvider and reset on reload.
 */
import { addDays } from "@/lib/dates";
import { PROTOTYPE_TODAY } from "./fixtures";
import { getBookingById, type Booking, type OperationsData } from "./operations";

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
  /** Fulfilled before this prototype's records; later completions come from the visit's Booking. */
  completed?: boolean;
  completedOn?: string;
  /** The Booking that schedules this visit (the Booking points back with `planVisit`). */
  bookingId?: string;
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
};

export type PlansData = { plans: readonly MaintenancePlan[] };

/* ───────────────────────── fixtures ───────────────────────── */

export const PLANS: readonly MaintenancePlan[] = [
  {
    id: "plan-sarah-comfort-care",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    name: "Comfort Care",
    status: "active",
    price: 189,
    cadence: "year",
    startDate: "2024-05-14",
    endDate: "2025-05-14",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    visits: [
      // Visit 1 was the heating visit on May 22, 2024. Stitch names a Booking and Job for it that conflict with
      // other records (BK-1014 is Hannah Wright's), so it is recorded as fulfilled without links.
      { id: "plan-sarah-comfort-care-v1", sequence: 1, label: COVERAGE.heating.name, coverageId: "heating", completed: true, completedOn: "2024-05-22" },
      {
        id: "plan-sarah-comfort-care-v2",
        sequence: 2,
        label: COVERAGE.cooling.name,
        coverageId: "cooling",
        windowStart: "2024-11-01",
        windowEnd: "2024-11-30",
      },
    ],
  },
  {
    id: "plan-david-seasonal-maintenance",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    name: "Seasonal Maintenance",
    status: "active",
    price: 29,
    cadence: "month",
    endDate: "2025-01-10",
    coverage: [],
    visitsPerYear: 2,
    visits: [
      { id: "plan-david-seasonal-maintenance-v1", sequence: 1, label: "Annual Precision Maintenance" },
      { id: "plan-david-seasonal-maintenance-v2", sequence: 2, label: "Seasonal maintenance visit" },
    ],
  },
  {
    id: "plan-kevin-heating-cooling-care",
    contactName: "Kevin Vance",
    propertyText: "7401 Burnet Rd, Austin, TX",
    name: "Heating & Cooling Care",
    status: "active",
    price: 220,
    cadence: "year",
    endDate: "2024-11-30",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    visits: [
      { id: "plan-kevin-heating-cooling-care-v1", sequence: 1, label: COVERAGE.cooling.name, coverageId: "cooling", completed: true },
      { id: "plan-kevin-heating-cooling-care-v2", sequence: 2, label: COVERAGE.heating.name, coverageId: "heating", completed: true },
    ],
  },
  {
    id: "plan-arthur-seasonal-maintenance",
    contactName: "Arthur Pendleton",
    propertyText: "1904 Guadalupe St, Austin, TX",
    name: "Seasonal Maintenance",
    status: "active",
    price: 29,
    cadence: "month",
    endDate: "2025-08-15",
    coverage: [],
    visitsPerYear: 2,
    visits: [
      { id: "plan-arthur-seasonal-maintenance-v1", sequence: 1, label: "Seasonal maintenance visit", completed: true },
      {
        id: "plan-arthur-seasonal-maintenance-v2",
        sequence: 2,
        label: "Heating Safety & Airflow Inspection",
        windowStart: "2024-12-01",
        windowEnd: "2024-12-31",
      },
    ],
  },
  {
    id: "plan-robert-comfort-care",
    contactName: "Robert Miller",
    propertyText: "4502 Travis Heights Blvd, Austin, TX",
    name: "Comfort Care",
    status: "paused",
    price: 189,
    cadence: "year",
    endDate: "2025-08-22",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    statusNote: "Paused at customer request (renovations)",
    visits: [
      { id: "plan-robert-comfort-care-v1", sequence: 1, label: COVERAGE.cooling.name, coverageId: "cooling" },
      { id: "plan-robert-comfort-care-v2", sequence: 2, label: COVERAGE.heating.name, coverageId: "heating" },
    ],
  },
  {
    id: "plan-james-seasonal-maintenance",
    contactName: "James Thornton",
    propertyText: "2801 Oakmont Blvd, Austin, TX",
    name: "Seasonal Maintenance",
    status: "ended",
    price: 29,
    cadence: "month",
    endDate: "2024-10-15",
    coverage: [],
    visitsPerYear: 2,
    statusNote: "Agreement ended on property sale (Oct 15, 2024)",
    visits: [
      { id: "plan-james-seasonal-maintenance-v1", sequence: 1, label: "Seasonal maintenance visit", completed: true },
      { id: "plan-james-seasonal-maintenance-v2", sequence: 2, label: "Seasonal maintenance visit", completed: true },
    ],
  },
];

export const PLANS_DATA: PlansData = { plans: PLANS };

/** The workspace-level totals Stitch shows. Detailed records above are a representative sample of them. */
export const PLAN_BASELINE = {
  active: 14,
  visitsDue: 5,
  renewals: 3,
  paused: 1,
  ended: 1,
} as const;

/** A plan comes up for renewal when its end date falls within this many days. */
export const RENEWAL_WINDOW_DAYS = 60;

const CANONICAL_PLAN_IDS = new Set(PLANS.map((plan) => plan.id));

/* ───────────────────────── selectors ───────────────────────── */

export const getPlanById = (id: string, data: PlansData = PLANS_DATA) => data.plans.find((plan) => plan.id === id);

/** The plan visit a booking schedules, found through the booking's own pointer. */
export function getPlanVisitForBooking(booking: Pick<Booking, "planVisit">, data: PlansData = PLANS_DATA): { plan: MaintenancePlan; visit: PlanVisit } | undefined {
  if (!booking.planVisit) return undefined;
  const plan = getPlanById(booking.planVisit.planId, data);
  const visit = plan?.visits.find((item) => item.id === booking.planVisit!.visitId);
  return plan && visit ? { plan, visit } : undefined;
}

/** What the Customers screens show about a customer's plan: the plan record when there is one. */
export type PlanSummary = { name: string; status: string; price?: string; visitsPerYear?: number; planId?: string };

export function getCustomerPlanSummary(
  customer: { id: string; maintenancePlan?: { name: string; status: string; pricePerYear?: number; visitsPerYear?: number } },
  data: PlansData = PLANS_DATA,
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

export function getPlansForCustomer(customerId: string, data: PlansData = PLANS_DATA): MaintenancePlan[] {
  return data.plans.filter((plan) => plan.customerId === customerId);
}

/** The customer's current plan: their first active (or pending) one. */
export function getCurrentPlanForCustomer(customerId: string, data: PlansData = PLANS_DATA): MaintenancePlan | undefined {
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

/** The visit's Booking, unless that Booking was cancelled (the visit is then open to book again). */
export function getVisitBooking(visit: PlanVisit, ops: OperationsData): Booking | undefined {
  const booking = visit.bookingId ? getBookingById(visit.bookingId, ops) : undefined;
  return booking && booking.status !== "cancelled" ? booking : undefined;
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

export const isRenewingSoon = (plan: MaintenancePlan) =>
  plan.status === "active" && plan.endDate !== undefined && plan.endDate >= PROTOTYPE_TODAY && plan.endDate <= addDays(PROTOTYPE_TODAY, RENEWAL_WINDOW_DAYS);

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
 * The totals on the Maintenance Plans screens: the approved workspace figures, plus what this session added.
 * Plans created in the session count the way the approved ones do (active plans, plans renewing soon, a due next
 * visit); they are never subtracted from the approved totals.
 */
export function getPlanMetrics(data: PlansData, ops: OperationsData): PlanMetrics {
  const created = data.plans.filter((plan) => !CANONICAL_PLAN_IDS.has(plan.id));
  const active = created.filter((plan) => plan.status === "active");
  const metrics = {
    active: PLAN_BASELINE.active + active.length,
    visitsDue: PLAN_BASELINE.visitsDue + active.filter((plan) => getNextVisit(plan, ops)).length,
    renewals: PLAN_BASELINE.renewals + created.filter(isRenewingSoon).length,
    paused: PLAN_BASELINE.paused + created.filter((plan) => plan.status === "paused").length,
    ended: PLAN_BASELINE.ended + created.filter((plan) => plan.status === "ended").length,
  };
  const pausedOrEnded = metrics.paused + metrics.ended;
  return { ...metrics, pausedOrEnded, all: metrics.active + pausedOrEnded + created.filter((plan) => plan.status === "pending").length };
}
