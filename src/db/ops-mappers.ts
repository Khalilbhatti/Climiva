/**
 * Operations: rows <-> the shapes the screens already use.
 *
 * The UI types (Booking, Job, JobFile, ScheduleBlock) predate the database and stay as they are; this file is the only place
 * that knows how they map to columns. A record's `id` in the UI is its display number ("BK-1042", "JB-204"); the people and
 * things it points at are their slugs (customers, properties, services, team members, equipment). The database uuids never
 * leave the server. Appointments are local dates and times and cross unchanged; the instants (received, confirmed,
 * completed) are written out in the organization's time zone here, on the server, so no browser ever parses a date.
 *
 * No `server-only` here on purpose: the seed and the tests import it too.
 */
import type { Booking, BookingIntake, BookingSource, BookingStatus, ChecklistItem, FileCategory, Job, JobDetails, JobFile, JobStatus, ScheduleBlock } from "@/data/operations";
import { instantToLocal } from "@/lib/business-time";
import { bookingReference, jobReference } from "@/lib/operations-rules";
import { hhmm } from "./core-mappers";
import type { BookingRow, JobFileRow, JobRow, ScheduleBlockRow } from "./schema";

const orUndefined = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);

/** Display slugs of the records a booking or job points at, keyed by database id. */
export type SlugLookup = {
  customers: ReadonlyMap<string, string>;
  properties: ReadonlyMap<string, string>;
  services: ReadonlyMap<string, string>;
  members: ReadonlyMap<string, string>;
  equipment: ReadonlyMap<string, string>;
};

/**
 * `planVisit` is the Maintenance Plan visit this booking schedules, when it schedules one. The link is stored on the VISIT (the one
 * place it lives), so it arrives here already resolved to the plan's and the visit's references.
 */
export function bookingFromRow(
  row: BookingRow,
  slugs: SlugLookup,
  jobNumber: number | undefined,
  timeZone: string,
  planVisit?: { planId: string; visitId: string },
): Booking {
  const intake: BookingIntake = {
    systemType: orUndefined(row.intakeSystemType),
    equipment: orUndefined(row.intakeEquipment),
    reportedIssue: orUndefined(row.intakeReportedIssue),
  };
  const hasIntake = Object.values(intake).some((value) => value !== undefined);
  const contact = { phone: orUndefined(row.contactPhone), email: orUndefined(row.contactEmail), address: orUndefined(row.contactAddress) };
  const hasContact = Object.values(contact).some((value) => value !== undefined);
  return {
    id: bookingReference(row.number),
    customerId: row.customerId ? slugs.customers.get(row.customerId) : undefined,
    contactName: orUndefined(row.contactName),
    propertyId: row.propertyId ? slugs.properties.get(row.propertyId) : undefined,
    serviceId: slugs.services.get(row.serviceId) ?? "",
    date: row.serviceDate,
    start: hhmm(row.startTime) ?? "",
    end: hhmm(row.endTime) ?? "",
    status: row.status as BookingStatus,
    assigneeId: row.assigneeId ? slugs.members.get(row.assigneeId) : undefined,
    source: orUndefined(row.source) as BookingSource | undefined,
    receivedAt: row.receivedAt ? instantToLocal(row.receivedAt, timeZone) : undefined,
    confirmedAt: row.confirmedAt ? instantToLocal(row.confirmedAt, timeZone) : undefined,
    note: orUndefined(row.note),
    intake: hasIntake ? intake : undefined,
    internalNotes: orUndefined(row.internalNotes),
    jobId: jobNumber === undefined ? undefined : jobReference(jobNumber),
    cancellation: row.cancellationReason ? { reason: row.cancellationReason } : undefined,
    contact: hasContact ? contact : undefined,
    planVisit,
  };
}

export function jobFileFromRow(row: JobFileRow): JobFile {
  return {
    id: row.ref,
    name: row.name,
    sizeKb: row.sizeKb,
    category: orUndefined(row.category) as FileCategory | undefined,
    caption: orUndefined(row.caption),
    takenAt: hhmm(row.takenAt),
    visibility: row.visibility as JobFile["visibility"],
    badge: orUndefined(row.badge),
  };
}

export function jobFromRow(row: JobRow, slugs: SlugLookup, bookingNumber: number | undefined, files: readonly JobFileRow[], timeZone: string): Job {
  const details: JobDetails = {
    technicianDiagnosis: orUndefined(row.technicianDiagnosis),
    workPerformed: orUndefined(row.workPerformed),
    customerSummary: orUndefined(row.customerSummary),
    internalNotes: orUndefined(row.internalNotes),
    customerRequest: orUndefined(row.customerRequest),
    safetyNote: orUndefined(row.safetyNote),
    checklist: (row.checklist as readonly ChecklistItem[] | null) ?? undefined,
  };
  return {
    id: jobReference(row.number),
    bookingId: bookingNumber === undefined ? undefined : bookingReference(bookingNumber),
    customerId: row.customerId ? slugs.customers.get(row.customerId) : undefined,
    contactName: orUndefined(row.contactName),
    propertyId: row.propertyId ? slugs.properties.get(row.propertyId) : undefined,
    serviceId: slugs.services.get(row.serviceId) ?? "",
    assigneeId: row.assigneeId ? slugs.members.get(row.assigneeId) : undefined,
    date: row.serviceDate,
    start: hhmm(row.startTime) ?? "",
    end: hhmm(row.endTime) ?? "",
    status: row.status as JobStatus,
    workSummary: orUndefined(row.workSummary),
    equipmentId: row.equipmentId ? slugs.equipment.get(row.equipmentId) : undefined,
    note: orUndefined(row.note),
    details,
    files: files.map(jobFileFromRow),
    completion: row.completedAt && row.completionNotes !== null ? { notes: row.completionNotes, at: instantToLocal(row.completedAt, timeZone) } : undefined,
  };
}

export function blockFromRow(row: ScheduleBlockRow, memberSlugs: readonly string[]): ScheduleBlock {
  return { id: row.ref, date: row.serviceDate, start: hhmm(row.startTime) ?? "", end: hhmm(row.endTime) ?? "", title: row.title, memberIds: memberSlugs };
}
