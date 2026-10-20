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
  /** Optional count pill: which of this month's reporting totals it shows (read from the business's own records). */
  badge?: "bookings" | "completedJobs";
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * The locked 16-module hierarchy from the Stitch handoff
 * (climvia_development_handoff → "Product Module Map"). Groups and order are final.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Overview",
        href: "/overview",
        icon: LayoutGrid,
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Bookings",
        href: "/bookings",
        icon: CalendarDays,
        badge: "bookings",
      },
      {
        label: "Schedule",
        href: "/schedule",
        icon: CalendarRange,
      },
      {
        label: "Jobs",
        href: "/jobs",
        icon: ClipboardList,
        badge: "completedJobs",
      },
      {
        label: "Customers",
        href: "/customers",
        icon: Users,
      },
    ],
  },
  {
    label: "Business",
    items: [
      {
        label: "Services",
        href: "/services",
        icon: Wrench,
      },
      {
        label: "Team",
        href: "/team",
        icon: IdCard,
      },
    ],
  },
  {
    label: "Financials",
    items: [
      {
        label: "Quotes & Invoices",
        href: "/quotes-invoices",
        icon: ReceiptText,
      },
      {
        label: "Payments",
        href: "/payments",
        icon: Banknote,
      },
      {
        label: "Maintenance Plans",
        href: "/maintenance-plans",
        icon: ShieldCheck,
      },
    ],
  },
  {
    label: "Growth",
    items: [
      {
        label: "Website",
        href: "/website",
        icon: Globe,
      },
      {
        label: "Marketplace",
        href: "/marketplace-listing",
        icon: Store,
      },
      {
        label: "Reviews",
        href: "/reviews",
        icon: Star,
      },
      {
        label: "Marketing",
        href: "/marketing",
        icon: Megaphone,
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Analytics",
        href: "/analytics",
        icon: ChartLine,
      },
    ],
  },
];

/** Pinned to the bottom of the sidebar. */
export const NAV_UTILITY: NavItem[] = [
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
  {
    label: "Help",
    href: "/help",
    icon: CircleHelp,
  },
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
