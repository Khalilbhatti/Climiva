/**
 * What a browser may ask of Bookings and Jobs, and what state each may be in when it does: the rules, checked on the
 * server. Pure functions: no database, no framework. The server actions call these before they write, and the database
 * holds the same status changes again (guards in the operations RLS migration), so a forged request cannot do what a
 * screen would never offer.
 *
 * These check SHAPE and the rules that need only the record in hand. The rules that depend on the business's other records
 * (the Customer exists and owns the Property, the Team member is active) are checked by the action against the data it
 * loads under the verified organization.
 */
import {
  BOOKING_SOURCES,
  type Booking,
  type BookingIntake,
  type BookingSource,
  type BookingStatus,
  type Job,
  type JobDetails,
} from "@/data/operations";
import type { BookingMethod } from "@/data/services";
import type { WeeklyHours } from "@/data/settings";
import { isValidDate, timeToMinutes, weekdayIndex } from "./dates";
import { isRecord, text, type Parsed } from "./validation";

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

/**
 * Booking numbers held for one maintenance plan visit, keyed by the visit's id. Sarah Mitchell's included cooling visit is
 * #BK-1048: it gets that number whenever it is scheduled, and no other booking is given it first.
 */
export const RESERVED_BOOKING_NUMBERS: Readonly<Record<string, number>> = { "plan-sarah-comfort-care-v2": 1048 };

/* ───────────────────────── identifiers ───────────────────────── */

