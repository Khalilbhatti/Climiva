"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarX, ChevronDown, Download, RotateCcw } from "lucide-react";
import { useFinancials } from "@/components/financials/FinancialProvider";
import { useOperations } from "@/components/operations/OperationsProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { ANALYTICS_TABS, DEFAULT_RANGE_ID, hasActivity, resolveTab, type AnalyticsReport, type DateRange } from "@/lib/analytics-rules";
import { formatRange, recentRecords, rangeLabel } from "@/lib/analytics-state";
import { BookingsJobsPanel, FinancialPanel, KpiRow, OverviewPanel, PlansPanel } from "./AnalyticsPanels";
import { DateRangeModal } from "./DateRangeModal";
import { ExportModal } from "./ExportModal";

/**
 * Analytics: read-only reports over records that live in other modules. The report arrives from the server, already worked out
 * for the active business and the date range in the URL (PostgreSQL aggregates plus the sample business's imported history); this
 * screen shows it, exports it, and changes the URL, which asks the server for another. The tab and the range live in the URL, so a
 * view can be linked to and survives a reload.
 */
export function AnalyticsView({ report }: { report: AnalyticsReport }) {
  const { data: financial } = useFinancials();
  const { data: operations } = useOperations();
  const router = useRouter();
  const params = useSearchParams();

  const tabId = resolveTab(params.get("tab"));
  const range = report.range;
  const active = hasActivity(report);
  const recent = useMemo(() => recentRecords(operations, financial, range, report.today), [operations, financial, range, report.today]);

  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);

  function setParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace((qs ? `/analytics?${qs}` : "/analytics") as Route, { scroll: false });
  }

  function applyRange(next: DateRange) {
    setPicking(false);
    setParams(next.id === "custom" ? { range: "custom", from: next.from, to: next.to } : { range: next.id === DEFAULT_RANGE_ID ? null : next.id, from: null, to: null });
  }

  const resetRange = () => setParams({ range: null, from: null, to: null });

  // The imported history of the sample business is part of the figures only when the range covers the whole period it describes.
  const period = report.imported.period;
  const importedLeftOut = period !== null && !report.imported.included && range.from <= period.to && range.to >= period.from;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Review operational activity and financial records across your workspace."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="lg" onClick={() => setPicking(true)} aria-haspopup="dialog">
              <CalendarDays aria-hidden className="size-[18px] text-primary" />
              <span>
                <span className="sr-only">Date range: </span>
                {formatRange(range.from, range.to)}
              </span>
              <span className="rounded bg-surface-low px-1.5 py-0.5 text-micro font-semibold text-ink-muted">{rangeLabel(range)}</span>
              <ChevronDown aria-hidden className="size-4 text-ink-muted" />
            </Button>
            <Button size="lg" onClick={() => setExporting(true)} disabled={!active} aria-haspopup="dialog" aria-describedby={active ? undefined : "export-unavailable"}>
              <Download aria-hidden className="size-[18px]" />
              Export report
            </Button>
            {!active && (
              <span id="export-unavailable" className="sr-only">
                There is nothing to export for this period.
              </span>
            )}
          </div>
        }
      />

      {active ? (
        <>
          {importedLeftOut && period && (
            <p className="rounded-btn bg-surface-low px-4 py-2.5 text-sm text-ink-muted">
              Imported history for {formatRange(period.from, period.to)} is only part of the figures when the range covers all of it. These figures are the records
              inside the selected dates.
            </p>
          )}
          {/* The longest tab label is wider than a phone, so the tab list scrolls sideways there instead of the page. */}
          <div className="overflow-x-auto [&_button]:shrink-0 [&_button]:whitespace-nowrap">
            <Tabs
              label="Analytics sections"
              idPrefix="analytics"
              value={tabId}
              onChange={(id) => setParams({ tab: id === "overview" ? null : id })}
              tabs={ANALYTICS_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
            />
          </div>
          <div role="tabpanel" id={`analytics-panel-${tabId}`} aria-labelledby={`analytics-tab-${tabId}`}>
            {tabId === "overview" && <OverviewPanel report={report} />}
            {tabId === "bookings-jobs" && <BookingsJobsPanel report={report} recent={recent} />}
            {tabId === "financial" && <FinancialPanel report={report} recent={recent} financial={financial} />}
            {tabId === "plans" && <PlansPanel report={report} />}
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <KpiRow kpis={report.kpis} />
          <EmptyState
            icon={CalendarX}
            title="No activity for this period"
            description="There are no Bookings, Jobs, Quotes, Invoices, or Payments recorded for the selected date range. Try selecting another date range to review workspace activity."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button onClick={() => setPicking(true)}>
                  <CalendarDays aria-hidden className="size-4" />
                  Change date range
                </Button>
                <Button variant="secondary" onClick={resetRange}>
                  <RotateCcw aria-hidden className="size-4" />
                  Reset date range
                </Button>
              </div>
            }
          />
        </div>
      )}

      {picking && <DateRangeModal current={range} today={report.today} onApply={applyRange} onClose={() => setPicking(false)} />}
      {exporting && <ExportModal report={report} onClose={() => setExporting(false)} />}
    </>
  );
}
