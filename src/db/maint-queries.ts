/**
 * Maintenance Plans: the queries.
 *
 * Like the other query modules, every function takes an open transaction (`tx`) and the organization it works for, and names
 * that organization in every statement's WHERE clause. They are meant to be called from `withTenant(...)`, where Row Level
 * Security enforces the same boundary again. The seed calls the same functions on the owner connection, so the data it writes is
 * exactly what the application reads.
 *
 * Scheduling a visit makes a REAL Booking (the shared booking-create code the Bookings screen uses) and links it to the visit in
 * the same transaction: if either fails, neither happens. Creating a plan with its coverage and visits is one transaction too.
 * Nothing here creates a Job, Quote, Invoice or Payment: a plan's price describes the agreement and bills no one.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may import
 * this file (a test enforces it).
 */
import { and, asc, eq, like } from "drizzle-orm";
import { COVERAGE, COVERAGE_IDS, type CoverageId, type MaintenancePlan, type PlanVisit, type PlansData } from "@/data/maintenance-plans";
import { toCents } from "@/lib/money";
import { planSlug, visitsOf, visitWindowError, type NewPlan, type ScheduleVisit } from "@/lib/maintenance-rules";
import { refuse } from "@/lib/refusal";
import { insertBookingTx, type BookingWork } from "./booking-create";
import { loadServices } from "./core-queries";
import { planFromRow } from "./maint-mappers";
import type { Tx } from "./index";
import { loadRefs, type IdOptions, type Refs } from "./ops-queries";
import { bookings, maintenancePlanCoverage, maintenancePlanVisits, maintenancePlans } from "./schema";
import { stableId } from "./stable-id";

const idFor = (options: IdOptions, organizationId: string, kind: string, reference: string) =>
  options.stableIds ? { id: stableId(organizationId, kind, reference) } : {};

const GONE_PLAN = "That plan no longer exists. Reload the page and try again.";
const GONE_VISIT = "That visit no longer exists. Reload the page and try again.";

/* ───────────────────────── reading ───────────────────────── */

/** Every plan of one business with its coverage and visits, as the screens use them. */
export async function loadMaintenance(tx: Tx, organizationId: string, refs?: Refs): Promise<PlansData> {
  const resolved = refs ?? (await loadRefs(tx, organizationId));
  const planRows = await tx.select().from(maintenancePlans).where(eq(maintenancePlans.organizationId, organizationId)).orderBy(asc(maintenancePlans.createdAt), asc(maintenancePlans.slug));
  const coverageRows = await tx.select().from(maintenancePlanCoverage).where(eq(maintenancePlanCoverage.organizationId, organizationId));
  const visitRows = await tx.select().from(maintenancePlanVisits).where(eq(maintenancePlanVisits.organizationId, organizationId));
  return {
    plans: planRows.map((row) =>
      planFromRow(
        row,
        coverageRows.filter((item) => item.planId === row.id),
        visitRows.filter((item) => item.planId === row.id),
        resolved.slugs,
      ),
    ),
  };
}

/* ───────────────────────── creating a plan ───────────────────────── */

/**
 * Create a plan with its coverage and its visits, in one transaction. The customer and the property are resolved INSIDE this
 * business and the property must be that customer's own. Returns the plan's reference. It creates no Booking, Job, Invoice or
 * Payment.
 */
export async function createPlanTx(ctx: { tx: Tx; organizationId: string; refs: Refs }, input: NewPlan): Promise<string> {
  const { tx, organizationId, refs } = ctx;
  const customerId = refs.idBySlug.customers.get(input.customerSlug);
  if (!customerId) return refuse("That customer is not in your customers any more. Choose another or reload the page.");
  const propertyId = refs.idBySlug.properties.get(input.propertySlug);
  if (!propertyId || refs.propertyOwner.get(propertyId) !== customerId) return refuse("That property doesn't belong to this customer.");

  const base = planSlug(input.customerSlug, input.name, []);
  const taken = (
    await tx.select({ slug: maintenancePlans.slug }).from(maintenancePlans).where(and(eq(maintenancePlans.organizationId, organizationId), like(maintenancePlans.slug, `${base}%`)))
  ).map((row) => row.slug);
  const slug = planSlug(input.customerSlug, input.name, taken);

  const visits = visitsOf(slug, input.coverage);
  const [plan] = await tx
    .insert(maintenancePlans)
    .values({
      organizationId,
      slug,
      customerId,
      propertyId,
      name: input.name,
      status: input.status,
      priceCents: input.priceCents,
      cadence: input.cadence,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      visitsPerYear: visits.length,
      note: input.note ?? null,
    })
    .returning({ id: maintenancePlans.id });

  const coverageIdByKey = new Map<CoverageId, string>();
  let order = 0;
  for (const key of COVERAGE_IDS) {
    const count = input.coverage[key];
    if (!count) continue;
    order += 1;
    const [row] = await tx
      .insert(maintenancePlanCoverage)
      .values({ organizationId, planId: plan.id, coverageKey: key, label: COVERAGE[key].name, visits: count, sortOrder: order })
      .returning({ id: maintenancePlanCoverage.id });
    coverageIdByKey.set(key, row.id);
  }
  await tx.insert(maintenancePlanVisits).values(
    visits.map((visit) => ({
      organizationId,
      planId: plan.id,
      coverageId: coverageIdByKey.get(visit.coverageId)!,
      ref: visit.ref,
      sequence: visit.sequence,
      label: visit.label,
      status: "due",
    })),
  );
  return slug;
}

