"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BookingDrawer } from "@/components/bookings/BookingDrawer";
import { useOperations } from "@/components/operations/OperationsProvider";
import { EventStatusBadge } from "@/components/operations/StatusBadges";
import { ButtonLink } from "@/components/ui/Button";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { jobHref } from "@/config/routes";
import { getAssigneeName, getBookingById, getJobById, getPartyName, getServiceNameFor, type ScheduleEvent } from "@/data/operations";
import { getTeamMemberById } from "@/data/team";
import { formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/**
 * Details for the selected calendar event. Work with a booking reuses the booking panel so the
 * Schedule and Bookings can never disagree; the other kinds are small.
 */
export function EventDetails({ event, onClose }: { event: ScheduleEvent; onClose: () => void }) {
  const dir = useDirectory();
  const { data } = useOperations();

  if (event.kind === "work") {
    const booking = event.bookingId ? getBookingById(event.bookingId, data) : undefined;
    if (booking) return <BookingDrawer booking={booking} onClose={onClose} inSchedule />;
    const job = event.jobId ? getJobById(event.jobId, data) : undefined;
    if (job) {
      return (
        <Panel title={`Job #${job.id}`} badge={<EventStatusBadge status={event.status} />} onClose={onClose}>
          <KeyValueList
            className="rounded-card bg-surface-low p-4"
            items={[
              { label: "Customer", value: getPartyName(job, dir) },
              { label: "Service", value: getServiceNameFor(job, dir) },
              { label: "When", value: `${formatWeekdayDate(job.date)} · ${formatTimeRange(job.start, job.end)}` },
              { label: "Technician", value: getAssigneeName(job, dir) ?? "Unassigned" },
            ]}
          />
          <ButtonLink variant="secondary" href={jobHref(job.id)}>
            View job
          </ButtonLink>
        </Panel>
      );
    }
    return null;
  }

  return (
    <Panel title={event.title} onClose={onClose}>
      <KeyValueList
        className="rounded-card bg-surface-low p-4"
        items={[
          { label: "When", value: `${formatWeekdayDate(event.date)} · ${formatTimeRange(event.start, event.end)}` },
          { label: "Applies to", value: event.memberIds.map((id) => getTeamMemberById(id, dir.team)?.name).join(", ") },
          { label: "Type", value: "Internal blocked time" },
        ]}
      />
    </Panel>
  );
}

function Panel({
  title,
  badge,
  onClose,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <aside aria-label="Event details" className="rounded-card border border-line bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <h2 ref={headingRef} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink focus:outline-none">
          {title}
          {badge}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close event details"
          className="-m-1 rounded-btn p-1.5 text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </aside>
  );
}
