"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Calendar, Check, MapPin, X } from "lucide-react";
import { useMaintenancePlans } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { AssignDialog } from "@/components/operations/AssignDialog";
import { useOperations } from "@/components/operations/OperationsProvider";
import { ReasonDialog } from "@/components/operations/ReasonDialog";
import { BookingStatusBadge } from "@/components/operations/StatusBadges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { useToast } from "@/components/ui/Toast";
import { customerHref, jobHref } from "@/config/routes";
import { getPlanVisitForBooking } from "@/data/maintenance-plans";
import { formatPropertyCityLine, getCustomerById, getPropertyById } from "@/data/customers";
import { getAssigneeName, getPartyName, getServiceNameFor, type Booking, type BookingTabId } from "@/data/operations";
import { BOOKING_METHOD_ARRIVAL, BOOKING_METHOD_LABEL, getServiceById } from "@/data/services";
import { formatLocalDateTime, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { toTelHref } from "@/lib/format";

const sectionHeading = "mb-2 text-micro font-bold tracking-wider text-ink-muted uppercase";

/** Details and actions for one booking. A complementary panel beside the list, not a modal. */
export function BookingDrawer({
  booking,
  onClose,
  onTabChange,
  inSchedule = false,
}: {
  booking: Booking;
  onClose: () => void;
  /** Follow the booking to the tab its new status belongs in (Bookings page only). */
  onTabChange?: (tab: BookingTabId) => void;
  /** Shown beside the calendar: hides the "View in schedule" link and links to the booking list instead. */
  inSchedule?: boolean;
}) {
  const { confirmBooking, cancelBooking, assign, createJobForBooking } = useOperations();
  const { toast } = useToast();
  const { data: plans } = useMaintenancePlans();
  const [dialog, setDialog] = useState<"assign" | "cancel" | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus into the panel when it opens (or switches booking) so keyboard users land on it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [booking.id]);

  const customer = booking.customerId ? getCustomerById(booking.customerId) : undefined;
  const property = getPropertyById(booking.propertyId ?? "");
  const service = getServiceById(booking.serviceId);
  const name = getPartyName(booking);
  const assignee = getAssigneeName(booking);
  const when = `${formatWeekdayDate(booking.date)} · ${formatTimeRange(booking.start, booking.end)}`;
  const pending = booking.status === "pending";
  const included = getPlanVisitForBooking(booking, plans);
  const canCancel = !booking.jobId && (booking.status === "pending" || booking.status === "confirmed");

  return (
    <aside aria-label="Booking details" className="rounded-card border border-line bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink focus:outline-none">
            Booking #{booking.id}
            <BookingStatusBadge status={booking.status} />
          </h2>
          {booking.receivedAt && (
            <p className="mt-1 text-xs text-ink-muted">
              Received {formatLocalDateTime(booking.receivedAt)}
              {booking.source && ` via ${booking.source}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close booking details"
          className="-m-1 rounded-btn p-1.5 text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <div className="space-y-5 p-5">
        <section aria-label="Booking summary">
          <h3 className={sectionHeading}>Booking summary</h3>
          <KeyValueList
            className="rounded-card bg-surface-low p-4"
            items={[
              ...(booking.receivedAt ? [{ label: "Received", value: formatLocalDateTime(booking.receivedAt) }] : []),
              { label: "Source", value: booking.source ?? "—" },
              { label: "Booking method", value: service ? BOOKING_METHOD_LABEL[service.bookingMethod] : "—" },
              { label: "Technician", value: assignee ?? "Unassigned" },
            ]}
          />
        </section>

        <section aria-label="Customer details">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-micro font-bold tracking-wider text-ink-muted uppercase">Customer details</h3>
            {customer && (
              <Link
                href={customerHref(customer.id)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                View customer
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            )}
          </div>
          <div className="rounded-card bg-surface-low p-4 text-sm">
            <p className="font-semibold text-ink">{name}</p>
            {customer ? (
              <>
                <p className="mt-1">
                  <a href={toTelHref(customer.phone)} className="text-ink-muted hover:underline">
                    {customer.phone}
                  </a>
                  <span className="text-ink-muted"> · </span>
                  <a href={`mailto:${customer.email}`} className="text-ink-muted hover:underline">
                    {customer.email}
                  </a>
                </p>
                {property && (
                  <p className="mt-2 flex items-start gap-2 text-ink">
                    <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                    <span>
                      {property.street}
                      <span className="block text-xs text-ink-muted">
                        {formatPropertyCityLine(property)}
                        {property.area && ` (${property.area})`}
                      </span>
                    </span>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-ink-muted">No customer record yet.</p>
                {booking.contact && (
                  <ul className="mt-2 space-y-1 text-ink-muted">
                    {booking.contact.phone && (
                      <li>
                        <a href={toTelHref(booking.contact.phone)} className="hover:underline">
                          {booking.contact.phone}
                        </a>
                      </li>
                    )}
                    {booking.contact.email && (
                      <li>
                        <a href={`mailto:${booking.contact.email}`} className="hover:underline">
                          {booking.contact.email}
                        </a>
                      </li>
                    )}
                    {booking.contact.address && (
                      <li className="flex items-start gap-2 text-ink">
                        <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                        {booking.contact.address}
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>

        <section aria-label="Service and requested time">
          <h3 className={sectionHeading}>Service &amp; requested time</h3>
          <div className="rounded-card bg-surface-low p-4">
            <p className="font-semibold text-ink">{getServiceNameFor(booking)}</p>
            <p className="mt-2 flex items-start gap-2 rounded-btn bg-surface p-3 text-sm text-ink">
              <Calendar aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <span className="block text-xs text-ink-muted">
                  {booking.status === "pending" ? "Requested time" : "Scheduled time"}
                </span>
                {when}
                {service && <span className="text-ink-muted"> ({BOOKING_METHOD_ARRIVAL[service.bookingMethod]})</span>}
              </span>
            </p>
          </div>
        </section>

        {included && (
          <section aria-label="Maintenance plan">
            <h3 className={sectionHeading}>Maintenance plan</h3>
            <div className="rounded-card bg-surface-low p-4 text-sm">
              <p className="font-semibold text-ink">
                <Link href={`/maintenance-plans/${included.plan.id}`} className="text-primary hover:underline">
                  {included.plan.name}
                </Link>
              </p>
              <p className="mt-1 text-ink-muted">
                Included visit: {included.visit.label} · Visit {included.visit.sequence} of {included.plan.visitsPerYear}
              </p>
              <p className="mt-1 text-xs text-ink-muted">Included in the plan. No Invoice or Payment is created for it.</p>
            </div>
          </section>
        )}

        {booking.intake && (
          <section aria-label="Customer intake">
            <h3 className={sectionHeading}>Customer intake</h3>
            <div className="space-y-3 rounded-card bg-surface-low p-4 text-sm">
              <KeyValueList
                items={[
                  ...(booking.intake.systemType ? [{ label: "System type", value: booking.intake.systemType }] : []),
                  ...(booking.intake.equipment ? [{ label: "Equipment model & age", value: booking.intake.equipment }] : []),
                ]}
              />
              {booking.intake.reportedIssue && (
                <div>
                  <p className="text-xs text-ink-muted">Customer reported issue</p>
                  <blockquote className="mt-1 border-l-2 border-primary pl-3 text-ink italic">“{booking.intake.reportedIssue}”</blockquote>
                </div>
              )}
            </div>
          </section>
        )}

        {booking.internalNotes && (
          <section aria-label="Internal notes">
            <h3 className={sectionHeading}>Internal notes</h3>
            <p className="rounded-card bg-surface-low p-4 text-sm text-ink">{booking.internalNotes}</p>
          </section>
        )}

        {booking.cancellation && (
          <section aria-label="Cancellation">
            <h3 className={sectionHeading}>Reason</h3>
            <p className="rounded-card bg-danger-soft p-4 text-sm text-danger">{booking.cancellation.reason}</p>
          </section>
        )}
      </div>

      <div className="space-y-3 border-t border-line bg-surface p-5">
        {pending && (
          <>
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                confirmBooking(booking.id);
                onTabChange?.("upcoming");
                toast(`Booking #${booking.id} confirmed.`);
              }}
            >
              <Check aria-hidden className="size-[18px]" />
              Confirm booking
            </Button>
            <p className="text-center text-xs text-ink-muted">The booking moves to Upcoming and can then be assigned.</p>
          </>
        )}

        {booking.status === "confirmed" && (
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setDialog("assign")}>
              {assignee ? "Reassign" : "Assign technician"}
            </Button>
            {inSchedule ? (
              <ButtonLink variant="secondary" href={`/bookings?tab=upcoming&booking=${booking.id}`}>
                View booking
              </ButtonLink>
            ) : (
              <ButtonLink variant="secondary" href={`/schedule?view=day&date=${booking.date}&event=${booking.jobId ?? booking.id}`}>
                View in schedule
              </ButtonLink>
            )}
            {booking.jobId ? (
              <ButtonLink variant="secondary" href={jobHref(booking.jobId)}>
                View job #{booking.jobId}
              </ButtonLink>
            ) : (
              <Button
                onClick={() => {
                  const job = createJobForBooking(booking.id);
                  if (job) toast(`Job #${job.id} created.`);
                }}
              >
                Create job
              </Button>
            )}
          </div>
        )}

        {booking.status === "completed" && booking.jobId && (
          <ButtonLink variant="secondary" href={jobHref(booking.jobId)}>
            View job #{booking.jobId}
          </ButtonLink>
        )}

        {canCancel && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setDialog("cancel")}
              className="rounded-btn px-2 py-1 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
            >
              {pending ? "Decline request" : "Cancel booking"}
            </button>
          </div>
        )}
      </div>

      {dialog === "assign" && (
        <AssignDialog
          description={`${getServiceNameFor(booking)} for ${name} · ${when}`}
          currentAssigneeId={booking.assigneeId}
          onClose={() => setDialog(null)}
          onAssign={(memberId) => {
            assign({ bookingId: booking.id }, memberId);
            setDialog(null);
            toast(memberId ? `Booking #${booking.id} assigned.` : `Booking #${booking.id} is unassigned.`);
          }}
        />
      )}

      {dialog === "cancel" && (
        <ReasonDialog
          title={pending ? "Decline this request?" : "Cancel this booking?"}
          description={`${name} · ${getServiceNameFor(booking)} · ${when}`}
          confirmLabel={pending ? "Decline request" : "Cancel booking"}
          keepLabel={pending ? "Keep request" : "Keep booking"}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => {
            cancelBooking(booking.id, reason);
            onTabChange?.("cancelled");
            setDialog(null);
            toast(pending ? `Request #${booking.id} declined.` : `Booking #${booking.id} cancelled.`);
          }}
        />
      )}
    </aside>
  );
}
