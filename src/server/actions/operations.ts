"use server";

import { and, eq } from "drizzle-orm";
import { PROTOTYPE_NOW } from "@/data/fixtures";
import type { Booking, Job, OperationsData } from "@/data/operations";
import type { WeeklyHours } from "@/data/settings";
import { loadServices } from "@/db/core-queries";
import type { Tx } from "@/db/index";
import { allocateBookingNumber, allocateJobNumber, loadOperations, loadRefs, lockRecords, type Refs } from "@/db/ops-queries";
import { bookings, jobFiles, jobs, teamMembers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { NOT_ALLOWED_OPERATIONS, NOT_FOUND, failure, ok, type ActionResult } from "@/lib/action-result";
import { stampInstant, type BusinessClock } from "@/lib/business-time";
import {
  assignBookingError,
  assignJobError,
  assignableError,
  bookingReference,
  cancelError,
  completeJobError,
  confirmError,
  createJobError,
  detailsError,
  initialBookingStatus,
  jobReference,
  numberOf,
  parseCompletionNotes,
  parseDetailsPatch,
  parseNewBooking,
  parseReason,
  RESERVED_BOOKING_NUMBERS,
  slotError,
  slugOf,
  startJobError,
  type DetailsPatch,
} from "@/lib/operations-rules";
import { isRecord, type Parsed } from "@/lib/validation";
import { authorize } from "../authorize";
import { isIntegrityViolation, uniqueViolationOf } from "../db-errors";

/**
 * Operations writes: Bookings, Jobs, assignments and file visibility. Each action:
 *   1. resolves the caller and their active organization from the session and a verified membership,
 *   2. requires the "operations:manage" capability (owner or admin),
 *   3. only then reads its arguments, and parses and validates them again (the screen's checks are a convenience, these are the
 *      enforcement), so someone who is not signed in learns nothing about what a valid request looks like,
 *   4. opens a tenant transaction, so Row Level Security checks the same rules a second time, locks the records it changes,
 *      checks that every record it names belongs to THIS business, checks the change is one the record may make now,
 *   5. writes, reads the business's operations back and answers with them, so the screen shows exactly what is stored.
 * No argument names an organization. A refusal at any point rolls the whole change back, so nothing is half done, and a
 * number taken for a booking is given back.
 */

/** A change the rules refuse: the message is for the person; the transaction rolls back. */
class Refusal extends Error {
  constructor(
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

const refuse = (message: string, fields?: Record<string, string>): never => {
  throw new Refusal(message, fields);
};

/** The value of a parsed argument, or a refusal that says what was wrong with it. */
function valid<T>(parsed: Parsed<T>): T {
  return parsed.ok ? parsed.value : refuse(parsed.error, parsed.fields);
}

/** The number in a display reference like "BK-1042", or "no such record": an unreadable reference names nothing. */
function reference(prefix: "BK" | "JB", value: unknown): number {
  return numberOf(prefix, value) ?? refuse(NOT_FOUND);
}

const GONE_BOOKING = "That booking no longer exists. Reload the page and try again.";
const GONE_JOB = "That job no longer exists. Reload the page and try again.";

type Answer = { operations: OperationsData };

type Work = {
  tx: Tx;
  organizationId: string;
  timeZone: string;
  refs: Refs;
  hours: WeeklyHours;
  clock: BusinessClock;
  /** The sample business: the only one that holds booking numbers back for its sample records. */
  sample: boolean;
  /** The instant a system event (confirmed, completed …) happening now is stamped with. */
  stamp: Date;
};

function translate(error: unknown): ReturnType<typeof failure> {
  if (error instanceof Refusal) return failure(error.message, error.fields);
  const constraint = uniqueViolationOf(error);
  if (constraint === "jobs_org_booking_unique") return failure("That booking already has a job.");
  if (constraint) return failure("Someone changed this at the same moment. Reload the page and try again.");
  if (isIntegrityViolation(error)) return failure("The change breaks a rule, so it was not saved. Reload the page and try again.");
  console.error("[operations] could not save:", error instanceof Error ? error.message : error);
  return failure("The change could not be saved. Try again.");
}

/** Authorize, open the tenant transaction, run the change, and answer with the operations as stored. */
async function mutate<T extends object = object>(change: (work: Work) => Promise<T>): Promise<ActionResult<Answer & T>> {
  const auth = await authorize("operations:manage", NOT_ALLOWED_OPERATIONS);
  if (!auth.ok) return auth.result;
  const { userId, organizationId, organization, snapshot } = auth.context;
  try {
    return await withTenant({ userId, organizationId }, async (tx) => {
      const refs = await loadRefs(tx, organizationId);
      const timeZone = organization.timezone;
      const extra = await change({
        tx,
        organizationId,
        timeZone,
        refs,
        hours: snapshot.settings.hours,
        clock: snapshot.clock,
        sample: snapshot.hasSampleData,
        stamp: stampInstant(snapshot.hasSampleData, timeZone, PROTOTYPE_NOW),
      });
      return ok({ operations: await loadOperations(tx, organizationId, timeZone, refs), ...extra });
    });
  } catch (error) {
    return translate(error);
  }
}

/** The team member with this slug, if this business has one. */
async function findMember(tx: Tx, organizationId: string, slug: string) {
  const rows = await tx.select().from(teamMembers).where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.slug, slug))).limit(1);
  return rows[0];
}

