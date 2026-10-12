import { Banknote, CalendarDays, CircleCheck, ReceiptText } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import type { MonthTotals } from "@/lib/analytics-rules";
import { formatUSD } from "@/lib/format";
import { fromCents } from "@/lib/money";

/**
 * The four Overview totals: this month's Bookings, Completed Jobs, Total Invoiced and Payments Received. They are the headline
 * figures of the same report the Analytics page shows for the current month, worked out on the server from the business's own
 * records (plus the sample business's imported history), so recording a payment or creating a booking on any page is reflected
 * here the next time the Overview is opened, and the two screens can never disagree.
 */
export function OverviewKpis({ month }: { month: MonthTotals }) {
  return (
    <section aria-label="Key metrics" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Bookings" value={month.bookings} icon={CalendarDays} hint="Total active & scheduled bookings" hintDot href="/bookings" />
      <KpiCard label="Completed Jobs" value={month.completedJobs} icon={CircleCheck} hint="Completed field jobs" hintDot href="/jobs" />
      <KpiCard label="Total Invoiced" value={formatUSD(fromCents(month.invoicedCents))} icon={ReceiptText} hint="Across approved customer invoices" href="/quotes-invoices" />
      <KpiCard
        label="Payments Received"
        value={formatUSD(fromCents(month.paymentsReceivedCents))}
        icon={Banknote}
        tone="positive"
        hint={`${month.recordedPayments} recorded non-voided payments`}
        href="/payments"
      />
    </section>
  );
}
