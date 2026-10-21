import type { Route } from "next";
import {
  Banknote,
  CalendarDays,
  CalendarRange,
  ChartLine,
  CircleHelp,
  ClipboardList,
  Globe,
  IdCard,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
  ReceiptText,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Users,
  Wrench,
} from "lucide-react";

export type NavItem = {
  label: string;
  /** Real application route. Typed routes make a missing page a compile error. */
  href: Route;
  icon: LucideIcon;
  /** A plain-language line about what the page is for (the Help page uses it, and a link's tooltip). */
  purpose: string;
  /** Optional count pill: how many booking requests are waiting for the business to answer (read from its own Bookings). */
  badge?: "requests";
};

export type NavGroup = {
  /** The group's name. A group whose one item says the same (Overview, Customers) shows no heading of its own. */
  label: string;
  items: NavItem[];
};

/**
 * The workspace's navigation, grouped by the work a business does: what is happening (Work), who it serves (Customers), how it is set up (Business), what
 * it earns (Money), how it is found (Growth) and how it is doing (Insights). Overview opens the workspace and is not in a group. The 16 modules and their
 * addresses are unchanged; only the grouping and the names a person reads changed.
 *
 * "Marketplace Listing" is the business's own control of its entry in Climvia's public Marketplace (/marketplace is what homeowners search): the two
 * must never share a name.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Overview", href: "/overview", icon: LayoutGrid, purpose: "Today's work, what needs your attention and what to set up next." }],
  },
  {
    label: "Work",
    items: [
      { label: "Bookings", href: "/bookings", icon: CalendarDays, badge: "requests", purpose: "Customer appointments and service requests." },
      { label: "Schedule", href: "/schedule", icon: CalendarRange, purpose: "Who is working where, day by day." },
      { label: "Jobs", href: "/jobs", icon: ClipboardList, purpose: "The work to perform, from assignment to completion." },
    ],
  },
  {
    label: "Customers",
    items: [{ label: "Customers", href: "/customers", icon: Users, purpose: "People your business serves and their service history." }],
  },
  {
    label: "Business",
    items: [
      { label: "Services", href: "/services", icon: Wrench, purpose: "What customers can book from your business." },
      { label: "Team", href: "/team", icon: IdCard, purpose: "The people who do the work and what each of them can do." },
      { label: "Maintenance Plans", href: "/maintenance-plans", icon: ShieldCheck, purpose: "Recurring service agreements and their visits." },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Quotes & Invoices", href: "/quotes-invoices", icon: ReceiptText, purpose: "What you offer customers to pay, and what you have billed them." },
      { label: "Payments", href: "/payments", icon: Banknote, purpose: "The money customers have paid you." },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Website", href: "/website", icon: Globe, purpose: "Your public business website." },
      { label: "Marketplace Listing", href: "/marketplace-listing", icon: Store, purpose: "How your business appears in Climvia's public Marketplace." },
      { label: "Reviews", href: "/reviews", icon: Star, purpose: "What customers say about your work, and asking them for it." },
      { label: "Marketing", href: "/marketing", icon: Megaphone, purpose: "Messages to your customers." },
    ],
  },
  {
    label: "Insights",
    items: [{ label: "Analytics", href: "/analytics", icon: ChartLine, purpose: "How many bookings and jobs you have, what you have billed and where bookings come from." }],
  },
];

/** Pinned to the bottom of the sidebar. */
export const NAV_UTILITY: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings, purpose: "Your business details, hours, branding and account." },
  { label: "Help", href: "/help", icon: CircleHelp, purpose: "Where things are, and what to do first." },
];

const ALL_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((group) => group.items), ...NAV_UTILITY];

export function getNavItem(href: Route): NavItem {
  const item = ALL_ITEMS.find((candidate) => candidate.href === href);
  if (!item) {
    throw new Error(`No navigation item is registered for route "${href}".`);
  }
  return item;
}

/** A module owns its own address and every address beneath it (e.g. /jobs/JB-204). */
export function isRouteActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
