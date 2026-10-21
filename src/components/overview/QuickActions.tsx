"use client";

import Link from "next/link";
import type { Route } from "next";
import { CalendarCheck, CreditCard, Send, Shield, UserPlus, type LucideIcon } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import { useCan } from "@/components/workspace/WorkspaceProvider";

type QuickAction = {
  title: string;
  description: string;
  /** The page that owns the flow. The link opens its one create flow. */
  href: Route;
  icon: LucideIcon;
  iconClassName: string;
};

const ACTIONS: QuickAction[] = [
  { title: "Create booking", description: "Book a visit for a customer", href: "/bookings?new=1", icon: CalendarCheck, iconClassName: "bg-primary-subtle text-primary" },
  { title: "Add customer", description: "Save someone you serve", href: "/customers?new=1", icon: UserPlus, iconClassName: "bg-surface-low text-primary" },
  { title: "Record payment", description: "Log a payment you received", href: "/payments?record=1", icon: CreditCard, iconClassName: "bg-positive-soft text-positive" },
  { title: "Create maintenance plan", description: "Plan regular visits for a customer", href: "/maintenance-plans?new=1", icon: Shield, iconClassName: "bg-warning-soft text-warning" },
  { title: "Create campaign", description: "Write to your customers", href: "/marketing/new", icon: Send, iconClassName: "bg-surface-low text-primary" },
];

/** The things an owner starts most often. People who can only look at the business have nothing to start, so they do not see the list. */
export function QuickActions() {
  const canManage = useCan("operations:manage");
  if (!canManage) return null;
  return (
    <section aria-labelledby="quick-actions-heading" className={cardClasses("lg", "space-y-4")}>
      <h2 id="quick-actions-heading" className="text-base font-semibold text-ink">
        Quick actions
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {ACTIONS.map(({ title, description, href, icon: Icon, iconClassName }) => (
          <li key={title}>
            <Link href={href} className="group block h-full rounded-card border border-line bg-canvas p-4 transition-colors hover:border-primary hover:bg-surface hover:shadow-card">
              <span className={`mb-3 flex size-9 items-center justify-center rounded-btn transition-transform motion-safe:group-hover:scale-105 ${iconClassName}`}>
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="block text-sm font-semibold text-ink transition-colors group-hover:text-primary">{title}</span>
              <span className="mt-1 block text-xs text-ink-muted">{description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
