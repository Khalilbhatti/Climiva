"use client";

import Link from "next/link";
import { ArrowRight, History, Wrench } from "lucide-react";
import { JobStatusBadge } from "@/components/operations/StatusBadges";
import { useOperations } from "@/components/operations/OperationsProvider";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { jobHref } from "@/config/routes";
import { getAssigneeName, getJobsForCustomer, getServiceNameFor } from "@/data/operations";
import { formatDate } from "@/lib/format";
import { formatTimeRange } from "@/lib/dates";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

/**
 * The customer's work, read from the shared operations records (not copied onto the customer), so it
 * stays correct when a job is completed elsewhere in the session.
 */
export function CurrentServiceCard({ customerId }: { customerId: string }) {
  const dir = useDirectory();
  const { data } = useOperations();
  const job = getJobsForCustomer(customerId, data).find((item) => item.status === "in-progress");
  if (!job) return null;

  return (
    <SectionCard title="Current service" icon={Wrench} action={<StatusBadge tone="primary">Active job</StatusBadge>}>
      <div className="rounded-card bg-surface-low p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold text-primary">
            <Link href={jobHref(job.id)} className="hover:underline">
              Job #{job.id}
            </Link>
            <span className="ml-2 text-sm font-normal text-ink-muted">{getServiceNameFor(job, dir)}</span>
          </p>
          <p className="text-xs font-semibold text-primary">
            {formatDate(job.date)}, {formatTimeRange(job.start, job.end)}
          </p>
        </div>
        <KeyValueList
          className="mt-3"
          items={[
            { label: "Assigned technician", value: getAssigneeName(job, dir) ?? "Unassigned" },
            ...(job.bookingId ? [{ label: "Booking", value: `#${job.bookingId}` }] : []),
          ]}
        />
        <Link href={jobHref(job.id)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          View job
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </SectionCard>
  );
}

export function RecentVisitsCard({ customerId }: { customerId: string }) {
  const dir = useDirectory();
  const { data } = useOperations();
  const jobs = getJobsForCustomer(customerId, data);

  return (
    <SectionCard title="Recent service visits" icon={History}>
      {jobs.length === 0 ? (
        <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No service visits are recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-low p-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Link href={jobHref(job.id)} className="hover:underline">
                    Job #{job.id}
                  </Link>
                  <JobStatusBadge status={job.status} />
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {getServiceNameFor(job, dir)} · {getAssigneeName(job, dir) ?? "Unassigned"}
                </p>
              </div>
              <p className="text-xs text-ink-muted">{formatDate(job.date)}</p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
