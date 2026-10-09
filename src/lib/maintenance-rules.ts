/**
 * What a browser may ask of Maintenance Plans, as the server reads it: the shape of a new plan, of a visit being scheduled, and
 * the order in which a plan's visits are used. Pure functions: no database, no framework. The server actions call these before
 * they write, and the database holds the same rules again (checks, guards and grants in the maintenance migrations), so a
 * forged request cannot do what a screen would never offer.
 *
 * These check SHAPE and the rules that need only the request in hand. The rules that depend on the business's other records
 * (the customer and property are its own, the plan is active, the visit is the next one) are checked against the data the action
 * loads under the verified organization.
 *
 * Money is parsed in whole cents (lib/money). Dates are the business's calendar dates and are never converted.
 */
import { COVERAGE, COVERAGE_IDS, PLAN_CADENCE_LABEL, type CoverageId, type PlanCadence } from "@/data/maintenance-plans";
import { isValidDate } from "./dates";
import { amountToCents } from "./money";
import { slugOf } from "./operations-rules";
import { isRecord, text, type Parsed } from "./validation";

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

/** The most visits of one kind a plan can include per year. */
export const MAX_COVERAGE_VISITS = 4;
export const PLAN_NAME_MAX = 120;
export const PLAN_NOTE_MAX = 1000;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ───────────────────────── a new plan ───────────────────────── */

export type NewPlan = {
  customerSlug: string;
  propertySlug: string;
  name: string;
  /** A plan starts Active or Pending; Paused and Ended are managed after activation. */
  status: "active" | "pending";
  /** Visits per year of each kind, only the kinds included (at least one). */
  coverage: Partial<Record<CoverageId, number>>;
  priceCents: number;
  cadence: PlanCadence;
  startDate: string;
  endDate?: string;
  note?: string;
};

export function parseNewPlan(input: unknown): Parsed<NewPlan> {
  if (!isRecord(input)) return fail("The plan details were not understood.");
  const customerSlug = slugOf(input.customerId);
  const propertySlug = slugOf(input.propertyId);
  if (!customerSlug || !propertySlug) return fail("Select the customer and the property this plan covers.");

  const name = text(input.name, PLAN_NAME_MAX * 2)?.trim();
  if (!name) return fail("Enter a plan name.", { name: "Enter a plan name." });
  if (name.length > PLAN_NAME_MAX) return fail(`Keep the plan name to ${PLAN_NAME_MAX} characters or fewer.`, { name: `Keep the plan name to ${PLAN_NAME_MAX} characters or fewer.` });

  const status = input.status === "active" || input.status === "pending" ? input.status : undefined;
  if (!status) return fail("Choose whether the plan starts Active or Pending.");

  if (!isRecord(input.coverage)) return fail("Include at least one maintenance visit.", { coverage: "Include at least one maintenance visit." });
  // Only the two kinds of visit the product knows: a plan cannot cover anything else.
  if (Object.keys(input.coverage).some((key) => !(COVERAGE_IDS as readonly string[]).includes(key))) return fail("The plan details were not understood.");
  const coverage: NewPlan["coverage"] = {};
  for (const id of COVERAGE_IDS) {
    const visits = input.coverage[id];
    if (visits === undefined || visits === 0) continue;
    if (typeof visits !== "number" || !Number.isInteger(visits) || visits < 0 || visits > MAX_COVERAGE_VISITS) {
      const message = `Include between 0 and ${MAX_COVERAGE_VISITS} ${COVERAGE[id].name.toLowerCase()} visits.`;
      return fail(message, { coverage: message });
    }
    coverage[id] = visits;
  }
  if (Object.keys(coverage).length === 0) return fail("Include at least one maintenance visit.", { coverage: "Include at least one maintenance visit." });

  const priceCents = amountToCents(input.price);
  if (priceCents === undefined || priceCents <= 0) return fail("Enter the agreement price as an amount above $0.", { price: "Enter the agreement price as an amount above $0." });

  const cadence = (Object.keys(PLAN_CADENCE_LABEL) as PlanCadence[]).find((id) => id === input.cadence);
  if (!cadence) return fail("Choose how often the price applies.");

  if (typeof input.startDate !== "string" || !isValidDate(input.startDate)) return fail("Enter the start date.", { start: "Enter the start date." });
  const startDate = input.startDate;
  let endDate: string | undefined;
  if (input.endDate !== undefined && input.endDate !== "") {
    if (typeof input.endDate !== "string" || !isValidDate(input.endDate)) return fail("Enter a valid renewal / end date.", { end: "Enter a valid renewal / end date." });
    if (input.endDate <= startDate) return fail("The renewal / end date must be after the start date.", { end: "The renewal / end date must be after the start date." });
    endDate = input.endDate;
  }

  const note = input.note === undefined || input.note === "" ? undefined : text(input.note, PLAN_NOTE_MAX)?.trim();
  if (input.note !== undefined && input.note !== "" && note === undefined) return fail(`Keep the note under ${PLAN_NOTE_MAX} characters.`);

  return { ok: true, value: { customerSlug, propertySlug, name, status, coverage, priceCents, cadence, startDate, endDate, note: note || undefined } };
}

