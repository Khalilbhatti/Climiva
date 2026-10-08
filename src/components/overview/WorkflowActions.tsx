import Link from "next/link";
import type { Route } from "next";
import { CalendarCheck, CreditCard, Send, Shield, type LucideIcon } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";

type Workflow = {
  title: string;
  description: string;
  /** The owning module. Full create flows ship with that module, not in Phase 1. */
  href: Route;
  icon: LucideIcon;
  iconClassName: string;
};

const WORKFLOWS: Workflow[] = [
  {
    title: "New booking",
    description: "Book customer visit",
    // Opens the one Create booking flow on the Bookings page.
    href: "/bookings?new=1",
    icon: CalendarCheck,
    iconClassName: "bg-primary-subtle text-primary",
  },
  {
    title: "Record payment",
    description: "Log customer payment",
    // Opens the one Record payment flow on the Payments page.
    href: "/payments?record=1",
    icon: CreditCard,
    iconClassName: "bg-positive-soft text-positive",
  },
  {
    title: "Create maintenance plan",
    description: "Add maintenance plan",
    // Opens the one Create maintenance plan flow on the Maintenance Plans page.
    href: "/maintenance-plans?new=1",
    icon: Shield,
    iconClassName: "bg-warning-soft text-warning",
  },
  {
    title: "Create campaign",
    description: "Create customer campaign",
    // Opens the one campaign editor on the Marketing page.
    href: "/marketing/new",
    icon: Send,
    iconClassName: "bg-surface-low text-primary",
  },
];

export function WorkflowActions() {
  return (
    <section aria-labelledby="workflows-heading" className={cardClasses("lg", "space-y-4")}>
      <div>
        <h2 id="workflows-heading" className="text-base font-semibold text-ink">
          Core Operational Workflows
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Quick actions to log customer visits, record finances, and send marketing communications.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOWS.map(({ title, description, href, icon: Icon, iconClassName }) => (
          <li key={title}>
            <Link
              href={href}
              className="group block h-full rounded-card border border-line bg-canvas p-4 transition-colors hover:border-primary hover:bg-surface hover:shadow-card"
            >
              <span
                className={`mb-3 flex size-9 items-center justify-center rounded-btn transition-transform motion-safe:group-hover:scale-105 ${iconClassName}`}
              >
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="block text-sm font-semibold text-ink transition-colors group-hover:text-primary">
                {title}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">{description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