/* ───────────────────────── bookings ───────────────────────── */

export async function createBookingAction(input: unknown): Promise<ActionResult<Answer & { booking: Booking }>> {
  return mutate(async ({ tx, organizationId, timeZone, refs, hours, clock, sample, stamp }) => {
    const booking = valid(parseNewBooking(input));

    let customerId: string | null = null;
    let propertyId: string | null = null;
    if (booking.customerId) {
      customerId = refs.idBySlug.customers.get(booking.customerId) ?? null;
      if (!customerId) refuse("That customer is not in your customers any more. Choose another or reload the page.");
      if (booking.propertyId) {
        propertyId = refs.idBySlug.properties.get(booking.propertyId) ?? null;
        if (!propertyId || refs.propertyOwner.get(propertyId) !== customerId) refuse("That property doesn't belong to this customer.");
      }
    }

    const service = (await loadServices(tx, organizationId)).find((candidate) => candidate.id === booking.serviceId);
    if (!service) return refuse("That service is not in your catalog any more. Choose another or reload the page.");
    if (!service.active) refuse("That service is switched off, so it can't be booked.");
    if (booking.source === "Website" || booking.source === "Booking link" || booking.source === "Marketplace") {
      if (service.visibility !== "public-booking") refuse("That service isn't offered for online booking.");
    }

    let assigneeId: string | null = null;
    if (booking.assigneeId) {
      const member = await findMember(tx, organizationId, booking.assigneeId);
      const problem = assignableError(member);
      if (problem) refuse(problem);
      assigneeId = member!.id;
    }

    const timeProblem = slotError(booking.date, booking.start, booking.end, hours, clock.today);
    if (timeProblem) refuse(timeProblem, { slot: timeProblem });

    const status = initialBookingStatus(booking.source, service.bookingMethod);
    const number = await allocateBookingNumber(tx, organizationId, sample ? RESERVED_BOOKING_NUMBERS : {}, booking.planVisit?.visitId);
    await tx.insert(bookings).values({
      organizationId,
      number,
      customerId,
      propertyId,
      serviceId: refs.idBySlug.services.get(service.id)!,
      assigneeId,
      contactName: customerId ? null : (booking.contactName ?? null),
      contactPhone: customerId ? null : (booking.contact?.phone ?? null),
      contactEmail: customerId ? null : (booking.contact?.email ?? null),
      contactAddress: customerId ? null : (booking.contact?.address ?? null),
      source: booking.source,
      status,
      serviceDate: booking.date,
      startTime: booking.start,
      endTime: booking.end,
      note: booking.note ?? null,
      intakeSystemType: booking.intake?.systemType ?? null,
      intakeEquipment: booking.intake?.equipment ?? null,
      intakeReportedIssue: booking.intake?.reportedIssue ?? null,
      internalNotes: booking.internalNotes ?? null,
      planId: booking.planVisit?.planId ?? null,
      planVisitId: booking.planVisit?.visitId ?? null,
      receivedAt: stamp,
      confirmedAt: status === "confirmed" ? stamp : null,
    });
    // The booking as the screens use it, read back.
    const stored = (await loadOperations(tx, organizationId, timeZone, refs)).bookings.find((candidate) => candidate.id === bookingReference(number));
    return { booking: stored! };
  });
}