/** The reference a new plan takes: "plan-sarah-mitchell-comfort-care", made unique among `taken` ("…-2", "…-3"). */
export function planSlug(customerSlug: string, name: string, taken: readonly string[]): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `plan-${customerSlug}-${clean || "plan"}`.slice(0, 100).replace(/-+$/g, "");
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The visits a plan includes, in the order they are used: cooling first, then heating, numbered 1..n. */
export function visitsOf(slug: string, coverage: NewPlan["coverage"]): { ref: string; sequence: number; coverageId: CoverageId; label: string }[] {
  const visits: { ref: string; sequence: number; coverageId: CoverageId; label: string }[] = [];
  for (const coverageId of COVERAGE_IDS) {
    for (let index = 0; index < (coverage[coverageId] ?? 0); index += 1) {
      const sequence = visits.length + 1;
      visits.push({ ref: `${slug}-v${sequence}`, sequence, coverageId, label: COVERAGE[coverageId].name });
    }
  }
  return visits;
}

/* ───────────────────────── scheduling a visit ───────────────────────── */

export type ScheduleVisit = {
  planSlug: string;
  visitRef: string;
  serviceSlug: string;
  date: string;
  start: string;
  end: string;
  assigneeSlug?: string;
  internalNotes?: string;
};

export function parseScheduleVisit(planReference: unknown, visitReference: unknown, input: unknown): Parsed<ScheduleVisit> {
  const planSlug = slugOf(planReference);
  const visitRef = typeof visitReference === "string" && /^[a-z0-9][a-z0-9-]{0,159}$/.test(visitReference) ? visitReference : undefined;
  if (!planSlug || !visitRef || !isRecord(input)) return fail("The visit details were not understood.");
  const serviceSlug = slugOf(input.serviceId);
  const date = typeof input.date === "string" && isValidDate(input.date) ? input.date : undefined;
  const start = typeof input.start === "string" && CLOCK.test(input.start) ? input.start : undefined;
  const end = typeof input.end === "string" && CLOCK.test(input.end) ? input.end : undefined;
  if (!serviceSlug) return fail("Select the service this visit is booked as.");
  if (!date) return fail("Select a service date.", { date: "Select a service date." });
  if (!start || !end || end <= start) return fail("Select an available arrival window.", { slot: "Select an available arrival window." });
  const assigneeSlug = input.assigneeId === undefined ? undefined : slugOf(input.assigneeId);
  if (input.assigneeId !== undefined && !assigneeSlug) return fail("The visit details were not understood.");
  const internalNotes = input.internalNotes === undefined || input.internalNotes === "" ? undefined : text(input.internalNotes, 2000)?.trim();
  if (input.internalNotes !== undefined && input.internalNotes !== "" && internalNotes === undefined) return fail("Keep the notes under 2,000 characters.");
  return { ok: true, value: { planSlug, visitRef, serviceSlug, date, start, end, assigneeSlug, internalNotes: internalNotes || undefined } };
}

/** Why a visit cannot be scheduled for `date`, given its target window, or undefined when it can. */
export function visitWindowError(window: { start?: string; end?: string }, date: string): string | undefined {
  if (window.start && date < window.start) return `Select a date between ${window.start} and ${window.end ?? "the end of the window"}, the target window for this visit.`;
  if (window.end && date > window.end) return `Select a date between ${window.start ?? "today"} and ${window.end}, the target window for this visit.`;
  return undefined;
}
