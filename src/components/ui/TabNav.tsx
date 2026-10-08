"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppHref } from "@/config/routes";
import { cn } from "@/lib/cn";

export type TabNavItem = {
  label: string;
  href: AppHref;
  /** Optional count chip, e.g. "1 prop · 2 sys". */
  count?: string | number;
};

/**
 * Tabs that are real routes. Use this when each tab is its own URL (deep-linkable, server-rendered,
 * shell stays mounted); use <Tabs> when the panels are in-page state. Active state follows the URL.
 */
export function TabNav({ items, label }: { items: TabNavItem[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="border-b border-line">
      <ul className="-mb-px flex flex-wrap gap-x-6">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
                  active ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
                {item.count !== undefined && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      active ? "bg-primary text-white" : "bg-surface-low text-ink-muted",
                    )}
                  >
                    {item.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
