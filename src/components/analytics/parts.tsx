import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import type { AnalyticsModel } from "@/lib/analytics-state";
import type { AppHref } from "@/config/routes";
import { cn } from "@/lib/cn";

/** One figure: a label, the number, and a line saying what it counts. */
export function StatTile({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint?: string; tone?: "default" | "positive" | "warning" }) {
  return (
    <div className="rounded-card bg-surface-low p-4">
      <p className="text-mini font-bold tracking-wider text-ink-muted uppercase">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-bold tracking-tight", tone === "positive" ? "text-positive" : tone === "warning" ? "text-warning" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/** A link to the module that owns the records, written as the section's action. */
export function OwnerLink({ href, children }: { href: AppHref; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-primary hover:underline">
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

/** Bookings and completed Jobs by Service, with the totals the cards above show. */
export function ServiceActivityTable({ services }: { services: AnalyticsModel["services"] }) {
  const bookings = services.reduce((total, row) => total + row.bookings, 0);
  const completedJobs = services.reduce((total, row) => total + row.completedJobs, 0);
  return (
    <Table aria-label="Service activity">
      <TableHead>
        <tr>
          <TableHeaderCell>Service</TableHeaderCell>
          <TableHeaderCell className="text-right">Bookings</TableHeaderCell>
          <TableHeaderCell className="text-right">Completed Jobs</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {services.map((row) => (
          <TableRow key={row.serviceId}>
            <TableCell className="font-medium text-ink">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.bookings}</TableCell>
            <TableCell className="text-right tabular-nums">{row.completedJobs}</TableCell>
          </TableRow>
        ))}
        <TableRow className="bg-surface-low font-semibold text-ink">
          <TableCell>Total</TableCell>
          <TableCell className="text-right tabular-nums">{bookings}</TableCell>
          <TableCell className="text-right tabular-nums">{completedJobs}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

const TICKS = 4;

/**
 * Weekly Bookings and completed Jobs as paired bars. Drawn with plain elements (no chart library): each week is one
 * list item that names both numbers, and the numbers are printed above the bars.
 */
export function WeeklyChart({ weekly }: { weekly: AnalyticsModel["weekly"] }) {
  const peak = Math.max(...weekly.flatMap((week) => [week.bookings, week.completedJobs]));
  // One step of headroom above the tallest bar, so its number is never clipped.
  const top = Math.max(TICKS, Math.ceil((peak + 1) / TICKS) * TICKS);
  const percent = (value: number) => `${(value / top) * 100}%`;
  return (
    <div className="flex gap-3">
      <div aria-hidden className="relative h-64 w-5 shrink-0 text-right text-mini text-ink-muted">
        {Array.from({ length: TICKS + 1 }, (_, index) => (
          <span key={index} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(index / TICKS) * 100}%` }}>
            {(top / TICKS) * index}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <ol aria-label="Weekly Bookings and completed Jobs" className="relative grid h-64 grid-cols-5 gap-3 border-b border-line">
          {Array.from({ length: TICKS }, (_, index) => (
            <li key={index} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-line/60" style={{ bottom: `${((index + 1) / TICKS) * 100}%` }} />
          ))}
          {weekly.map((week) => (
            <li
              key={week.label}
              aria-label={`${week.label}: ${week.bookings} Bookings, ${week.completedJobs} completed Jobs`}
              className="relative flex items-end justify-center gap-1.5"
            >
              <Bar value={week.bookings} height={percent(week.bookings)} className="bg-primary" />
              <Bar value={week.completedJobs} height={percent(week.completedJobs)} className="bg-warning" />
            </li>
          ))}
        </ol>
        <ul aria-hidden className="mt-2 grid grid-cols-5 gap-3 text-center text-xs text-ink-muted">
          {weekly.map((week) => (
            <li key={week.label}>{week.label}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Bar({ value, height, className }: { value: number; height: string; className: string }) {
  return (
    <span aria-hidden className="flex h-full w-1/3 max-w-9 items-end">
      <span className={cn("relative block w-full rounded-t", className)} style={{ height }}>
        <span className="absolute inset-x-0 -top-5 text-center text-mini font-bold text-ink">{value}</span>
      </span>
    </span>
  );
}
