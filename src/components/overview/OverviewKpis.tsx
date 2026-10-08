"use client";

import { Banknote, CalendarDays, CircleCheck, ReceiptText } from "lucide-react";
import { useFinancials } from "@/components/financials/FinancialProvider";
import { KpiCard } from "@/components/ui/KpiCard";
import { getPaymentsReceivedTotal, getRecordedPaymentsCount, getTotalInvoiced } from "@/data/financials";
import { overviewMetrics } from "@/data/fixtures";
import { formatUSD } from "@/lib/format";

/**
 * The four Overview totals. Bookings and Completed Jobs are the approved aggregates. The two money totals
 * are derived from the financial records, so recording a payment (or creating an invoice) on any page is
 * reflected here for the rest of the session; at the canonical baseline they equal the approved
 * $6,240 invoiced, $2,130 received and 7 recorded payments.
 */
export function OverviewKpis() {
  const { data } = useFinancials();

  return (
    <section aria-label="Key metrics" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Bookings"
        value={overviewMetrics.bookings}
        icon={CalendarDays}
        hint="Total active & scheduled bookings"
        hintDot
        href="/bookings"
      />
      <KpiCard
        label="Completed Jobs"
        value={overviewMetrics.completedJobs}
        icon={CircleCheck}
        hint="Completed field jobs"
        hintDot
        href="/jobs"
      />
      <KpiCard
        label="Total Invoiced"
        value={formatUSD(getTotalInvoiced(data))}
        icon={ReceiptText}
        hint="Across approved customer invoices"
        href="/quotes-invoices"
      />
      <KpiCard
        label="Payments Received"
        value={formatUSD(getPaymentsReceivedTotal(data))}
        icon={Banknote}
        tone="positive"
        hint={`${getRecordedPaymentsCount(data)} recorded non-voided payments`}
        href="/payments"
      />
    </section>
  );
}
