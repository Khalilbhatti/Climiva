/**
 * Creating one Booking inside an open tenant transaction: the rules a new booking must meet and the insert.
 *
 * The Bookings screens (createBookingAction) and a Maintenance Plan visit being scheduled (scheduleVisitAction) both create a
 * Booking, and both must make the SAME booking: the same validation, the same numbering, the same stored columns. So the work
 * lives here once. A refusal throws a Refusal, which rolls the whole transaction back, so a booking made for a visit that then
 * fails is never left behind.
 *
 * No `server-only` import on purpose (the data layer is shared with scripts and tests); nothing under src/ that is a Client
 * Component may import this file (a test enforces it).
 */
import { and, eq } from "drizzle-orm";
import type { WeeklyHours } from "@/data/settings";
import type { BusinessClock } from "@/lib/business-time";
import { assignableError, initialBookingStatus, slotError, type NewBookingInput } from "@/lib/operations-rules";
import { refuse } from "@/lib/refusal";
import { loadServices } from "./core-queries";
import type { Tx } from "./index";
import { allocateBookingNumber, type Refs } from "./ops-queries";
import { bookings, teamMembers } from "./schema";

export type BookingWork = {
  tx: Tx;
  organizationId: string;
  refs: Refs;
  hours: WeeklyHours;
  clock: BusinessClock;
  /** The instant a system event happening now is stamped with. */
  stamp: Date;
};

/** The team member with this slug, if this business has one. */
export async function findMember(tx: Tx, organizationId: string, slug: string) {
  const rows = await tx.select().from(teamMembers).where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.slug, slug))).limit(1);
  return rows[0];
}

/**
 * Validate and store a booking, returning its id and number. Every reference it names (customer, property, Service, assignee) is
 * resolved inside THIS business; one that belongs to another business is indistinguishable from one that never existed.
 */
export async function insertBookingTx(work: BookingWork, booking: NewBookingInput): Promise<{ id: string; number: number }> {
  const { tx, organizationId, refs, hours, clock, stamp } = work;

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
  const number = await allocateBookingNumber(tx, organizationId);
  const [row] = await tx
    .insert(bookings)
    .values({
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
      receivedAt: stamp,
      confirmedAt: status === "confirmed" ? stamp : null,
    })
    .returning({ id: bookings.id });
  return { id: row.id, number };
}
