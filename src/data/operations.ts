/**
 * Operational records: Bookings, Jobs and Schedule blocks. The types, the pure selectors and the labels.
 *
 * The records themselves live in PostgreSQL, per organization, and reach the browser for the ACTIVE organization only
 * (src/db/ops-queries, components/operations/OperationsProvider). The canonical Apex Climate records are seed data
 * (scripts/db/seed-data/operations.ts) and ship to no browser. A booking and its job reference the Customers, Properties,
 * Services and Team by their public references (slugs); the Schedule has no events of its own, it is derived from bookings
 * and jobs (plus the internal blocks). Nothing here repeats a customer, service or technician name: those are looked up.
 *
 *  - Dates and times are business-local (the organization's time zone) wall-clock values and are never converted in the
 *    browser; see lib/business-time and docs/saas-architecture.md.
 *  - Statuses are the locked sets: bookings (pending, confirmed, completed, cancelled) and jobs (scheduled, in-progress,
 *    completed). Stitch's "En route", "Waiting – parts", "Needs assignment" and "Needs customer response" are not statuses
 *    here; "needs assignment" is simply "no assignee".
 *  - People without a Customers record (requesters and one-off visits) are carried as a snapshot `contactName` only.
 */
import { getCustomerById } from "./customers";
import type { Directory } from "./directory";
import { getServiceById } from "./services";
import { getTeamMemberById } from "./team";

/* ───────────────────────── types ───────────────────────── */

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type JobStatus = "scheduled" | "in-progress" | "completed";

export const BOOKING_SOURCES = [
  "Website",
  "Booking link",
  "Marketplace",
  "Maintenance plan",
  "Phone / Front desk",
  "Email",
  "Walk-in",
  "Other",
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/** Sources a staff member can pick when entering a booking by hand. */
export const OFFLINE_BOOKING_SOURCES: readonly BookingSource[] = ["Phone / Front desk", "Email", "Walk-in", "Other"];

export type BookingIntake = {
  systemType?: string;
  equipment?: string;
  reportedIssue?: string;
};

export type Booking = {
  /** "BK-1042" */
  id: string;
  /** Exactly one of customerId / contactName is set. */
  customerId?: string;
  /** Snapshot for a requester who has no Customers record yet. */
  contactName?: string;
  propertyId?: string;
  serviceId: string;
  /** "2024-10-25", business-local */
  date: string;
  /** "10:00", business-local */
  start: string;
  end: string;
  status: BookingStatus;
  assigneeId?: string;
  source?: BookingSource;
  /** "2024-10-24T09:42", business-local */
  receivedAt?: string;
  confirmedAt?: string;
  /** Short customer note shown under the service in the list. */
  note?: string;
  intake?: BookingIntake;
  internalNotes?: string;
  jobId?: string;
  cancellation?: { reason: string };
  /** Contact details for someone without a Customers record, e.g. a request made on the website. */
  contact?: { phone?: string; email?: string; address?: string };
  /** The maintenance plan visit this booking schedules. The plan holds the matching booking id. */
  planVisit?: { planId: string; visitId: string };
};

export type FileCategory = "Before work" | "Diagnostic / Meter" | "Equipment serial" | "After completion";
export const FILE_CATEGORIES: readonly FileCategory[] = [
  "Before work",
  "Diagnostic / Meter",
  "Equipment serial",
  "After completion",
];

export type JobFile = {
  id: string;
  name: string;
  /** Size in KB, shown as MB when large. */
  sizeKb: number;
  category?: FileCategory;
  caption?: string;
  /** "10:24", business-local time the photo was taken. */
  takenAt?: string;
  visibility: "customer" | "internal";
  /** A short label burned into the thumbnail in Stitch (e.g. "Carrier · SN: 1618E42109"). */
  badge?: string;
  /** Chosen in this browser and not stored anywhere: there is no file storage yet. Gone when the page reloads. */
  sessionOnly?: boolean;
};

export type ChecklistItem = { label: string; note?: string; passed: boolean };

export type JobDetails = {
  technicianDiagnosis?: string;
  workPerformed?: string;
  /** Shown to the customer on the completion report. */
  customerSummary?: string;
  /** Private to the team. */
  internalNotes?: string;
  checklist?: readonly ChecklistItem[];
  customerRequest?: string;
  safetyNote?: string;
};

export type Job = {
  /** "JB-204" */
  id: string;
  bookingId?: string;
  customerId?: string;
  contactName?: string;
  propertyId?: string;
  serviceId: string;
  assigneeId?: string;
  date: string;
  start: string;
  end: string;
  status: JobStatus;
  /** Short description of the work, for jobs that don't need the longer details. */
  workSummary?: string;
  /** Equipment worked on; references data/customers EQUIPMENT. */
  equipmentId?: string;
  note?: string;
  details: JobDetails;
  files: readonly JobFile[];
  completion?: { notes: string; at: string };
};

export type ScheduleBlock = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  /** Team members the block applies to. */
  memberIds: readonly string[];
};

export type OperationsData = {
  bookings: readonly Booking[];
  jobs: readonly Job[];
  blocks: readonly ScheduleBlock[];
};

