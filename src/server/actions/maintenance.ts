"use server";

import { PROTOTYPE_NOW } from "@/data/fixtures";
import type { MaintenancePlan, PlansData } from "@/data/maintenance-plans";
import type { Booking, OperationsData } from "@/data/operations";
import type { BookingWork } from "@/db/booking-create";
import { createPlanTx, loadMaintenance, scheduleVisitTx } from "@/db/maint-queries";
import { loadOperations, loadRefs } from "@/db/ops-queries";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_MAINTENANCE, NOT_FOUND, failure, ok, type ActionResult } from "@/lib/action-result";
import { stampInstant } from "@/lib/business-time";
import { parseNewPlan, parseScheduleVisit } from "@/lib/maintenance-rules";
import { bookingReference } from "@/lib/operations-rules";
import { Refusal, refuse } from "@/lib/refusal";
import type { Parsed } from "@/lib/validation";
import { authorize } from "../authorize";
import { constraintOf, isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Maintenance Plan writes: creating a plan and scheduling one of its included visits. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "maintenance:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement), so someone who is not signed in learns nothing about what a valid request looks like,
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, resolves every reference it names
 *      INSIDE the verified organization, locks the visit it changes, and checks the change is one the plan may make now,
 *   5. writes, reads the business's plans back and answers with them, so the screen shows exactly what is stored.
 * No argument names an organization. A refusal at any point rolls the whole change back, so a plan never exists without its
 * coverage and visits, and a booking is never left behind by a visit that could not be scheduled. Neither action creates a Job,
 * Quote, Invoice or Payment: a plan's price describes the agreement and bills no one.
 */

type Answer = { plans: PlansData };

/** The value of a parsed argument, or a refusal that says what was wrong with it. */
function valid<T>(parsed: Parsed<T>): T {
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = constraintOf(error);
  if (constraint === "plans_org_slug_unique" || constraint === "plan_visits_org_ref_unique") return failure("A plan with that name was created at the same moment. Reload the page and try again.");
  if (constraint === "plan_visits_org_booking_unique" || constraint === "plan_visits_final" || constraint === "plan_visits_status_transition") return failure("That visit already has a booking.");
  if (constraint === "plan_visits_booking_party") return failure("That booking is not for this plan's customer.");
  if (uniqueViolationOf(error)) return failure("Someone changed this at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[maintenance] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

type Work = BookingWork & { timeZone: string };

/** Authorize, open the tenant transaction, run the change, and answer with the plans as stored. */
async function mutate<T extends object = object>(change: (work: Work) => Promise<T>): Promise<ActionResult<Answer & T>> {
  const auth = await authorize("maintenance:manage", NOT_ALLOWED_MAINTENANCE);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const refs = await loadRefs(tx, organizationId);
      const extra = await change({
        tx,
        organizationId,
        timeZone: organization.timezone,
        refs,
        hours: snapshot.settings.hours,
        clock: snapshot.clock,
        stamp: stampInstant(snapshot.hasSampleData, organization.timezone, PROTOTYPE_NOW),
      });
      return ok({ plans: await loadMaintenance(tx, organizationId, refs), ...extra });
    });
  } catch (error) {
    return translate(error);
  }
}

/* ───────────────────────── plans ───────────────────────── */

/**
 * Create a plan with its coverage and its visits, in one transaction. It creates no Booking, Job, Invoice or Payment; the first
 * visit is scheduled afterwards, on purpose.
 */
export async function createPlanAction(input: unknown): Promise<ActionResult<Answer & { plan: MaintenancePlan }>> {
  return mutate(async (work) => {
    const slug = await createPlanTx(work, valid(parseNewPlan(input)));
    return { reference: slug };
  }).then((result) => {
    if (!result.ok) return result;
    const { reference, ...rest } = result.data;
    const stored = result.data.plans.plans.find((candidate) => candidate.id === reference);
    return stored ? ok({ ...rest, plan: stored }) : failure(NOT_FOUND);
  });
}

/**
 * Schedule a plan's next included visit as a real Booking, atomically: the booking is made (the same rules as any booking) and the
 * visit is linked to it and becomes scheduled, or neither happens. Answers with the plans AND the operations, since both changed.
 */
export async function scheduleVisitAction(planReference: unknown, visitReference: unknown, input: unknown): Promise<ActionResult<Answer & { operations: OperationsData; booking: Booking }>> {
  return mutate(async (work) => {
    const number = await scheduleVisitTx(work, valid(parseScheduleVisit(planReference, visitReference, input)));
    return { operations: await loadOperations(work.tx, work.organizationId, work.timeZone, work.refs), bookingReference: bookingReference(number) };
  }).then((result) => {
    if (!result.ok) return result;
    const { bookingReference: reference, ...rest } = result.data;
    const stored = result.data.operations.bookings.find((candidate) => candidate.id === reference);
    return stored ? ok({ ...rest, booking: stored }) : failure(NOT_FOUND);
  });
}
