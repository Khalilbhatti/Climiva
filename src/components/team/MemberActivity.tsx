"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardCheck, History, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import { jobHref, memberTabHref } from "@/config/routes";
import { PROTOTYPE_TODAY } from "@/data/fixtures";
import { ACTIVITY_CATEGORIES, getTeamMemberById, type ActivityCategory, type ActivityEntry } from "@/data/team";
import { cn } from "@/lib/cn";
import { addDays, formatMonthDay, formatTime } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { useMember } from "./MemberWorkspace";
import { useDirectory } from "@/components/workspace/DirectoryProvider";

const ICONS: Record<ActivityCategory, LucideIcon> = {
  access: ShieldCheck,
  availability: CalendarClock,
  jobs: ClipboardCheck,
  services: Wrench,
};

function dayLabel(date: string): string {
  if (date === PROTOTYPE_TODAY) return `Today (${formatMonthDay(date)})`;
  if (date === addDays(PROTOTYPE_TODAY, -1)) return `Yesterday (${formatMonthDay(date)})`;
  return formatDate(date);
}

/** A simple history of important changes to this person. It is a product view, not a security log. */
export function MemberActivity() {
  const member = useMember();
  const [filter, setFilter] = useState<"all" | ActivityCategory>("all");

  const entries = [...member.activity].sort((a, b) => b.at.localeCompare(a.at));
  const shown = entries.filter((entry) => filter === "all" || entry.category === filter);
  const days = [...new Set(shown.map((entry) => entry.at.slice(0, 10)))];

  const filters: { id: "all" | ActivityCategory; label: string; count: number }[] = [
    { id: "all", label: "All activity", count: entries.length },
    ...ACTIVITY_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      count: entries.filter((entry) => entry.category === category.id).length,
    })),
  ];

  return (
    <section aria-labelledby="activity-heading" className={cardClasses("lg", "space-y-5")}>
      <div className="flex items-start gap-2.5">
        <History aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 id="activity-heading" className="text-base font-semibold text-ink">
            Activity
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            See changes to {member.name.split(" ")[0]}&rsquo;s access, availability, services and Job assignments.
          </p>
        </div>
      </div>

      <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              filter === item.id ? "bg-primary text-white" : "bg-surface-low text-ink-muted hover:text-ink",
            )}
          >
            {item.label} {item.count}
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No activity to show.</p>
      ) : (
        days.map((day) => (
          <div key={day}>
            <h3 className="mb-2 text-micro font-bold tracking-wider text-ink-muted uppercase">{dayLabel(day)}</h3>
            <ol className="space-y-2">
              {shown
                .filter((entry) => entry.at.startsWith(day))
                .map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} memberId={member.id} />
                ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function ActivityRow({ entry, memberId }: { entry: ActivityEntry; memberId: string }) {
  const dir = useDirectory();
  const Icon = ICONS[entry.category];
  const by = getTeamMemberById(entry.byId, dir.team);
  return (
    <li className="flex items-start gap-3 rounded-card bg-surface-low p-4">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{entry.title}</p>
        {entry.detail && <p className="text-sm text-ink-muted">{entry.detail}</p>}
        <p className="mt-0.5 text-xs text-ink-muted">
          {by ? `Updated by ${by.name} · ` : ""}
          {formatTime(entry.at.slice(11, 16))}
        </p>
      </div>
      {entry.jobId && (
        <Link href={jobHref(entry.jobId)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
          View job
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
      {entry.category === "services" && (
        <Link
          href={memberTabHref(memberId, "services")}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          View assigned services
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </li>
  );
}