const REFERENCE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "BK-1042" → 1042; anything else → undefined. */
export function numberOf(prefix: "BK" | "JB", reference: unknown): number | undefined {
  if (typeof reference !== "string") return undefined;
  const match = new RegExp(`^${prefix}-(\\d{1,9})$`).exec(reference);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

export const bookingReference = (number: number) => `BK-${number}`;
export const jobReference = (number: number) => `JB-${number}`;

/** A slug of a customer, property, service or team member. */
export function slugOf(value: unknown): string | undefined {
  return typeof value === "string" && REFERENCE.test(value) ? value : undefined;
}

/* ───────────────────────── creating a booking ───────────────────────── */

/** Sources a customer's own request arrives through: such a booking waits for confirmation unless the Service books instantly. */
const CUSTOMER_FACING_SOURCES: readonly BookingSource[] = ["Website", "Booking link", "Marketplace"];

/**
 * A booking entered by staff, or scheduled for a plan, is confirmed straight away: they are agreeing the time with the
 * customer. A request that came in through a customer-facing channel is confirmed only when the Service books instantly,
 * and is otherwise pending until someone confirms it.
 */
export function initialBookingStatus(source: BookingSource, method: BookingMethod): Extract<BookingStatus, "pending" | "confirmed"> {
  if (!CUSTOMER_FACING_SOURCES.includes(source)) return "confirmed";
  return method === "instant" ? "confirmed" : "pending";
}

export type NewBookingInput = {
  /** Exactly one of customerId / contactName: a person without a Customers record is a name. */
  customerId?: string;
  contactName?: string;
  contact?: { phone?: string; email?: string; address?: string };
  propertyId?: string;
  serviceId: string;
  source: BookingSource;
  date: string;
  start: string;
  end: string;
  assigneeId?: string;
  internalNotes?: string;
  intake?: BookingIntake;
  note?: string;
  planVisit?: { planId: string; visitId: string };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const trimmed = text(value, max)?.trim();
  return trimmed === undefined ? null : trimmed || undefined;
}

export function parseNewBooking(input: unknown): Parsed<NewBookingInput> {
  if (!isRecord(input)) return fail("The booking details were not understood.");
  const serviceId = slugOf(input.serviceId);
  const source = BOOKING_SOURCES.find((candidate) => candidate === input.source);
  const date = typeof input.date === "string" && isValidDate(input.date) ? input.date : undefined;
  const start = typeof input.start === "string" && CLOCK.test(input.start) ? input.start : undefined;
  const end = typeof input.end === "string" && CLOCK.test(input.end) ? input.end : undefined;
  if (!serviceId || !source || !date || !start || !end) return fail("The booking details were not understood.");
  if (timeToMinutes(end) <= timeToMinutes(start)) return fail("The booking has to end after it starts.");

  const customerId = input.customerId === undefined ? undefined : slugOf(input.customerId);
  const propertyId = input.propertyId === undefined ? undefined : slugOf(input.propertyId);
  const assigneeId = input.assigneeId === undefined ? undefined : slugOf(input.assigneeId);
  if ((input.customerId !== undefined && !customerId) || (input.propertyId !== undefined && !propertyId) || (input.assigneeId !== undefined && !assigneeId)) {
    return fail("The booking details were not understood.");
  }

  const contactName = optionalText(input.contactName, 200);
  const internalNotes = optionalText(input.internalNotes, 2000);
  const note = optionalText(input.note, 1000);
  if (contactName === null || internalNotes === null || note === null) return fail("The booking details were not understood.");
  if (Boolean(customerId) === Boolean(contactName)) return fail("Choose a customer, or enter the name of the person the booking is for.");
  if (contactName && contactName.length > 80) return fail("Keep the name to 80 characters or fewer.");
  if (propertyId && !customerId) return fail("A property belongs to a customer.");

  let contact: NewBookingInput["contact"];
  if (input.contact !== undefined) {
    if (!isRecord(input.contact)) return fail("The booking details were not understood.");
    if (customerId) return fail("A customer's contact details come from their record.");
    const phone = optionalText(input.contact.phone, 60);
    const email = optionalText(input.contact.email, 200);
    const address = optionalText(input.contact.address, 300);
    if (phone === null || email === null || address === null) return fail("The booking details were not understood.");
    if (email && !EMAIL.test(email)) return fail("Enter a valid email address, like name@example.com.");
    contact = phone || email || address ? { phone, email, address } : undefined;
  }

  let intake: BookingIntake | undefined;
  if (input.intake !== undefined) {
    if (!isRecord(input.intake)) return fail("The booking details were not understood.");
    const systemType = optionalText(input.intake.systemType, 200);
    const equipment = optionalText(input.intake.equipment, 200);
    const reportedIssue = optionalText(input.intake.reportedIssue, 2000);
    if (systemType === null || equipment === null || reportedIssue === null) return fail("The booking details were not understood.");
    intake = systemType || equipment || reportedIssue ? { systemType, equipment, reportedIssue } : undefined;
  }

  let planVisit: NewBookingInput["planVisit"];
  if (input.planVisit !== undefined) {
    if (!isRecord(input.planVisit)) return fail("The booking details were not understood.");
    const planId = text(input.planVisit.planId, 120);
    const visitId = text(input.planVisit.visitId, 160);
    if (!planId || !visitId) return fail("The booking details were not understood.");
    planVisit = { planId, visitId };
  }

  return { ok: true, value: { customerId, contactName, contact, propertyId, serviceId, source, date, start, end, assigneeId, internalNotes, intake, note, planVisit } };
}

/**
 * Is this a time the business can be booked at? A date that has already passed, a day the business is closed and a time
 * outside the saved hours are refused. (What each Service's booking method offers inside those hours is the screen's
 * convenience; the hours are the rule.)
 */
export function slotError(date: string, start: string, end: string, hours: WeeklyHours, today: string): string | undefined {
  if (date < today) return "That date has already passed.";
  const open = hours[weekdayIndex(date)];
  if (!open) return "The business is closed on that day.";
  if (timeToMinutes(start) < timeToMinutes(open.open) || timeToMinutes(end) > timeToMinutes(open.close)) return "That time is outside the business hours.";
  return undefined;
}

/* ───────────────────────── changing a booking ───────────────────────── */

export function confirmError(booking: Pick<Booking, "status">): string | undefined {
  if (booking.status === "confirmed") return "That booking is already confirmed.";
  if (booking.status !== "pending") return `A ${booking.status} booking can't be confirmed.`;
  return undefined;
}

/** Declining a request and cancelling a booking are one change. A booking that already has a job can't be cancelled. */
export function cancelError(booking: Pick<Booking, "status" | "jobId">): string | undefined {
  if (booking.status === "cancelled") return "That booking is already cancelled.";
  if (booking.status === "completed") return "A completed booking can't be cancelled.";
  if (booking.jobId) return `Booking has a job (#${booking.jobId}), so it can't be cancelled.`;
  return undefined;
}

export function assignBookingError(booking: Pick<Booking, "status">): string | undefined {
  if (booking.status === "pending") return "Confirm the request before assigning a technician.";
  if (booking.status === "completed" || booking.status === "cancelled") return `A ${booking.status} booking can't be reassigned.`;
  return undefined;
}

export function createJobError(booking: Pick<Booking, "status" | "jobId">): string | undefined {
  if (booking.jobId) return `That booking already has a job (#${booking.jobId}).`;
  if (booking.status !== "confirmed") return "A job is created from a confirmed booking.";
  return undefined;
}

/* ───────────────────────── changing a job ───────────────────────── */

export function assignJobError(job: Pick<Job, "status">): string | undefined {
  return job.status === "completed" ? "A completed job can't be reassigned." : undefined;
}

export function startJobError(job: Pick<Job, "status">): string | undefined {
  if (job.status === "in-progress") return "That job has already started.";
  if (job.status === "completed") return "A completed job can't be started again.";
  return undefined;
}

export function completeJobError(job: Pick<Job, "status">): string | undefined {
  if (job.status === "completed") return "That job is already completed.";
  if (job.status === "scheduled") return "Start the job before completing it.";
  return undefined;
}

export function detailsError(job: Pick<Job, "status">): string | undefined {
  return job.status === "completed" ? "A completed job is final: its work details can't be changed." : undefined;
}

/** The work details a technician edits on a Job. Everything else on a job is read-only. */
export const EDITABLE_DETAIL_KEYS = ["technicianDiagnosis", "workPerformed", "customerSummary", "internalNotes"] as const;
export type DetailsPatch = Partial<Pick<JobDetails, (typeof EDITABLE_DETAIL_KEYS)[number]>>;

export const MAX_DETAIL_LENGTH = 10_000;

export function parseDetailsPatch(input: unknown): Parsed<DetailsPatch> {
  if (!isRecord(input)) return fail("The work details were not understood.");
  const patch: DetailsPatch = {};
  for (const key of Object.keys(input)) {
    if (!(EDITABLE_DETAIL_KEYS as readonly string[]).includes(key)) return fail("The work details were not understood.");
  }
  for (const key of EDITABLE_DETAIL_KEYS) {
    if (input[key] === undefined) continue;
    const value = text(input[key], MAX_DETAIL_LENGTH);
    if (value === undefined) return fail("Keep each work detail under 10,000 characters.");
    patch[key] = value;
  }
  return { ok: true, value: patch };
}

export function parseReason(input: unknown): Parsed<string> {
  const value = text(input, 1000)?.trim();
  if (value === undefined) return fail("Keep the reason under 1,000 characters.", { reason: "Keep the reason under 1,000 characters." });
  if (!value) return fail("Enter a reason.", { reason: "Enter a reason." });
  return { ok: true, value };
}

export function parseCompletionNotes(input: unknown): Parsed<string> {
  const value = text(input, MAX_DETAIL_LENGTH)?.trim();
  if (value === undefined) return fail("Keep the resolution notes under 10,000 characters.", { notes: "Keep the resolution notes under 10,000 characters." });
  if (!value) return fail("Enter the resolution notes.", { notes: "Enter the resolution notes." });
  return { ok: true, value };
}

/** Who can be given work: active and field-assignable. A deactivated member still shows on past records but gets nothing new. */
export function assignableError(member: { status: string; fieldAssignable: boolean } | undefined): string | undefined {
  if (!member) return "That team member isn't on your team.";
  if (member.status !== "active" || !member.fieldAssignable) return "That team member can't be given new work.";
  return undefined;
}
