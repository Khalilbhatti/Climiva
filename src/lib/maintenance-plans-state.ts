/**
 * Pure state transitions for the Maintenance Plans demo. Nothing here mutates its input, so the fixtures in
 * data/maintenance-plans.ts stay untouched.
 *
 * Creating a plan and linking a visit change plans only. They never create a Quote, Invoice, Payment or Job:
 * the plan's price is information about the agreement, and a visit becomes work only through its Booking
 * (made through the shared operations state).
 */
import {
  COVERAGE,
  COVERAGE_IDS,
  type CoverageId,
  type MaintenancePlan,
  type PlanCadence,
  type PlanStatus,
  type PlanVisit,
  type PlansData,
} from "@/data/maintenance-plans";
import { slugify } from "./team-state";

export type NewPlanInput = {
  customerId: string;
  propertyId: string;
  name: string;
  status: Extract<PlanStatus, "active" | "pending">;
  /** How many visits of each coverage type the plan includes per year. */
  coverage: Partial<Record<CoverageId, number>>;
  price: number;
  cadence: PlanCadence;
  startDate: string;
  endDate?: string;
  note?: string;
};

function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Cooling visits first, then heating, numbered 1..n. */
export function buildVisits(planId: string, coverage: NewPlanInput["coverage"]): PlanVisit[] {
  const visits: PlanVisit[] = [];
  for (const coverageId of COVERAGE_IDS) {
    for (let index = 0; index < (coverage[coverageId] ?? 0); index += 1) {
      const sequence = visits.length + 1;
      visits.push({ id: `${planId}-v${sequence}`, sequence, label: COVERAGE[coverageId].name, coverageId });
    }
  }
  return visits;
}

export function createPlan(data: PlansData, input: NewPlanInput, customerSlug: string): { data: PlansData; plan: MaintenancePlan } {
  const id = uniqueId(`plan-${customerSlug}-${slugify(input.name)}`, data.plans.map((plan) => plan.id));
  const coverage = COVERAGE_IDS.filter((coverageId) => (input.coverage[coverageId] ?? 0) > 0).map((coverageId) => ({
    coverageId,
    visits: input.coverage[coverageId]!,
  }));
  const visits = buildVisits(id, input.coverage);
  const plan: MaintenancePlan = {
    id,
    customerId: input.customerId,
    propertyId: input.propertyId,
    name: input.name.trim(),
    status: input.status,
    price: input.price,
    cadence: input.cadence,
    startDate: input.startDate,
    endDate: input.endDate || undefined,
    coverage,
    visitsPerYear: visits.length,
    visits,
    note: input.note?.trim() || undefined,
  };
  return { data: { ...data, plans: [...data.plans, plan] }, plan };
}

/** Records which Booking schedules a visit. The Booking itself is created through the operations state. */
export function linkVisitToBooking(data: PlansData, planId: string, visitId: string, bookingId: string): PlansData {
  return {
    ...data,
    plans: data.plans.map((plan) =>
      plan.id === planId
        ? { ...plan, visits: plan.visits.map((visit) => (visit.id === visitId ? { ...visit, bookingId } : visit)) }
        : plan,
    ),
  };
}
