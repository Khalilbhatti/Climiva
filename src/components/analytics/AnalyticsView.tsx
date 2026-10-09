"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarX, ChevronDown, Download, RotateCcw } from "lucide-react";
import { useFinancials } from "@/components/financials/FinancialProvider";
import { useMaintenancePlans } from "@/components/maintenance-plans/MaintenancePlansProvider";
import { useOperations } from "@/components/operations/OperationsProvider";
import { useServices } from "@/components/services/ServicesProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { DEFAULT_RANGE_ID, REPORT_PERIOD } from "@/data/analytics";
import {
  EMPTY_KPIS,
  buildAnalytics,
  formatRange,
  hasActivity,
  isReportPeriod,
  rangeLabel,
  resolveRange,
  type DateRange,
} from "@/lib/analytics-state";
import { BookingsJobsPanel, FinancialPanel, KpiRow, OverviewPanel, PlansPanel } from "./AnalyticsPanels";
import { DateRangeModal } from "./DateRangeModal";
import { ExportModal } from "./ExportModal";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "bookings-jobs", label: "Bookings & Jobs" },
  { id: "financial", label: "Financial Records" },
  { id: "plans", label: "Maintenance Plans & Services" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Analytics: read-only reports over records that live in other modules. The tab and the date range live in the URL, so a
 * view can be linked to; every figure comes from lib/analytics-state, which reads the same stores the owning modules do.
 */
export function AnalyticsView() {
  const { data: financial } = useFinancials();
  const { data: plans } = useMaintenancePlans();
  const { data: operations } = useOperations();
  const { services } = useServices();
  const router = useRouter();
  const params = useSearchParams();

  const tabId: TabId = TABS.find((tab) => tab.id === params.get("tab"))?.id ?? "overview";
  const range = resolveRange(params.get("range"), params.get("from"), params.get("to"));
  const active = hasActivity(range);

  const model = useMemo(() => buildAnalytics(financial, plans, operations, services), [financial, plans, operations, services]);

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
          {!isReportPeriod(range) && (
            <p className="rounded-btn bg-surface-low px-4 py-2.5 text-sm text-ink-muted">
              Reports cover whole periods. Showing {formatRange(REPORT_PERIOD.from, REPORT_PERIOD.to)}, the period with recorded activity.
            </p>
          )}
          {/* The longest tab label is wider than a phone, so the tab list scrolls sideways there instead of the page. */}
          <div className="overflow-x-auto [&_button]:shrink-0 [&_button]:whitespace-nowrap">
            <Tabs
              label="Analytics sections"
              idPrefix="analytics"
              value={tabId}
              onChange={(id) => setParams({ tab: id === "overview" ? null : id })}
              tabs={TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
            />
          </div>
          <div role="tabpanel" id={`analytics-panel-${tabId}`} aria-labelledby={`analytics-tab-${tabId}`}>
            {tabId === "overview" && <OverviewPanel model={model} />}
            {tabId === "bookings-jobs" && <BookingsJobsPanel model={model} />}
            {tabId === "financial" && <FinancialPanel model={model} financial={financial} />}
            {tabId === "plans" && <PlansPanel model={model} />}
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <KpiRow kpis={EMPTY_KPIS} />
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

      {picking && <DateRangeModal current={range} onApply={applyRange} onClose={() => setPicking(false)} />}
      {exporting && <ExportModal model={model} range={range} onClose={() => setExporting(false)} />}
    </>
  );
}