/* ───────────────────────── scheduling a visit ───────────────────────── */

/**
 * Schedule a plan's next included visit as a real Booking, atomically: the plan must be active and be this business's own, the
 * visit must be the plan's next one and still to book, the date must fall in its target window and the booking must be one the
 * business can take (its hours, its team, its Services). The booking is for the plan's own customer and property; the visit then
 * points at it and becomes scheduled. Returns the new booking's number.
 */
export async function scheduleVisitTx(work: BookingWork, input: ScheduleVisit): Promise<number> {
  const { tx, organizationId, refs, clock } = work;
  const [plan] = await tx.select().from(maintenancePlans).where(and(eq(maintenancePlans.organizationId, organizationId), eq(maintenancePlans.slug, input.planSlug))).limit(1);
  if (!plan) return refuse(GONE_PLAN);
  if (plan.status !== "active") refuse("Only an active plan can have a visit scheduled.");

  // The visits are locked in order, so two requests for one plan wait for each other instead of both booking the same visit.
  const visits = await tx
    .select()
    .from(maintenancePlanVisits)
    .where(and(eq(maintenancePlanVisits.organizationId, organizationId), eq(maintenancePlanVisits.planId, plan.id)))
    .orderBy(asc(maintenancePlanVisits.sequence))
    .for("update");
  const target = visits.find((visit) => visit.ref === input.visitRef);
  if (!target) return refuse(GONE_VISIT);
  if (target.status === "completed") refuse("That visit is already completed.");
  if (target.status === "scheduled") refuse("That visit already has a booking.");
  const next = visits.find((visit) => visit.status !== "completed");
  if (next?.id !== target.id) refuse("Schedule the plan's next included visit first.");

  const windowProblem = visitWindowError({ start: target.windowStart ?? undefined, end: target.windowEnd ?? undefined }, input.date);
  if (windowProblem) refuse(windowProblem, { date: windowProblem });
  if (input.date < clock.today) refuse("That date has already passed.", { date: "That date has already passed." });

  // A visit that names a coverage is booked as the Service that coverage is for, when the business has one; otherwise as any of its own.
  const coverageKey = target.coverageId
    ? (await tx.select().from(maintenancePlanCoverage).where(and(eq(maintenancePlanCoverage.organizationId, organizationId), eq(maintenancePlanCoverage.id, target.coverageId))).limit(1))[0]?.coverageKey
    : undefined;
  const mapped = coverageKey ? COVERAGE[coverageKey as CoverageId]?.bookingServiceId : undefined;
  if (mapped && refs.idBySlug.services.has(mapped) && input.serviceSlug !== mapped) {
    const name = (await loadServices(tx, organizationId)).find((service) => service.id === mapped)?.name ?? "its maintenance service";
    refuse(`This ${target.label.toLowerCase()} visit is booked as ${name}.`);
  }

  const customerSlug = plan.customerId ? refs.slugs.customers.get(plan.customerId) : undefined;
  if (plan.customerId && !customerSlug) refuse("That customer is not in your customers any more. Choose another or reload the page.");
  const booking = await insertBookingTx(
    work,
    {
      customerId: customerSlug,
      contactName: plan.customerId ? undefined : (plan.contactName ?? undefined),
      contact: plan.customerId || !plan.propertyText ? undefined : { address: plan.propertyText },
      propertyId: plan.propertyId ? refs.slugs.properties.get(plan.propertyId) : undefined,
      serviceId: input.serviceSlug,
      source: "Maintenance plan",
      date: input.date,
      start: input.start,
      end: input.end,
      assigneeId: input.assigneeSlug,
      internalNotes: input.internalNotes,
    },
    target.ref,
  );

  const linked = await tx
    .update(maintenancePlanVisits)
    .set({ status: "scheduled", bookingId: booking.id })
    .where(and(eq(maintenancePlanVisits.organizationId, organizationId), eq(maintenancePlanVisits.id, target.id), eq(maintenancePlanVisits.status, "due")))
    .returning({ id: maintenancePlanVisits.id });
  if (linked.length === 0) refuse("That visit already has a booking.");
  return booking.number;
}

