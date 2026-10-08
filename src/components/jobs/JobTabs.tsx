"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Camera, ClipboardList, Eye, FileText, Home, Lock, ShieldAlert, Upload, User } from "lucide-react";
import { EquipmentCard } from "@/components/customers/EquipmentCard";
import { useOperations } from "@/components/operations/OperationsProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { SectionCard } from "@/components/ui/SectionCard";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { customerHref, customerPropertiesHref, jobTabHref } from "@/config/routes";
import { EQUIPMENT, formatPropertyAddress, getCustomerById, getPropertyById } from "@/data/customers";
import {
  FILE_CATEGORIES,
  formatFileSize,
  getAssigneeName,
  getBookingById,
  type FileCategory,
  type JobFile,
} from "@/data/operations";
import { cn } from "@/lib/cn";
import { formatLocalDateTime, formatTime } from "@/lib/dates";
import { toTelHref } from "@/lib/format";
import { useJob } from "./JobWorkspace";

const linkClasses = "inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline";

/* ───────────────────────── overview ───────────────────────── */

export function JobOverviewTab() {
  const { job } = useJob();
  const { data } = useOperations();

  const customer = job.customerId ? getCustomerById(job.customerId) : undefined;
  const property = getPropertyById(job.propertyId ?? "");
  const equipment = EQUIPMENT.find((item) => item.id === job.equipmentId);
  const booking = job.bookingId ? getBookingById(job.bookingId, data) : undefined;
  const { details } = job;
  const checklist = details.checklist ?? [];
  const passed = checklist.filter((item) => item.passed).length;
  const hasSafety = Boolean(details.customerRequest || details.safetyNote);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        {job.completion && (
          <SectionCard title="Job completed" icon={ClipboardList} action={<StatusBadge tone="positive">Completed</StatusBadge>}>
            <p className="rounded-card bg-positive-soft p-4 text-sm text-ink">{job.completion.notes}</p>
            <p className="mt-2 text-xs text-ink-muted">Completed {formatLocalDateTime(job.completion.at)}</p>
          </SectionCard>
        )}

        {property && customer && (
          <SectionCard
            title="Property & access details"
            icon={Home}
            action={
              <Link href={customerPropertiesHref(customer.id)} className={linkClasses}>
                View property profile
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            }
          >
            <div className="space-y-3">
              <div className="rounded-card bg-surface-low p-4">
                <p className="font-semibold text-ink">{formatPropertyAddress(property)}</p>
                {property.area && <p className="text-sm text-ink-muted">{property.area} neighborhood</p>}
              </div>
              {property.accessInstructions && (
                <div className="rounded-card bg-surface-low p-4">
                  <p className="mb-1 text-xs font-semibold text-ink-muted">Gate &amp; entry</p>
                  <p className="text-sm text-ink">{property.accessInstructions}</p>
                </div>
              )}
              {property.mechanicalAccess && (
                <div className="rounded-card bg-surface-low p-4">
                  <p className="mb-1 text-xs font-semibold text-ink-muted">Unit location &amp; in-home access</p>
                  <p className="text-sm text-ink">{property.mechanicalAccess}</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {equipment && customer && (
          <SectionCard
            title="HVAC equipment file"
            action={
              <Link href={customerPropertiesHref(customer.id)} className={linkClasses}>
                View equipment details
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            }
          >
            <EquipmentCard equipment={equipment} variant="summary" />
          </SectionCard>
        )}

        <SectionCard title="Work summary" icon={FileText}>
          <div className="space-y-3">
            <div className="rounded-card bg-surface-low p-4">
              <p className="mb-1 text-micro font-bold tracking-wider text-ink-muted uppercase">Customer reported issue (intake note)</p>
              <p className="text-sm text-ink italic">
                {booking?.intake?.reportedIssue ? `“${booking.intake.reportedIssue}”` : "No intake note was recorded for this job."}
              </p>
            </div>
            <div className="rounded-card bg-primary-subtle p-4">
              <p className="mb-1 text-micro font-bold tracking-wider text-primary uppercase">Technician finding</p>
              <p className="text-sm text-ink">{details.technicianDiagnosis || "No findings have been recorded yet."}</p>
            </div>
            {checklist.length > 0 && (
              <p className="flex items-center justify-between rounded-card bg-surface-low p-4 text-sm text-ink">
                <span>
                  Diagnostics checklist: <strong>{passed} of {checklist.length}</strong> passed
                </span>
                <Link href={jobTabHref(job.id, "work-details")} className={linkClasses}>
                  View work details
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="space-y-6 lg:col-span-4">
        <SectionCard title="Customer information" icon={User}>
          <p className="font-semibold text-ink">
            {customer ? (
              <Link href={customerHref(customer.id)} className="hover:underline">
                {customer.name}
              </Link>
            ) : (
              job.contactName
            )}
          </p>
          {customer ? (
            <KeyValueList
              className="mt-3"
              items={[
                {
                  label: "Phone",
                  value: (
                    <a href={toTelHref(customer.phone)} className="hover:underline">
                      {customer.phone}
                    </a>
                  ),
                },
                {
                  label: "Email",
                  value: (
                    <a href={`mailto:${customer.email}`} className="hover:underline">
                      {customer.email}
                    </a>
                  ),
                },
                { label: "Preferred contact", value: customer.preferredContact },
              ]}
            />
          ) : (
            <p className="mt-1 text-xs text-ink-muted">No customer record yet.</p>
          )}
        </SectionCard>

        {booking && (
          <SectionCard title="Booking origin">
            <KeyValueList
              items={[
                { label: "Source channel", value: booking.source ?? "—" },
                { label: "Booking ID", value: `#${booking.id}` },
                ...(booking.confirmedAt ? [{ label: "Confirmed", value: formatLocalDateTime(booking.confirmedAt) }] : []),
                { label: "Technician", value: getAssigneeName(job) ?? "Unassigned" },
              ]}
            />
          </SectionCard>
        )}

        {hasSafety && (
          <SectionCard title="Safety & protocol notes" icon={ShieldAlert}>
            <div className="space-y-3">
              {details.customerRequest && (
                <div className="rounded-card bg-surface-low p-4">
                  <p className="mb-1 text-xs font-semibold text-primary">Customer request</p>
                  <p className="text-sm text-ink">{details.customerRequest}</p>
                </div>
              )}
              {details.safetyNote && (
                <div className="rounded-card bg-warning-soft p-4">
                  <p className="mb-1 text-xs font-semibold text-warning">Technician internal safety note</p>
                  <p className="text-sm text-ink">{details.safetyNote}</p>
                </div>
              )}
              <p className="text-xs text-ink-muted">Visible to the crew only.</p>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── work details ───────────────────────── */

export function JobWorkDetailsTab() {
  const { job, draft, setDraft, locked } = useJob();
  const { data } = useOperations();
  const booking = job.bookingId ? getBookingById(job.bookingId, data) : undefined;
  const checklist = job.details.checklist ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        <SectionCard title="Reported problem vs. diagnosis">
          <div className="space-y-4">
            <div className="rounded-card bg-surface-low p-4">
              <p className="mb-1 text-micro font-bold tracking-wider text-ink-muted uppercase">Reported issue (customer intake)</p>
              <p className="text-sm text-ink italic">
                {booking?.intake?.reportedIssue ? `“${booking.intake.reportedIssue}”` : "No intake note was recorded for this job."}
              </p>
            </div>
            <Textarea
              label="Technician field diagnosis"
              rows={5}
              readOnly={locked}
              value={draft.technicianDiagnosis ?? ""}
              onChange={(event) => setDraft({ technicianDiagnosis: event.target.value })}
            />
          </div>
        </SectionCard>

        <SectionCard title="Work performed log" description="Chronological steps carried out on site.">
          <Textarea
            label="Work performed"
            rows={7}
            readOnly={locked}
            className="font-mono text-[13px]"
            value={draft.workPerformed ?? ""}
            onChange={(event) => setDraft({ workPerformed: event.target.value })}
          />
        </SectionCard>

        <SectionCard title="Client communications & tech notes" description="Public summary and internal notes are kept separate.">
          <div className="space-y-4">
            <Textarea
              label="Customer-facing summary"
              rows={4}
              readOnly={locked}
              value={draft.customerSummary ?? ""}
              hint="Included in the customer's completion summary."
              onChange={(event) => setDraft({ customerSummary: event.target.value })}
            />
            <Textarea
              label="Internal office & tech notes"
              rows={3}
              readOnly={locked}
              value={draft.internalNotes ?? ""}
              hint="Private. Never shared with the customer."
              onChange={(event) => setDraft({ internalNotes: event.target.value })}
            />
          </div>
        </SectionCard>
      </div>

      <div className="lg:col-span-5">
        <SectionCard
          title="Diagnostics checklist"
          description="Electrical & airflow checks."
          action={
            checklist.length > 0 && (
              <StatusBadge tone="positive">
                {checklist.filter((item) => item.passed).length}/{checklist.length} complete
              </StatusBadge>
            )
          }
        >
          {checklist.length === 0 ? (
            <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No checklist items have been recorded for this job.</p>
          ) : (
            <ul className="space-y-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-start justify-between gap-3 rounded-card bg-surface-low p-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{item.label}</p>
                    {item.note && <p className="text-xs text-ink-muted">{item.note}</p>}
                  </div>
                  <StatusBadge tone={item.passed ? "positive" : "danger"}>{item.passed ? "Passed" : "Failed"}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ───────────────────────── photos & files ───────────────────────── */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,application/pdf";

export function JobFilesTab() {
  const { job, locked } = useJob();
  const { addJobFiles, setFileVisibility } = useOperations();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<"all" | FileCategory>("all");
  const [dragging, setDragging] = useState(false);

  const files = job.files;
  const shown = files.filter((file) => category === "all" || file.category === category);
  const customerVisible = files.filter((file) => file.visibility === "customer").length;

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const accepted = incoming.filter((file) => /^(image\/(jpeg|png)|application\/pdf)$/.test(file.type) && file.size <= MAX_FILE_BYTES);
    if (accepted.length < incoming.length) toast("Only JPG, PNG and PDF files up to 25 MB can be added.");
    if (accepted.length === 0) return;

    const firstNumber = files.length + 1;
    addJobFiles(
      job.id,
      accepted.map<JobFile>((file, index) => ({
        id: `file-${job.id}-${firstNumber + index}`,
        name: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        visibility: "internal",
      })),
    );
    toast(`${accepted.length} ${accepted.length === 1 ? "file" : "files"} added to job #${job.id}.`);
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Photos & attachments"
        description="Document equipment conditions, readings, serial numbers and completed work for customer reports."
        action={
          !locked && (
            <>
              <Button onClick={() => inputRef.current?.click()}>
                <Upload aria-hidden className="size-4" />
                Upload photos or documents
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT}
                aria-label="Choose photos or documents to upload"
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </>
          )
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
            {(["all", ...FILE_CATEGORIES] as const).map((item) => {
              const count = item === "all" ? files.length : files.filter((file) => file.category === item).length;
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    category === item ? "bg-primary text-white" : "bg-surface-low text-ink-muted hover:text-ink",
                  )}
                >
                  {item === "all" ? "All" : item} {count}
                </button>
              );
            })}
          </div>
          <p className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1 text-primary">
              <Eye aria-hidden className="size-3.5" />
              {customerVisible} customer visible
            </span>
            <span className="inline-flex items-center gap-1">
              <Lock aria-hidden className="size-3.5" />
              {files.length - customerVisible} internal
            </span>
          </p>
        </div>
      </SectionCard>

      {files.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No photos or files yet"
          description="Photos and documents added to this job appear here."
        />
      ) : (
        <ul aria-label="Photos and files" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {shown.map((file) => (
            <li key={file.id} className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
              <div className="relative flex h-44 items-center justify-center bg-gradient-to-br from-surface-low to-line">
                <Camera aria-hidden className="size-10 text-ink-faint" />
                {file.category && (
                  <span className="absolute top-3 left-3 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-ink shadow-card">
                    {file.category}
                  </span>
                )}
                <span
                  className={cn(
                    "absolute top-3 right-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                    file.visibility === "customer" ? "bg-primary-subtle text-primary" : "bg-surface text-ink-muted",
                  )}
                >
                  {file.visibility === "customer" ? <Eye aria-hidden className="size-3" /> : <Lock aria-hidden className="size-3" />}
                  {file.visibility === "customer" ? "Customer visible" : "Internal only"}
                </span>
                {file.badge && (
                  <span className="absolute bottom-3 left-3 max-w-[70%] truncate rounded bg-ink/80 px-2 py-0.5 font-mono text-mini text-white">
                    {file.badge}
                  </span>
                )}
                {file.takenAt && (
                  <span className="absolute right-3 bottom-3 rounded bg-ink/80 px-2 py-0.5 text-mini text-white">{formatTime(file.takenAt)}</span>
                )}
              </div>
              <div className="space-y-2 p-4">
                {file.caption ? <p className="text-sm text-ink">{file.caption}</p> : <p className="text-sm text-ink-muted">No caption.</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-low px-4 py-3 text-xs text-ink-muted">
                <span>
                  {getAssigneeName(job) ?? "Team"} · <span className="font-mono">{file.name}</span> · {formatFileSize(file.sizeKb)}
                </span>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => setFileVisibility(job.id, file.id, file.visibility === "customer" ? "internal" : "customer")}
                    aria-label={`${file.visibility === "customer" ? "Make internal only" : "Show to customer"}: ${file.name}`}
                    className="rounded-btn px-2 py-1 font-semibold text-primary transition-colors hover:bg-primary-subtle"
                  >
                    {file.visibility === "customer" ? "Make internal only" : "Show to customer"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          className={cn(
            "rounded-card border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary-subtle" : "border-line bg-surface",
          )}
        >
          <Upload aria-hidden className="mx-auto size-8 text-primary" />
          <p className="mt-3 text-base font-semibold text-ink">Drag and drop additional photos, schematics, or equipment PDFs here</p>
          <p className="mt-1 text-sm text-ink-muted">
            or{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-primary underline">
              click to browse
            </button>{" "}
            from your device
          </p>
          <p className="mt-3 text-xs text-ink-muted">JPG, PNG, PDF up to 25 MB each · Visibility defaults to internal only</p>
        </div>
      )}
    </div>
  );
}
