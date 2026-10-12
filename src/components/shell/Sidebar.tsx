"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReporting } from "@/components/reporting/ReportingProvider";
import { NAV_GROUPS, NAV_UTILITY, isRouteActive, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/cn";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isRouteActive(item.href, pathname);
  // The count pills are this month's totals from the business's own records: a business with none shows no pill.
  const { month } = useReporting();
  const count = item.badge ? month[item.badge] : 0;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      // Every module is a per-workspace page rendered on request, so a prefetch is a database round trip per link per
      // page view that the next click cannot reuse. Navigation fetches the page when it is chosen.
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center justify-between rounded-btn px-3 py-3 text-sm transition-colors",
        active
          ? "bg-primary font-semibold text-white shadow-card"
          : "font-medium text-ink-muted hover:bg-surface-low hover:text-ink",
      )}
    >
      <span className="flex items-center gap-2.5">
        <Icon aria-hidden className={cn("size-[18px]", active ? "text-white" : "text-ink-muted")} />
        {item.label}
      </span>
      {count > 0 && (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xs font-medium",
            active ? "bg-white/20 text-white" : "bg-surface-low text-ink-muted",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

/** Primary navigation. The active item is derived from the URL, so it stays correct on deep links and back/forward. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="sticky top-(--topbar-height) h-[calc(100dvh-var(--topbar-height))] w-(--sidebar-width) shrink-0 border-r border-line bg-surface"
    >
      <div className="flex h-full flex-col select-none">
        {/* Only the module list scrolls; Settings and Help stay pinned and always reachable. */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const headingId = `nav-group-${group.label.toLowerCase()}`;
            return (
              <section key={group.label} aria-labelledby={headingId}>
                <h2
                  id={headingId}
                  className="px-3 pb-2 text-micro font-bold tracking-wider text-ink-muted uppercase"
                >
                  {group.label}
                </h2>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} pathname={pathname} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <ul className="shrink-0 space-y-0.5 border-t border-line bg-surface p-3">
          {NAV_UTILITY.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