/* ───────────────────────── empty ───────────────────────── */

/** What a business with no operations yet has (a new organization): no bookings, jobs or blocked time. */
export const EMPTY_OPERATIONS: OperationsData = { bookings: [], jobs: [], blocks: [] };

/* ───────────────────────── selectors ─────────────────────────
 * Each takes the active business's operations data. */


export function getBookingById(id: string, data: OperationsData): Booking | undefined {
  return data.bookings.find((booking) => booking.id === id);
}

export function getBookingsForCustomer(customerId: string, data: OperationsData): Booking[] {
  return data.bookings.filter((booking) => booking.customerId === customerId);
}


export function getJobById(id: string, data: OperationsData): Job | undefined {
  return data.jobs.find((job) => job.id === id);
}

/** Newest first. */
export function getJobsForCustomer(customerId: string, data: OperationsData): Job[] {
  return data.jobs
    .filter((job) => job.customerId === customerId)
    .sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`));
}

/** The party on a booking or job: a Customers record, or the snapshot name for someone without one. */
export function getPartyName(record: Pick<Booking, "customerId" | "contactName">, dir: Pick<Directory, "customers">): string {
  return (record.customerId && getCustomerById(record.customerId, dir)?.name) || record.contactName || "Unknown customer";
}

export function getAssigneeName(record: { assigneeId?: string }, dir: Pick<Directory, "team">): string | undefined {
  return getTeamMemberById(record.assigneeId, dir.team)?.name;
}

export function getServiceNameFor(record: { serviceId: string }, dir: Pick<Directory, "services">): string {
  return getServiceById(record.serviceId, dir.services)?.name ?? "Unknown service";
}

/* ───────────────────────── schedule (derived) ───────────────────────── */

export type ScheduleEventStatus = "confirmed" | JobStatus;

export type WorkEvent = {
  kind: "work";
  /** Job id when a job exists, otherwise the booking id. */
  id: string;
  bookingId?: string;
  jobId?: string;
  customerId?: string;
  contactName?: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  assigneeId?: string;
  status: ScheduleEventStatus;
};

export type BlockEvent = {
  kind: "block";
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  memberIds: readonly string[];
};

export type ScheduleEvent = WorkEvent | BlockEvent;

/**
 * Everything on the calendar, derived from the records. A job is the event when one exists;
 * a confirmed or completed booking without a job is an event of its own. Pending and cancelled
 * bookings never appear. Sorted by date and start time.
 */
export function getScheduleEvents(data: OperationsData): ScheduleEvent[] {
  const jobEvents: WorkEvent[] = data.jobs.map((job) => ({
    kind: "work",
    id: job.id,
    bookingId: job.bookingId,
    jobId: job.id,
    customerId: job.customerId,
    contactName: job.contactName,
    serviceId: job.serviceId,
    date: job.date,
    start: job.start,
    end: job.end,
    assigneeId: job.assigneeId,
    status: job.status,
  }));

  const bookingEvents: WorkEvent[] = data.bookings
    .filter((booking) => (booking.status === "confirmed" || booking.status === "completed") && !booking.jobId)
    .map((booking) => ({
      kind: "work",
      id: booking.id,
      bookingId: booking.id,
      customerId: booking.customerId,
      contactName: booking.contactName,
      serviceId: booking.serviceId,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      assigneeId: booking.assigneeId,
      status: booking.status === "completed" ? "completed" : "confirmed",
    }));

  const blockEvents: BlockEvent[] = data.blocks.map((block) => ({ kind: "block", ...block }));

  return [...jobEvents, ...bookingEvents, ...blockEvents].sort((a, b) =>
    `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
  );
}

export function getScheduleEventsForDate(date: string, data: OperationsData): ScheduleEvent[] {
  return getScheduleEvents(data).filter((event) => event.date === date);
}

/** Work that has no technician yet and still has to happen (not completed). */
export function getUnassignedEvents(data: OperationsData): WorkEvent[] {
  return getScheduleEvents(data).filter(
    (event): event is WorkEvent => event.kind === "work" && !event.assigneeId && event.status !== "completed",
  );
}

/* ───────────────────────── presentation ───────────────────────── */

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  "in-progress": "In progress",
  completed: "Completed",
};

export const EVENT_STATUS_LABEL: Record<ScheduleEventStatus, string> = {
  confirmed: "Confirmed",
  ...JOB_STATUS_LABEL,
};

/** The Bookings tabs and the status each one shows. */
export const BOOKING_TABS = [
  { id: "requests", label: "Requests", status: "pending" },
  { id: "upcoming", label: "Upcoming", status: "confirmed" },
  { id: "past", label: "Past", status: "completed" },
  { id: "cancelled", label: "Cancelled", status: "cancelled" },
] as const satisfies readonly { id: string; label: string; status: BookingStatus }[];
export type BookingTabId = (typeof BOOKING_TABS)[number]["id"];

/** Photo size label: KB below 1 MB, otherwise MB. */
export function formatFileSize(sizeKb: number): string {
  return sizeKb >= 1000 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}
