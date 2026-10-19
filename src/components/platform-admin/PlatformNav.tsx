"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, MessageSquareText, Server, Store, Users } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/platform-admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/platform-admin/organizations", label: "Organizations", icon: Building2, exact: false },
  { href: "/platform-admin/users", label: "Users", icon: Users, exact: false },
  { href: "/platform-admin/marketplace", label: "Marketplace Listings", icon: Store, exact: false },
  { href: "/platform-admin/reviews", label: "Reviews / Moderation", icon: MessageSquareText, exact: false },
  { href: "/platform-admin/system", label: "System", icon: Server, exact: false },
] as const;

/** The console's navigation. The only client code in the console's shell, and it holds no data: only the current path. */
export function PlatformNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform" className="px-2 py-2">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {ITEMS.map((item) => {
          const current = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-btn px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  current ? "bg-primary-subtle text-primary" : "text-ink-muted hover:bg-hover hover:text-ink",
                )}
              >
                <item.icon aria-hidden className="size-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
