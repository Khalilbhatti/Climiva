"use client";

import { useState } from "react";
import { CalendarDays, Download, Info, Lock } from "lucide-react";
import { useBusiness } from "@/components/settings/SettingsProvider";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { useToast } from "@/components/ui/Toast";
import { EXPORT_FORMATS, EXPORT_MODULES, type ExportFormat, type ExportModuleId } from "@/data/analytics";
import type { AnalyticsReport } from "@/lib/analytics-rules";
import { formatRange } from "@/lib/analytics-state";
import { buildReport, downloadFile, reportFileName, toCsv, toPdf } from "@/lib/report-export";

const ALL_MODULES = EXPORT_MODULES.map((module) => module.id);

/**
 * Export the figures on screen as a CSV or a PDF. The file is made in the browser from the report the server computed for the
 * active business (the same object the screen shows) and saved by it: nothing is sent, scheduled or shared. The date range is the
 * one selected on the page and is shown here, not edited.
 */
export function ExportModal({ report, onClose }: { report: AnalyticsReport; onClose: () => void }) {
  const range = report.range;
  const business = useBusiness();
  const { toast } = useToast();
  const [modules, setModules] = useState<ExportModuleId[]>(ALL_MODULES);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [showError, setShowError] = useState(false);

  const none = modules.length === 0;
  const allSelected = modules.length === ALL_MODULES.length;

  function toggle(id: ExportModuleId, on: boolean) {
    setModules((current) => (on ? [...current, id] : current.filter((item) => item !== id)));
  }

  function exportReport() {
    if (none) return setShowError(true);
    const file = buildReport(report, modules, business.name);
    if (format === "csv") downloadFile(reportFileName(file, "csv"), "text/csv;charset=utf-8", toCsv(file));
    else downloadFile(reportFileName(file, "pdf"), "application/pdf", toPdf(file));
    toast(`Report exported as ${format === "csv" ? "CSV" : "PDF"}.`);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Export Analytics report"
      description="Select the date range and record modules you want to include in this report export."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={exportReport}>
            <Download aria-hidden className="size-4" />
            Export report
          </Button>
        </>
      }
    >
      <div>
        <p className="mb-1 text-xs font-medium text-ink">Date range</p>
        <div className="flex items-center gap-2.5 rounded-btn bg-surface-low px-3 py-2.5 text-sm text-ink">
          <CalendarDays aria-hidden className="size-4 text-primary" />
          <span>
            {formatRange(range.from, range.to)} <span className="text-ink-muted">(Current selected range)</span>
          </span>
          <Lock aria-hidden className="ml-auto size-4 text-ink-muted" />
        </div>
      </div>

      <fieldset>
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium text-ink">Include modules</legend>
          <button
            type="button"
            onClick={() => setModules(allSelected ? [] : ALL_MODULES)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>
        <ul className="mt-2 space-y-0.5">
          {EXPORT_MODULES.map((module) => (
            <li key={module.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-btn px-2 py-1.5 hover:bg-surface-low">
                <input
                  type="checkbox"
                  name="export-module"
                  checked={modules.includes(module.id)}
                  onChange={(event) => toggle(module.id, event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{module.label}</span>
                  <span className="block text-xs text-ink-muted">{module.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {showError && none && <p className="mt-2 text-xs text-danger">Select at least one module to include.</p>}
      </fieldset>

      <OptionGroup legend="Export format" className="sm:grid-cols-2">
        {EXPORT_FORMATS.map((item) => (
          <OptionCard
            key={item.id}
            type="radio"
            name="export-format"
            title={item.label}
            description={item.description}
            checked={format === item.id}
            onChange={() => setFormat(item.id)}
          />
        ))}
      </OptionGroup>

      <p className="flex items-start gap-2.5 rounded-card bg-surface-low p-3 text-sm text-ink-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        Voided Payments remain in record history but are excluded from received-payment totals.
      </p>
    </Modal>
  );
}