export async function confirmBookingAction(bookingRef: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, stamp }) => {
    const records = await lockRecords(tx, organizationId, { bookingNumber: reference("BK", bookingRef) });
    const booking = records?.booking;
    if (!booking) return refuse(GONE_BOOKING);
    const problem = confirmError({ status: booking.status as Booking["status"] });
    if (problem) refuse(problem);
    await tx.update(bookings).set({ status: "confirmed", confirmedAt: stamp }).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, booking.id)));
    return {};
  });
}

/** Declines a pending request or cancels a confirmed booking. The reason is required. */
export async function cancelBookingAction(bookingRef: unknown, reason: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId }) => {
    const number = reference("BK", bookingRef);
    const why = valid(parseReason(reason));
    const records = await lockRecords(tx, organizationId, { bookingNumber: number });
    const booking = records?.booking;
    if (!booking) return refuse(GONE_BOOKING);
    const problem = cancelError({ status: booking.status as Booking["status"], jobId: records.job ? jobReference(records.job.number) : undefined });
    if (problem) refuse(problem);
    await tx
      .update(bookings)
      .set({ status: "cancelled", cancellationReason: why })
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, booking.id)));
    return {};
  });
}

/* ───────────────────────── assignment ───────────────────────── */

/**
 * Give work to a team member, or take it back (`null`). The booking and its job always agree: whichever is named, both are
 * changed in the same transaction, so Bookings, the Schedule and Jobs can never show different technicians.
 */
export async function assignAction(target: unknown, member: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId }) => {
    if (!isRecord(target)) return refuse("That assignment was not understood.");
    const bookingNumber = target.bookingId === undefined ? undefined : reference("BK", target.bookingId);
    const jobNumber = target.jobId === undefined ? undefined : reference("JB", target.jobId);
    if (bookingNumber === undefined && jobNumber === undefined) return refuse("That assignment was not understood.");
    const memberSlug = member === null ? null : (slugOf(member) ?? refuse("That assignment was not understood."));

    const records = await lockRecords(tx, organizationId, { bookingNumber, jobNumber });
    if (!records || (!records.booking && !records.job)) return refuse(jobNumber !== undefined ? GONE_JOB : GONE_BOOKING);
    const { booking, job } = records;
    const problem = (booking && assignBookingError({ status: booking.status as Booking["status"] })) || (job && assignJobError({ status: job.status as Job["status"] }));
    if (problem) refuse(problem);

    let assigneeId: string | null = null;
    if (memberSlug !== null) {
      const found = await findMember(tx, organizationId, memberSlug);
      const unavailable = assignableError(found);
      if (unavailable) refuse(unavailable);
      assigneeId = found!.id;
    }
    if (booking) await tx.update(bookings).set({ assigneeId }).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, booking.id)));
    if (job) await tx.update(jobs).set({ assigneeId }).where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, job.id)));
    return {};
  });
}

/* ───────────────────────── jobs ───────────────────────── */

/** Create the job for a confirmed booking that doesn't have one. At most one job exists per booking (the database holds it too). */
export async function createJobAction(bookingRef: unknown): Promise<ActionResult<Answer & { job: Job }>> {
  return mutate(async ({ tx, organizationId, timeZone, refs }) => {
    const records = await lockRecords(tx, organizationId, { bookingNumber: reference("BK", bookingRef) });
    const booking = records?.booking;
    if (!booking) return refuse(GONE_BOOKING);
    const problem = createJobError({ status: booking.status as Booking["status"], jobId: records.job ? jobReference(records.job.number) : undefined });
    if (problem) refuse(problem);

    const jobNumber = await allocateJobNumber(tx, organizationId);
    await tx.insert(jobs).values({
      organizationId,
      number: jobNumber,
      bookingId: booking.id,
      customerId: booking.customerId,
      propertyId: booking.propertyId,
      serviceId: booking.serviceId,
      assigneeId: booking.assigneeId,
      contactName: booking.contactName,
      status: "scheduled",
      serviceDate: booking.serviceDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      note: booking.note,
    });
    const stored = (await loadOperations(tx, organizationId, timeZone, refs)).jobs.find((candidate) => candidate.id === jobReference(jobNumber));
    return { job: stored! };
  });
}

