"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, Play, SearchX } from "lucide-react";
import { AssignDialog } from "@/components/operations/AssignDialog";
import { useOperations } from "@/components/operations/OperationsProvider";
import { JobStatusBadge } from "@/components/operations/StatusBadges";
import { BackLink } from "@/components/ui/BackLink";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TabNav } from "@/components/ui/TabNav";
import { useToast } from "@/components/ui/Toast";
import { customerHref, jobTabHref } from "@/config/routes";
import { formatPropertyCityLine, getCustomerById, getPropertyById } from "@/data/customers";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import {
  BOOKING_TABS,
  getAssigneeName,
  getBookingById,
  getJobById,
  getPartyName,
  getServiceNameFor,
  type Job,
  type JobDetails,
} from "@/data/operations";
import { getTeamMemberById } from "@/data/team";
import { formatLocalDateTime, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import { CompleteJobModal } from "./CompleteJobModal";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/** The work-details fields a technician edits. Everything else on a job is read-only here. */
export type EditableDetails = Pick<JobDetails, "technicianDiagnosis" | "workPerformed" | "customerSummary" | "internalNotes">;
const EDITABLE_KEYS = ["technicianDiagnosis", "workPerformed", "customerSummary", "internalNotes"] as const;

type JobContextValue = {
  /** The saved job from the shared operations data. */
  job: Job;
  draft: EditableDetails;
  setDraft: (patch: Partial<EditableDetails>) => void;
  /** True once the job is completed: the record is final and its fields are read-only. */
  locked: boolean;
};

const JobContext = createContext<JobContextValue | null>(null);

export function useJob(): JobContextValue {
  const context = useContext(JobContext);
  if (!context) throw new Error("useJob must be used inside <JobWorkspace>.");
  return context;
}

const pick = (details: JobDetails): EditableDetails =>
  Object.fromEntries(EDITABLE_KEYS.map((key) => [key, details[key] ?? ""])) as EditableDetails;

/** Layout for /jobs/[jobId]/*: resolves the record, then hosts the header, tabs, and the shared actions. */
export function JobWorkspace({ jobId, children }: { jobId: string; children: ReactNode }) {
  const { data } = useOperations();
  const job = getJobById(jobId, data);

  if (!job) {
    return (
      <EmptyState
        as="h1"
        icon={SearchX}
        title="Job not found"
        description="This job isn't in the list. Jobs created in this session are cleared when the page reloads."
        action={<ButtonLink href="/jobs">Back to Jobs</ButtonLink>}
      />
    );
  }
  return (
    <JobEditor key={job.id} job={job}>
      {children}
    </JobEditor>
  );
}

function JobEditor({ job, children }: { job: Job; children: ReactNode }) {
  const dir = useDirectory();
  const { data, assign, startJob, updateJobDetails, completeJob } = useOperations();
  const { toast } = useToast();

  const [draft, setDraftState] = useState<EditableDetails>(() => pick(job.details));
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<"assign" | "complete" | null>(null);

  const saved = pick(job.details);
  const dirty = EDITABLE_KEYS.some((key) => draft[key] !== saved[key]);
  const locked = job.status === "completed";

  const customer = job.customerId ? getCustomerById(job.customerId, dir) : undefined;
  const property = getPropertyById(job.propertyId ?? "", dir);
  const assignee = getTeamMemberById(job.assigneeId, dir.team);
  const booking = job.bookingId ? getBookingById(job.bookingId, data) : undefined;
  const bookingTab = BOOKING_TABS.find((tab) => tab.status === booking?.status)?.id ?? "upcoming";

  const facts = [
    {
      label: "Customer",
      value: customer ? (
        <>
          <Link href={customerHref(customer.id)} className="hover:underline">
            {customer.name}
          </Link>
          <span className="block text-xs font-normal text-ink-muted">{customer.phone}</span>
        </>
      ) : (
        getPartyName(job, dir)
      ),
    },
    { label: "Service scope", value: getServiceNameFor(job, dir) },
    {
      label: "Appointment window",
      value: (
        <>
          {job.date === PROTOTYPE_TODAY ? "Today, " : ""}
          {formatWeekdayDate(job.date)}
          <span className="block text-xs font-normal text-ink-muted">{formatTimeRange(job.start, job.end)}</span>
        </>
      ),
    },
    {
      label: "Lead technician",
      value: assignee ? (
        <>
          {assignee.name}
          <span className="block text-xs font-normal text-ink-muted">{assignee.role}</span>
        </>
      ) : (
        "Unassigned"
      ),
    },
    {
      label: "Property location",
      value: property ? (
        <>
          {property.street}
          <span className="block text-xs font-normal text-ink-muted">
            {formatPropertyCityLine(property)}
            {property.area && ` (${property.area})`}
          </span>
        </>
      ) : (
        "—"
      ),
    },
  ];

  return (
    <JobContext
      value={{
        job,
        draft,
        locked,
        setDraft: (patch) => setDraftState((current) => ({ ...current, ...patch })),
      }}
    >
      <BackLink href="/jobs">Back to Jobs</BackLink>

      <header className={`${cardClasses("lg")} space-y-5`}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-ink">Job #{job.id}</h1>
              <JobStatusBadge status={job.status} />
              {booking && (
                <Link
                  href={`/bookings?tab=${bookingTab}&booking=${booking.id}`}
                  className="rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-ink-muted hover:text-primary"
                >
                  Linked from Booking #{booking.id}
                </Link>
              )}
            </div>
            {job.status === "completed" && job.completion && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-positive">
                <CircleCheck aria-hidden className="size-4" />
                Completed {formatLocalDateTime(job.completion.at)}
              </p>
            )}
          </div>

          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setDialog("assign")}>
                {assignee ? "Reassign" : "Assign technician"}
              </Button>
              {job.status === "scheduled" && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    startJob(job.id);
                    toast(`Job #${job.id} started.`);
                  }}
                >
                  <Play aria-hidden className="size-4" />
                  Start job
                </Button>
              )}
              {job.status === "in-progress" && (
                <Button onClick={() => setDialog("complete")}>
                  <CircleCheck aria-hidden className="size-[18px]" />
                  Complete job
                </Button>
              )}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-4 rounded-card bg-surface-low p-4 sm:grid-cols-2 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-micro font-bold tracking-wider text-ink-muted uppercase">{fact.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <TabNav
        label={`Job ${job.id} sections`}
        items={[
          { label: "Overview", href: jobTabHref(job.id, "overview") },
          { label: "Work details", href: jobTabHref(job.id, "work-details") },
          { label: "Photos & files", href: jobTabHref(job.id, "files"), count: job.files.length > 0 ? job.files.length : undefined },
        ]}
      />

      <div key={version}>{children}</div>

      {dirty && !locked && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-overlay"
        >
          <p className="text-sm font-semibold text-ink">You have unsaved changes</p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setDraftState(saved);
                setVersion((current) => current + 1);
              }}
            >
              Discard changes
            </Button>
            <Button
              onClick={() => {
                updateJobDetails(job.id, draft);
                toast(`Job #${job.id} work details saved.`);
              }}
            >
              Save changes
            </Button>
          </div>
        </div>
      )}

      {dialog === "assign" && (
        <AssignDialog
          description={`${getServiceNameFor(job, dir)} for ${getPartyName(job, dir)} · ${formatWeekdayDate(job.date)}, ${formatTimeRange(job.start, job.end)}`}
          currentAssigneeId={job.assigneeId}
          onClose={() => setDialog(null)}
          onAssign={(memberId) => {
            assign({ jobId: job.id }, memberId);
            setDialog(null);
            toast(memberId ? `Job #${job.id} assigned to ${getAssigneeName({ assigneeId: memberId }, dir)}.` : `Job #${job.id} is unassigned.`);
          }}
        />
      )}

      {dialog === "complete" && (
        <CompleteJobModal
          job={{ ...job, details: { ...job.details, ...draft } }}
          onClose={() => setDialog(null)}
          onComplete={(notes) => {
            // Any unsaved work-details edits are kept along with the completion.
            updateJobDetails(job.id, draft);
            completeJob(job.id, notes);
            setDialog(null);
            toast(`Job #${job.id} completed.`);
          }}
        />
      )}
    </JobContext>
  );
}