/* ───────────────────────── seed and tests ───────────────────────── */

/** A visit as the seed writes it: the plan's visit, plus the booking that schedules it when one already exists. */
export type SeedVisit = PlanVisit & { bookingId?: string };
export type SeedPlan = Omit<MaintenancePlan, "visits"> & { visits: readonly SeedVisit[] };
export type SeedPlans = { plans: readonly SeedPlan[] };

/**
 * Write a whole set of plans for one business (the sample business, the second seed business, a test copy). A visit marked
 * `completed` is fulfilled, a visit with a `bookingId` is scheduled with that booking (which must already exist), any other is
 * still to book. Dates cross unchanged. Runs on the owner connection after the operations are written.
 */
export async function insertMaintenance(tx: Tx, organizationId: string, data: SeedPlans, refs: Refs, options: IdOptions = {}): Promise<void> {
  const bookingNumber = (reference: string) => Number(reference.replace(/^BK-/, ""));
  const bookingRows = data.plans.some((plan) => plan.visits.some((visit) => visit.bookingId))
    ? await tx.select({ id: bookings.id, number: bookings.number }).from(bookings).where(eq(bookings.organizationId, organizationId))
    : [];
  const bookingIdByNumber = new Map(bookingRows.map((row) => [row.number, row.id]));

  for (const plan of data.plans) {
    const customerId = plan.customerId ? refs.idBySlug.customers.get(plan.customerId) : undefined;
    if (plan.customerId && !customerId) throw new Error(`Unknown customer "${plan.customerId}".`);
    const propertyId = plan.propertyId ? refs.idBySlug.properties.get(plan.propertyId) : undefined;
    if (plan.propertyId && !propertyId) throw new Error(`Unknown property "${plan.propertyId}".`);
    const [row] = await tx
      .insert(maintenancePlans)
      .values({
        organizationId,
        ...idFor(options, organizationId, "plan", plan.id),
        slug: plan.id,
        customerId: customerId ?? null,
        contactName: plan.contactName ?? null,
        propertyId: propertyId ?? null,
        propertyText: plan.propertyText ?? null,
        name: plan.name,
        status: plan.status,
        statusNote: plan.statusNote ?? null,
        priceCents: toCents(plan.price),
        cadence: plan.cadence,
        startDate: plan.startDate ?? null,
        endDate: plan.endDate ?? null,
        visitsPerYear: plan.visitsPerYear,
        note: plan.note ?? null,
        imported: plan.imported ?? false,
      })
      .returning({ id: maintenancePlans.id });

    const coverageIdByKey = new Map<CoverageId, string>();
    for (const [index, item] of plan.coverage.entries()) {
      const [coverage] = await tx
        .insert(maintenancePlanCoverage)
        .values({
          organizationId,
          ...idFor(options, organizationId, "plan-coverage", `${plan.id}/${item.coverageId}`),
          planId: row.id,
          coverageKey: item.coverageId,
          label: COVERAGE[item.coverageId].name,
          visits: item.visits,
          sortOrder: index + 1,
        })
        .returning({ id: maintenancePlanCoverage.id });
      coverageIdByKey.set(item.coverageId, coverage.id);
    }

    for (const visit of plan.visits) {
      const booking = visit.bookingId ? bookingIdByNumber.get(bookingNumber(visit.bookingId)) : undefined;
      if (visit.bookingId && !booking) throw new Error(`Unknown booking "${visit.bookingId}".`);
      await tx.insert(maintenancePlanVisits).values({
        organizationId,
        ...idFor(options, organizationId, "plan-visit", visit.id),
        planId: row.id,
        coverageId: visit.coverageId ? (coverageIdByKey.get(visit.coverageId) ?? null) : null,
        ref: visit.id,
        sequence: visit.sequence,
        label: visit.label,
        windowStart: visit.windowStart ?? null,
        windowEnd: visit.windowEnd ?? null,
        status: visit.completed ? "completed" : booking ? "scheduled" : "due",
        bookingId: booking ?? null,
        completedOn: visit.completedOn ?? null,
      });
    }
  }
}

/** Remove every plan of one organization (tests reset a worker's copy of the sample business with this). Coverage and visits go with their plans. */
export async function clearMaintenance(tx: Tx, organizationId: string): Promise<void> {
  await tx.delete(maintenancePlans).where(eq(maintenancePlans.organizationId, organizationId));
}
