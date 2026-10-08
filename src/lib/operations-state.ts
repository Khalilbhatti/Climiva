/**
 * Pure state transitions for the in-memory demo of Bookings, Schedule and Jobs.
 *
 * Every function takes the current data and returns new data; none mutates its input, which is what
 * keeps the canonical fixtures in data/operations.ts untouched. Only operations a screen performs
 * are here, and none of them create quotes, invoices or payments (those records are independent).
 */
import { PROTOTYPE_NOW } from "@/data/fixtures";
import { RESERVED_BOOKING_NUMBERS } from "@/data/operations";
import type {
  Booking,
  BookingSource,
  Job,
  JobDetails,
  JobFile,
  OperationsData,
} from "@/data/operations";

/** nextId("BK", ["BK-1042", "BK-1040"]) → "BK-1043". Also numbers the financial records (PAY, INV). */
export function nextId(prefix: string, ids: readonly string[]): string {
  const highest = ids.reduce((max, id) => {
    const number = Number(id.replace(`${prefix}-`, ""));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `${prefix}-${highest + 1}`;
}

function mapBooking(data: OperationsData, id: string, change: (booking: Booking) => Booking): OperationsData {
  return { ...data, bookings: data.bookings.map((booking) => (booking.id === id ? change(booking) : booking)) };
}

function mapJob(data: OperationsData, id: string, change: (job: Job) => Job): OperationsData {
  return { ...data, jobs: data.jobs.map((job) => (job.id === id ? change(job) : job)) };
}

export type NewBookingInput = {
  /** Exactly one of customerId / contactName: a person without a Customers record is a name snapshot. */
  customerId?: string;
  contactName?: string;
  contact?: Booking["contact"];
  propertyId?: string;
  serviceId: string;
  source: BookingSource;
  date: string;
  start: string;
  end: string;
  assigneeId?: string;
  internalNotes?: string;
  /** Staff-entered bookings are confirmed straight away; a website request waits for confirmation. */
  status?: "confirmed" | "pending";
  intake?: Booking["intake"];
  note?: string;
  planVisit?: Booking["planVisit"];
};

/**
 * A booking entered by staff is confirmed straight away: they are agreeing the time with the customer.
 * A website request is pending until someone confirms it. Either way only a Booking is created.
 */
export function createBooking(data: OperationsData, input: NewBookingInput): { data: OperationsData; booking: Booking } {
  const { status = "confirmed", ...fields } = input;
  const ids = data.bookings.map((item) => item.id);

  // A booking number can be held for one plan visit (BK-1048). Every other booking skips it, and that visit
  // takes it while it is free, so the number does not depend on the order things are created in.
  const held = Object.values(RESERVED_BOOKING_NUMBERS);
  const reserved = input.planVisit ? RESERVED_BOOKING_NUMBERS[input.planVisit.visitId] : undefined;
  let number = Number(nextId("BK", ids).slice(3));
  while (held.includes(number)) number += 1;
  const id = reserved !== undefined && !ids.includes(`BK-${reserved}`) ? `BK-${reserved}` : `BK-${number}`;

  const booking: Booking = {
    ...fields,
    id,
    internalNotes: input.internalNotes?.trim() || undefined,
    status,
    receivedAt: PROTOTYPE_NOW,
    confirmedAt: status === "confirmed" ? PROTOTYPE_NOW : undefined,
  };
  return { data: { ...data, bookings: [...data.bookings, booking] }, booking };
}

export function confirmBooking(data: OperationsData, bookingId: string): OperationsData {
  return mapBooking(data, bookingId, (booking) =>
    booking.status === "pending" ? { ...booking, status: "confirmed", confirmedAt: PROTOTYPE_NOW } : booking,
  );
}

/**
 * Declines a pending request or cancels a confirmed booking. A booking that already has a job can't
 * be cancelled (jobs have no cancelled state), so it is left unchanged.
 */
export function cancelBooking(data: OperationsData, bookingId: string, reason: string): OperationsData {
  return mapBooking(data, bookingId, (booking) =>
    booking.jobId || booking.status === "completed" || booking.status === "cancelled"
      ? booking
      : { ...booking, status: "cancelled", cancellation: { reason: reason.trim() } },
  );
}

/** Assign (or clear, with undefined) the team member on a booking and its job, whichever is given. */
export function assign(
  data: OperationsData,
  target: { bookingId?: string; jobId?: string },
  memberId: string | undefined,
): OperationsData {
  const job = target.jobId ? data.jobs.find((item) => item.id === target.jobId) : undefined;
  const bookingId = target.bookingId ?? job?.bookingId;
  const jobId = target.jobId ?? data.bookings.find((item) => item.id === bookingId)?.jobId;

  let next = data;
  if (bookingId) next = mapBooking(next, bookingId, (booking) => ({ ...booking, assigneeId: memberId }));
  if (jobId) next = mapJob(next, jobId, (item) => ({ ...item, assigneeId: memberId }));
  return next;
}

/** Create the job for a confirmed booking that doesn't have one. */
export function createJobForBooking(data: OperationsData, bookingId: string): { data: OperationsData; job?: Job } {
  const booking = data.bookings.find((item) => item.id === bookingId);
  if (!booking || booking.status !== "confirmed" || booking.jobId) return { data };

  const job: Job = {
    id: nextId("JB", data.jobs.map((item) => item.id)),
    bookingId: booking.id,
    customerId: booking.customerId,
    contactName: booking.contactName,
    propertyId: booking.propertyId,
    serviceId: booking.serviceId,
    assigneeId: booking.assigneeId,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    status: "scheduled",
    note: booking.note,
    details: {},
    files: [],
  };
  return {
    data: { ...mapBooking(data, booking.id, (item) => ({ ...item, jobId: job.id })), jobs: [...data.jobs, job] },
    job,
  };
}

export function startJob(data: OperationsData, jobId: string): OperationsData {
  return mapJob(data, jobId, (job) => (job.status === "scheduled" ? { ...job, status: "in-progress" } : job));
}

export function updateJobDetails(data: OperationsData, jobId: string, patch: Partial<JobDetails>): OperationsData {
  return mapJob(data, jobId, (job) => ({ ...job, details: { ...job.details, ...patch } }));
}

/** Completing a job completes its booking too. It does not create a quote, invoice or payment. */
export function completeJob(data: OperationsData, jobId: string, notes: string): OperationsData {
  const job = data.jobs.find((item) => item.id === jobId);
  if (!job || job.status === "completed") return data;

  const withJob = mapJob(data, jobId, (item) => ({
    ...item,
    status: "completed",
    completion: { notes: notes.trim(), at: PROTOTYPE_NOW },
  }));
  return job.bookingId
    ? mapBooking(withJob, job.bookingId, (booking) => ({ ...booking, status: "completed" }))
    : withJob;
}

export function addJobFiles(data: OperationsData, jobId: string, files: readonly JobFile[]): OperationsData {
  return mapJob(data, jobId, (job) => ({ ...job, files: [...job.files, ...files] }));
}

export function setFileVisibility(
  data: OperationsData,
  jobId: string,
  fileId: string,
  visibility: JobFile["visibility"],
): OperationsData {
  return mapJob(data, jobId, (job) => ({
    ...job,
    files: job.files.map((file) => (file.id === fileId ? { ...file, visibility } : file)),
  }));
}