export async function startJobAction(jobRef: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId }) => {
    const records = await lockRecords(tx, organizationId, { jobNumber: reference("JB", jobRef) });
    const job = records?.job;
    if (!job) return refuse(GONE_JOB);
    const problem = startJobError({ status: job.status as Job["status"] });
    if (problem) refuse(problem);
    await tx.update(jobs).set({ status: "in-progress" }).where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, job.id)));
    return {};
  });
}

/** The columns the editable work details live in. Only these four can ever be written through this action. */
const detailColumns = (patch: DetailsPatch) => ({
  ...(patch.technicianDiagnosis !== undefined ? { technicianDiagnosis: patch.technicianDiagnosis } : {}),
  ...(patch.workPerformed !== undefined ? { workPerformed: patch.workPerformed } : {}),
  ...(patch.customerSummary !== undefined ? { customerSummary: patch.customerSummary } : {}),
  ...(patch.internalNotes !== undefined ? { internalNotes: patch.internalNotes } : {}),
});

export async function updateJobDetailsAction(jobRef: unknown, patch: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId }) => {
    const number = reference("JB", jobRef);
    const columns = detailColumns(valid(parseDetailsPatch(patch)));
    const records = await lockRecords(tx, organizationId, { jobNumber: number });
    const job = records?.job;
    if (!job) return refuse(GONE_JOB);
    const problem = detailsError({ status: job.status as Job["status"] });
    if (problem) refuse(problem);
    if (Object.keys(columns).length > 0) await tx.update(jobs).set(columns).where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, job.id)));
    return {};
  });
}

/**
 * Completing a job is one atomic change: the job becomes Completed with its notes and time, any work details the technician
 * had not yet saved are kept with it, and the booking it came from becomes Completed. It creates no quote, invoice or payment.
 */
export async function completeJobAction(jobRef: unknown, notes: unknown, details?: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId, stamp }) => {
    const number = reference("JB", jobRef);
    const completionNotes = valid(parseCompletionNotes(notes));
    const columns = details === undefined ? {} : detailColumns(valid(parseDetailsPatch(details)));
    const records = await lockRecords(tx, organizationId, { jobNumber: number });
    const job = records?.job;
    if (!job) return refuse(GONE_JOB);
    const problem = completeJobError({ status: job.status as Job["status"] });
    if (problem) refuse(problem);
    await tx
      .update(jobs)
      .set({ ...columns, status: "completed", completionNotes, completedAt: stamp })
      .where(and(eq(jobs.organizationId, organizationId), eq(jobs.id, job.id)));
    if (records.booking && records.booking.status === "confirmed") {
      await tx.update(bookings).set({ status: "completed" }).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, records.booking.id)));
    }
    return {};
  });
}

/** Whether a stored photo is shown to the customer. (This changes the stored record; the file itself is not in the database.) */
export async function setFileVisibilityAction(jobRef: unknown, fileRef: unknown, visibility: unknown): Promise<ActionResult<Answer>> {
  return mutate(async ({ tx, organizationId }) => {
    const number = reference("JB", jobRef);
    if (typeof fileRef !== "string" || fileRef.length > 100) return refuse(NOT_FOUND);
    if (visibility !== "customer" && visibility !== "internal") return refuse("That visibility was not understood.");
    const records = await lockRecords(tx, organizationId, { jobNumber: number });
    const job = records?.job;
    if (!job) return refuse(GONE_JOB);
    const problem = detailsError({ status: job.status as Job["status"] });
    if (problem) refuse(problem);
    const changed = await tx
      .update(jobFiles)
      .set({ visibility })
      .where(and(eq(jobFiles.organizationId, organizationId), eq(jobFiles.jobId, job.id), eq(jobFiles.ref, fileRef)))
      .returning({ id: jobFiles.id });
    if (changed.length === 0) return refuse("That file no longer exists. Reload the page and try again.");
    return {};
  });
}
