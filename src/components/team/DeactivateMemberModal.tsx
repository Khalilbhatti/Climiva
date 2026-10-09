"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, CircleCheck, History, KeyRound, TriangleAlert } from "lucide-react";
import { FormAlert } from "@/components/auth/AuthShell";
import { AssignDialog } from "@/components/operations/AssignDialog";
import { useOperations } from "@/components/operations/OperationsProvider";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { jobHref } from "@/config/routes";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import { getPartyName, getScheduleEvents, getServiceNameFor, type WorkEvent } from "@/data/operations";
import type { TeamMember } from "@/data/team";
import { formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

type DeactivateMemberModalProps = {
  member: TeamMember;
  onClose: () => void;
  /** Resolves with the reason it failed, or nothing when the member was deactivated. */
  onConfirm: () => Promise<string | undefined>;
};

/**
 * Confirm deactivating a member. The work still ahead of them has to be handled first: each upcoming
 * assignment can be opened or reassigned here, and Deactivate unlocks once none is left. Nothing is
 * reassigned automatically, and completed Jobs and past bookings keep showing the member's name.
 * Deactivating changes the Team record only: the person's sign-in and workspace access are not touched.
 */
export function DeactivateMemberModal({ member, onClose, onConfirm }: DeactivateMemberModalProps) {
  const dir = useDirectory();
  const { data, assign } = useOperations();
  const [reassigning, setReassigning] = useState<WorkEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setProblem(undefined);
    const error = await onConfirm();
    setSaving(false);
    if (error) setProblem(error);
  }

  const first = member.name.split(" ")[0];
  const upcoming = getScheduleEvents(data).filter(
    (event): event is WorkEvent => event.kind === "work" && event.assigneeId === member.id && event.status !== "completed",
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={`Deactivate ${member.name}?`}
        description={`${first} will no longer be available for new Job assignments. Their sign-in and workspace access are not changed, and historical records will remain unchanged.`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="destructive-solid" onClick={confirm} disabled={upcoming.length > 0 || saving}>
              {saving ? "Deactivating…" : "Deactivate member"}
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-line rounded-card border border-line">
          {[
            { icon: KeyRound, label: "Sign-in & workspace access", value: "Unchanged" },
            { icon: CalendarClock, label: "New Job assignments", value: "Disabled" },
            { icon: History, label: "Historical Jobs & activity", value: "Preserved" },
          ].map(({ icon: Icon, label, value }) => (
            <li key={label} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-ink">
                <Icon aria-hidden className="size-4 text-ink-muted" />
                {label}
              </span>
              <span className="font-semibold text-ink">{value}</span>
            </li>
          ))}
        </ul>

        {upcoming.length > 0 ? (
          <section aria-labelledby="deactivate-upcoming" className="space-y-3 rounded-card border border-warning-line bg-warning-soft p-4">
            <div>
              <h3 id="deactivate-upcoming" className="flex items-center gap-2 text-sm font-semibold text-ink">
                <TriangleAlert aria-hidden className="size-4 text-warning" />
                {first} has {upcoming.length} upcoming Job assignment{upcoming.length === 1 ? "" : "s"}
              </h3>
              <p className="mt-0.5 text-xs text-ink-muted">Review these Jobs before deactivating this account.</p>
            </div>
            <ul className="space-y-2">
              {upcoming.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-btn bg-surface p-3 text-sm">
                  <div>
                    <p className="font-semibold text-ink">
                      #{event.id} · {getPartyName(event, dir)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {getServiceNameFor(event, dir)} · {event.date === PROTOTYPE_TODAY ? "Today" : formatWeekdayDate(event.date)},{" "}
                      {formatTimeRange(event.start, event.end)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {event.jobId && (
                      <Link
                        href={jobHref(event.jobId)}
                        className="rounded-btn px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary-subtle"
                      >
                        View job #{event.jobId}
                      </Link>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setReassigning(event)} aria-label={`Reassign ${event.id}`}>
                      Reassign
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              Climvia does not automatically reassign scheduled Jobs to other team members. Deactivating is available once these
              assignments are resolved.
            </p>
          </section>
        ) : (
          <div className="flex items-start gap-3 rounded-card bg-positive-soft p-4 text-sm" role="status">
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" />
            <div>
              <p className="font-semibold text-ink">No upcoming Job assignments</p>
              <p className="text-xs text-ink-muted">There are no future Jobs that need to be reassigned.</p>
            </div>
          </div>
        )}
        {problem && <FormAlert>{problem}</FormAlert>}
      </Modal>

      {reassigning && (
        <AssignDialog
          description={`${getServiceNameFor(reassigning, dir)} for ${getPartyName(reassigning, dir)} · ${formatWeekdayDate(reassigning.date)}, ${formatTimeRange(reassigning.start, reassigning.end)}`}
          excludeMemberId={member.id}
          onClose={() => setReassigning(null)}
          onAssign={(memberId) => {
            assign({ bookingId: reassigning.bookingId, jobId: reassigning.jobId }, memberId);
            setReassigning(null);
          }}
        />
      )}
    </>
  );
}
