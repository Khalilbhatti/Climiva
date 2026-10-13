/**
 * Pure edits of an OperationsData value, for the specs that check how OTHER modules read operations (Analytics, global
 * search, Maintenance Plans, Team, Financials …): "if this booking were cancelled / this job completed, does that module
 * follow?". They are test helpers, not application code. The application changes operations only through the server
 * actions (src/server/actions/operations.ts), which authorize, validate and store the change; the specs for those are
 * bookings-db, jobs-db and schedule-db.
 *
 * None of them mutates its input.
 */
import { PROTOTYPE_NOW } from "../src/lib/prototype-clock";
import type { Booking, OperationsData } from "../src/data/operations";

const mapBooking = (data: OperationsData, id: string, change: (booking: Booking) => Booking): OperationsData => ({
  ...data,
  bookings: data.bookings.map((booking) => (booking.id === id ? change(booking) : booking)),
});

/** The data with one more booking. */
export const withBooking = (data: OperationsData, booking: Booking): OperationsData => ({ ...data, bookings: [...data.bookings, booking] });

/** A booking and its job always agree on the technician, so both change. `undefined` takes the work back. */
export function assigned(data: OperationsData, target: { bookingId?: string; jobId?: string }, memberId: string | undefined): OperationsData {
  const job = target.jobId ? data.jobs.find((item) => item.id === target.jobId) : undefined;
  const bookingId = target.bookingId ?? job?.bookingId;
  const jobId = target.jobId ?? data.bookings.find((item) => item.id === bookingId)?.jobId;
  const next = bookingId ? mapBooking(data, bookingId, (booking) => ({ ...booking, assigneeId: memberId })) : data;
  return jobId ? { ...next, jobs: next.jobs.map((item) => (item.id === jobId ? { ...item, assigneeId: memberId } : item)) } : next;
}

export const cancelled = (data: OperationsData, bookingId: string, reason: string): OperationsData =>
  mapBooking(data, bookingId, (booking) => ({ ...booking, status: "cancelled", cancellation: { reason } }));

/** A job worked through to Completed, with its booking completed too. */
export function completedJob(data: OperationsData, jobId: string, notes: string): OperationsData {
  const job = data.jobs.find((item) => item.id === jobId);
  if (!job) return data;
  const withJob: OperationsData = {
    ...data,
    jobs: data.jobs.map((item) => (item.id === jobId ? { ...item, status: "completed", completion: { notes, at: PROTOTYPE_NOW } } : item)),
  };
  return job.bookingId ? mapBooking(withJob, job.bookingId, (booking) => ({ ...booking, status: "completed" })) : withJob;
}
