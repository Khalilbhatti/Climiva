import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, CalendarRange, ChartLine, ClipboardList, Globe, IdCard, ReceiptText, Settings, ShieldCheck, Star, Users, type LucideIcon } from "lucide-react";
import { cardClasses } from "@/components/ui/Card";
import { getNavItem } from "@/config/navigation";

type HelpArea = {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Real routes. Each link is labelled with the sidebar's own name for the module, so the two can never disagree. */
  routes: readonly Route[];
};

const AREAS: readonly HelpArea[] = [
  { title: "Bookings & Schedule", description: "Review customer requests, confirm appointments and see the week's work.", icon: CalendarRange, routes: ["/bookings", "/schedule"] },
  { title: "Customers & Services", description: "Customer records, properties and equipment, and the Services you offer.", icon: Users, routes: ["/customers", "/services"] },
  { title: "Jobs", description: "Active, upcoming and completed service work.", icon: ClipboardList, routes: ["/jobs"] },
  { title: "Team", description: "Team members, roles and availability.", icon: IdCard, routes: ["/team"] },
  { title: "Quotes, Invoices & Payments", description: "Quotes and invoices, and the payments recorded against them.", icon: ReceiptText, routes: ["/quotes-invoices", "/payments"] },
  { title: "Maintenance Plans", description: "Maintenance agreements and their included visits.", icon: ShieldCheck, routes: ["/maintenance-plans"] },
  { title: "Website & Marketplace", description: "Your public website and your Climvia Marketplace listing.", icon: Globe, routes: ["/website", "/marketplace"] },
  { title: "Reviews & Marketing", description: "Customer reviews and replies, and email and SMS campaigns.", icon: Star, routes: ["/reviews", "/marketing"] },
  { title: "Analytics", description: "Read-only reports on bookings, jobs, quotes, invoices and payments.", icon: ChartLine, routes: ["/analytics"] },
  { title: "Settings", description: "Business information, hours, branding, preferences and your profile.", icon: Settings, routes: ["/settings"] },
];

/** The Help landing page: one card per area of the workspace, each leading to the real screen. Nothing here is a support channel. */
export function HelpAreas() {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {AREAS.map(({ title, description, icon: Icon, routes }) => (
        <li key={title}>
          <section aria-label={title} className={cardClasses("md", "h-full")}>
            <span aria-hidden className="mb-3 flex size-9 items-center justify-center rounded-btn bg-primary-subtle text-primary">
              <Icon className="size-5" />
            </span>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {routes.map((route) => (
                <li key={route}>
                  <Link
                    href={route}
                    className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-subtle"
                  >
                    {getNavItem(route).label}
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </li>
      ))}
    </ul>
  );
}
