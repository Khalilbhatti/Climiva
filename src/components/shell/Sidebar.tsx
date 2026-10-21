"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOperations } from "@/components/operations/OperationsProvider";
import { NAV_GROUPS, NAV_UTILITY, isRouteActive, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/cn";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isRouteActive(item.href, pathname);
  // The count pill is the number of booking requests waiting for an answer, read from the business's own Bookings: it is what needs doing, and none shows no pill.
  const { data } = useOperations();
  const count = item.badge === "requests" ? data.bookings.filter((booking) => booking.status === "pending").length : 0;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      // Every module is a per-workspace page rendered on request, so a prefetch is a database round trip per link per
      // page view that the next click cannot reuse. Navigation fetches the page when it is chosen.
      prefetch={false}
      aria-current={active ? "page" : undefined}
      title={item.purpose}
      className={cn(
        "flex w-full items-center justify-between rounded-btn px-3 py-1.5 text-sm transition-colors",
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
            "rounded-full px-2 py-0.5 text-xs font-semibold",
            active ? "bg-white/20 text-white" : "bg-primary-subtle text-primary",
          )}
        >
          {count}
          <span className="sr-only"> waiting for an answer</span>
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
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3">
          {NAV_GROUPS.map((group) => {
            const headingId = `nav-group-${group.label.toLowerCase()}`;
            // A group that is one page of the same name (Overview, Customers) is just that page: a heading over it would say the same thing twice.
            const alone = group.items.length === 1 && group.items[0].label === group.label;
            return (
              <section key={group.label} {...(alone ? { "aria-label": group.label } : { "aria-labelledby": headingId })}>
                {!alone && (
                  <h2 id={headingId} className="px-3 pb-1 text-micro font-semibold tracking-wider text-ink-muted uppercase">
                    {group.label}
                  </h2>
                )}
                <ul className="space-y-px">
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

        {/* Settings and Help stay in reach. The shadow above them says the list continues when the window is short. */}
        <ul className="shrink-0 space-y-px border-t border-line bg-surface p-2 shadow-[0_-10px_10px_-10px_rgb(0_0_0/0.14)]">
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
