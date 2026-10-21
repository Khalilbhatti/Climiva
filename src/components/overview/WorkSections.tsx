import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import type { Directory } from "@/data/directory";
import { getAssigneeName, getPartyName, getServiceNameFor, type Booking, type Job } from "@/data/operations";
import { formatMonthDay, formatTimeRange, formatWeekdayDate } from "@/lib/dates";
import type { AgendaItem, AttentionItem } from "@/lib/overview-rules";

/**
 * The working part of the Overview: what is on today, what needs an answer, what is coming and what is under way. Each row is one link to the page where the
 * thing is handled, and each card says in words when it is empty instead of showing a zero. Everything here is read from the business's own records.
 */
function Panel({ id, title, action, children }: { id: string; title: string; action?: { href: Route; label: string }; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cardClasses("md", "flex flex-col gap-3")}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {action && (
          <Link href={action.href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {action.label}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const rowClasses = "group flex items-start justify-between gap-3 rounded-btn border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-surface-low";
const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-btn bg-surface-low px-3 py-3 text-sm text-ink-muted">{children}</p>;

export function TodayCard({ items }: { items: AgendaItem[] }) {
  return (
    <Panel id="today-heading" title="Today" action={{ href: "/schedule", label: "Open schedule" }}>
      {items.length === 0 ? (
        <Empty>Nothing is scheduled for today.</Empty>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className={rowClasses}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink group-hover:text-primary">
                    {formatTimeRange(item.start, item.end)} · {item.who}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {item.service}
                    {item.assignee ? ` · ${item.assignee}` : " · Not assigned yet"}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-ink-muted">
                  <span className="block font-medium text-ink">{item.kind}</span>
                  {item.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AttentionCard({ items }: { items: AttentionItem[] }) {
  return (
    <Panel id="attention-heading" title="Needs your attention">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-btn bg-positive-soft px-3 py-3 text-sm text-positive">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          You are up to date. Nothing is waiting for you.
        </p>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className={rowClasses}>
                <span className="text-sm text-ink group-hover:text-primary">
                  <span className="font-bold">{item.count}</span> {item.text}
                </span>
                <ArrowRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ComingUpCard({ bookings, dir }: { bookings: Booking[]; dir: Directory }) {
  return (
    <Panel id="coming-up-heading" title="Coming up" action={{ href: "/bookings?tab=upcoming", label: "All bookings" }}>
      {bookings.length === 0 ? (
        <Empty>No bookings after today.</Empty>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link href={`/bookings?tab=${booking.status === "pending" ? "requests" : "upcoming"}&booking=${booking.id}` as Route} className={rowClasses}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink group-hover:text-primary">{getPartyName(booking, dir)}</span>
                  <span className="block truncate text-xs text-ink-muted">{getServiceNameFor(booking, dir)}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-ink-muted">
                  <span className="block font-medium text-ink">
                    {formatWeekdayDate(booking.date)}
                  </span>
                  {formatTimeRange(booking.start, booking.end)}
                  {booking.status === "pending" && <span className="block text-warning">Waiting for your answer</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ActiveJobsCard({ jobs, dir }: { jobs: Job[]; dir: Directory }) {
  return (
    <Panel id="active-jobs-heading" title="In progress" action={{ href: "/jobs", label: "All jobs" }}>
      {jobs.length === 0 ? (
        <Empty>No job is being worked on right now.</Empty>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}` as Route} className={rowClasses}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink group-hover:text-primary">{getPartyName(job, dir)}</span>
                  <span className="block truncate text-xs text-ink-muted">{getServiceNameFor(job, dir)}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-ink-muted">
                  <span className="block font-medium text-ink">{getAssigneeName(job, dir) ?? "Not assigned yet"}</span>
                  Started {formatMonthDay(job.date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
