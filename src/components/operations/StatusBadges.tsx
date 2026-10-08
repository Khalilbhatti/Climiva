import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import {
  BOOKING_STATUS_LABEL,
  EVENT_STATUS_LABEL,
  JOB_STATUS_LABEL,
  type BookingStatus,
  type JobStatus,
  type ScheduleEventStatus,
} from "@/data/operations";

/**
 * The one place operational statuses map to a label and a tone. Pages render these badges; none of
 * them styles a status by hand. Tones follow the approved taxonomy (handoff board): amber for work
 * still to be done or confirmed, mint for confirmed/finished, teal for in progress, red for cancelled.
 */
const BOOKING_TONE: Record<BookingStatus, StatusTone> = {
  pending: "warning",
  confirmed: "positive",
  completed: "neutral",
  cancelled: "danger",
};

const JOB_TONE: Record<JobStatus, StatusTone> = {
  scheduled: "warning",
  "in-progress": "primary",
  completed: "positive",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <StatusBadge tone={BOOKING_TONE[status]}>{BOOKING_STATUS_LABEL[status]}</StatusBadge>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <StatusBadge tone={JOB_TONE[status]}>{JOB_STATUS_LABEL[status]}</StatusBadge>;
}

/** A schedule event is either a confirmed booking without a job yet, or a job. */
export function EventStatusBadge({ status }: { status: ScheduleEventStatus }) {
  const tone = status === "confirmed" ? BOOKING_TONE.confirmed : JOB_TONE[status];
  return <StatusBadge tone={tone}>{EVENT_STATUS_LABEL[status]}</StatusBadge>;
}
