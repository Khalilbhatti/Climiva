"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarDays, ClipboardCheck, UserX } from "lucide-react";
import { AssignDialog } from "@/components/operations/AssignDialog";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useTeam } from "@/components/team/TeamProvider";
import { JobStatusBadge } from "@/components/operations/StatusBadges";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { customerHref, jobHref } from "@/config/routes";
import { formatPropertyAddress, formatPropertyCityLine, getCustomerById, getPropertyById } from "@/data/customers";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import {
  JOB_STATUS_LABEL,
  getAssigneeName,
  getPartyName,
  getServiceNameFor,
  type Job,
  type JobStatus,
} from "@/data/operations";
import { getTeamMemberById } from "@/data/team";
import { formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import type { Directory } from "@/data/directory";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

const TABS = [
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const EMPTY_COPY: Record<TabId, string> = {
  active: "No active jobs.",
  upcoming: "No upcoming jobs.",
  completed: "No completed jobs.",
};

const inTab = (job: Job, tab: TabId) =>
  tab === "completed" ? job.status === "completed" : tab === "upcoming" ? job.status === "scheduled" && job.date > PROTOTYPE_TODAY : job.status !== "completed";

/** The secondary line under the service: what was done, or the equipment worked on. */
function jobSubline(job: Job, dir: Directory): string | undefined {
  if (job.workSummary) return job.workSummary;
  const equipment = dir.equipment.find((item) => item.id === job.equipmentId);
  return equipment ? `${equipment.manufacturer} ${equipment.model}${equipment.capacity ? ` · ${equipment.capacity}` : ""}` : undefined;
}

function matchesQuery(job: Job, query: string, dir: Directory): boolean {
  const customer = job.customerId ? getCustomerById(job.customerId, dir) : undefined;
  const property = getPropertyById(job.propertyId ?? "", dir);
  return [job.id, job.bookingId ?? "", getPartyName(job, dir), getServiceNameFor(job, dir), job.workSummary ?? "", customer?.phone ?? "", property ? formatPropertyAddress(property) : ""]
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

export function JobsView() {
  const dir = useDirectory();
  const { data, assign } = useOperations();
  const { data: team } = useTeam();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  // "?state=empty" previews the approved empty state without needing to delete every job.
  const previewEmpty = params.get("state") === "empty";
  const tabId = TABS.find((tab) => tab.id === params.get("tab"))?.id ?? "active";

  const [query, setQuery] = useState("");
  const [technician, setTechnician] = useState("all");
  const [service, setService] = useState("all");
  const [status, setStatus] = useState<"all" | JobStatus>("all");
  const [assigning, setAssigning] = useState<Job | null>(null);

  const jobs = useMemo(() => (previewEmpty ? [] : data.jobs), [previewEmpty, data.jobs]);
  const tabJobs = useMemo(() => {
    const ascending = tabId !== "completed";
    return jobs
      .filter((job) => inTab(job, tabId))
      .sort((a, b) => {
        const order = `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`);
        return ascending ? order : -order;
      });
  }, [jobs, tabId]);

  const visible = tabJobs.filter(
    (job) =>
      matchesQuery(job, query, dir) &&
      (technician === "all" || (technician === "none" ? !job.assigneeId : job.assigneeId === technician)) &&
      (service === "all" || job.serviceId === service) &&
      (status === "all" || job.status === status),
  );
  const filtering = query.trim() !== "" || technician !== "all" || service !== "all" || status !== "all";

  const actions = (
    <ButtonLink href="/schedule" variant="secondary" size="lg">
      <CalendarDays aria-hidden className="size-[18px]" />
      View schedule
    </ButtonLink>
  );

  if (jobs.length === 0) {
    return (
      <>
        <PageHeader title="Jobs" description="Track active service work from assignment through completion." actions={actions} />
        <EmptyState
          icon={ClipboardCheck}
          title="No jobs yet"
          description="Jobs will appear when service work is created from a booking."
          action={
            <ButtonLink href="/bookings" size="lg">
              <CalendarDays aria-hidden className="size-[18px]" />
              View bookings
            </ButtonLink>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Jobs" description="Track active service work from assignment through completion." actions={actions} />

      <Card padding="md" className="space-y-4">
        <Tabs
          label="Job lists"
          idPrefix="jobs"
          value={tabId}
          onChange={(id) => router.replace(`/jobs?tab=${id}` as Route, { scroll: false })}
          tabs={TABS.map((tab) => ({ id: tab.id, label: tab.label, count: jobs.filter((job) => inTab(job, tab.id)).length }))}
        />

        <div className="flex flex-wrap items-end gap-3">
          <SearchInput
            wrapperClassName="min-w-60 flex-1"
            aria-label="Search jobs"
            placeholder="Search job, customer, service or address..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="w-48">
            <Select label="Technician" hideLabel value={technician} onChange={(event) => setTechnician(event.target.value)}>
              <option value="all">All technicians</option>
              {team.members
                .filter((member) => member.status !== "invited")
                .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
              <option value="none">Unassigned</option>
            </Select>
          </div>
          <div className="w-52">
            <Select label="Service" hideLabel value={service} onChange={(event) => setService(event.target.value)}>
              <option value="all">All services</option>
              {dir.services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select label="Status" hideLabel value={status} onChange={(event) => setStatus(event.target.value as "all" | JobStatus)}>
              <option value="all">All statuses</option>
              {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map((item) => (
                <option key={item} value={item}>
                  {JOB_STATUS_LABEL[item]}
                </option>
              ))}
            </Select>
          </div>
          {filtering && (
            <Button
              variant="tertiary"
              onClick={() => {
                setQuery("");
                setTechnician("all");
                setService("all");
                setStatus("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div role="tabpanel" id={`jobs-panel-${tabId}`} aria-labelledby={`jobs-tab-${tabId}`} className="space-y-3">
          <Table aria-label={`${TABS.find((tab) => tab.id === tabId)!.label} jobs`} className="[&_td]:px-3 [&_th]:px-3">
            <TableHead>
              <tr>
                <TableHeaderCell>Job</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Service</TableHeaderCell>
                <TableHeaderCell>Scheduled window</TableHeaderCell>
                <TableHeaderCell>Technician</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Property</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Action</span>
                </TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
                    {filtering ? "No jobs match your search." : EMPTY_COPY[tabId]}
                  </td>
                </tr>
              ) : (
                visible.map((job) => {
                  const customer = job.customerId ? getCustomerById(job.customerId, dir) : undefined;
                  const property = getPropertyById(job.propertyId ?? "", dir);
                  const assignee = getTeamMemberById(job.assigneeId, dir.team);
                  const subline = jobSubline(job, dir);
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={jobHref(job.id)} className="font-semibold text-primary hover:underline">
                          #{job.id}
                        </Link>
                        {job.bookingId && <div className="text-xs text-ink-muted">#{job.bookingId}</div>}
                      </TableCell>
                      <TableCell>
                        {customer ? (
                          <Link href={customerHref(customer.id)} className="font-semibold whitespace-nowrap text-ink hover:underline">
                            {customer.name}
                          </Link>
                        ) : (
                          <span className="font-semibold whitespace-nowrap text-ink">{getPartyName(job, dir)}</span>
                        )}
                        {customer && <div className="text-xs text-ink-muted">{customer.phone}</div>}
                      </TableCell>
                      <TableCell className="max-w-52">
                        <div className="font-medium">{getServiceNameFor(job, dir)}</div>
                        {subline && <div className="text-xs text-ink-muted">{subline}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-medium">
                          {job.date === PROTOTYPE_TODAY && "Today, "}
                          {formatWeekdayDate(job.date)}
                        </div>
                        <div className="text-xs text-ink-muted">{formatTimeRange(job.start, job.end)}</div>
                        {job.note && <div className="text-xs text-ink-muted">{job.note}</div>}
                      </TableCell>
                      <TableCell>
                        {assignee ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={assignee.name} />
                            <div>
                              <div className="font-medium whitespace-nowrap">{assignee.name}</div>
                              <div className="text-xs text-ink-muted">{assignee.role}</div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <UserX aria-hidden className="size-4 text-danger" />
                            <div>
                              <div className="font-medium text-ink">Unassigned</div>
                              {job.status !== "completed" && (
                                <button
                                  type="button"
                                  onClick={() => setAssigning(job)}
                                  aria-label={`Assign technician to job ${job.id}`}
                                  className="text-xs font-semibold text-primary hover:underline"
                                >
                                  Assign now
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell>
                        {property ? (
                          <>
                            <div className="font-medium">{property.street}</div>
                            <div className="text-xs text-ink-muted">
                              {formatPropertyCityLine(property)}
                              {property.area && ` (${property.area})`}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={jobHref(job.id)}
                          aria-label={`View job ${job.id}`}
                          className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-sm font-semibold whitespace-nowrap text-primary transition-colors hover:bg-primary-subtle"
                        >
                          View job
                          <ArrowRight aria-hidden className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <p aria-live="polite" className="text-xs text-ink-muted">
            Showing {visible.length} of {tabJobs.length} {tabId} jobs
          </p>
        </div>
      </Card>

      {assigning && (
        <AssignDialog
          description={`${getServiceNameFor(assigning, dir)} for ${getPartyName(assigning, dir)} · ${formatWeekdayDate(assigning.date)}, ${formatTimeRange(assigning.start, assigning.end)}`}
          currentAssigneeId={assigning.assigneeId}
          onClose={() => setAssigning(null)}
          onAssign={(memberId) => {
            assign({ jobId: assigning.id }, memberId);
            setAssigning(null);
            toast(memberId ? `Job #${assigning.id} assigned to ${getAssigneeName({ assigneeId: memberId }, dir)}.` : `Job #${assigning.id} is unassigned.`);
          }}
        />
      )}
    </>
  );
}
