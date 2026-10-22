"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import type { AppHref } from "@/config/routes";
import { cn } from "@/lib/cn";

type Item = {
  label: string;
  href: AppHref;
  /** Said under a link that leaves Settings: where this is really managed, so nobody hunts for it here. */
  elsewhere?: string;
};

/**
 * Settings, grouped the way an owner looks for things. The five sections that ARE Settings are its own routes; the rest are links to the module that owns them
 * (a Service sets how it is booked, the Team page holds who can do what, the Website holds its domains), so a setting has one home and Settings never holds a
 * second copy of it.
 */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Business",
    items: [
      { label: "Business information", href: "/settings" },
      { label: "Business hours", href: "/settings/hours" },
      { label: "Branding", href: "/settings/branding" },
    ],
  },
  {
    label: "Booking & operations",
    items: [
      { label: "How customers book", href: "/website/booking", elsewhere: "Your website's booking page" },
      { label: "Services and prices", href: "/services", elsewhere: "Each Service sets its own booking method" },
    ],
  },
  { label: "Team & access", items: [{ label: "Team and permissions", href: "/team", elsewhere: "Who is on your team and what each can do" }] },
  {
    label: "Website & domains",
    items: [
      { label: "Domains", href: "/website/domain", elsewhere: "Your website address" },
      { label: "Website", href: "/website", elsewhere: "Pages, look and publishing" },
    ],
  },
  {
    label: "Account & workspace",
    items: [
      { label: "Workspace preferences", href: "/settings/preferences" },
      { label: "My profile", href: "/settings/profile" },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3 lg:block lg:space-y-5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <h2 className="px-3 pb-1.5 text-micro font-semibold tracking-wider text-ink-muted uppercase">{group.label}</h2>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-start justify-between gap-2 rounded-btn border-l-2 px-3 py-2 text-sm transition-colors",
                      active ? "border-primary bg-primary-subtle font-semibold text-primary" : "border-transparent font-medium text-ink hover:bg-surface-low",
                    )}
                  >
                    <span className="min-w-0">
                      {item.label}
                      {item.elsewhere && <span className="block text-xs font-normal text-ink-muted">{item.elsewhere}</span>}
                    </span>
                    {item.elsewhere && <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
