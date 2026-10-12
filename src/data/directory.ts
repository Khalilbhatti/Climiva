/**
 * The directory: the business's customers, properties, equipment, Services and team, as the browser holds them.
 *
 * The workspace's server code reads these from PostgreSQL for the ACTIVE organization only and hands them to the providers
 * (components/workspace/DirectoryProvider). Bookings, Jobs, the Schedule and the modules that are not on the database yet
 * (the money modules …) look people, places and Services up here by id, so none of them keeps its own copy of a name.
 *
 * At this scale the whole customer book is sent with the page, because Bookings and Jobs point at customers, properties and
 * equipment and show their names. Windowing the book (and the operations) by date and page is the next scaling step; see
 * docs/saas-architecture.md.
 */
import type { MonthTotals } from "@/lib/analytics-rules";
import type { CustomerBook } from "./customers";
import type { FinancialData } from "./financials";
import type { PlanAdjustment, PlansData } from "./maintenance-plans";
import type { MarketingData } from "./marketing";
import type { MarketplaceState } from "./marketplace";
import type { OperationsData } from "./operations";
import type { ReviewAdjustment, ReviewsData } from "./reviews";
import type { Service } from "./services";
import type { TeamData } from "./team";
import type { WebsiteState } from "./website";

export type Directory = CustomerBook & {
  services: readonly Service[];
  team: TeamData;
};

/** What the server sends the browser for the active workspace. */
export type CoreSnapshot = {
  services: readonly Service[];
  team: TeamData;
  book: CustomerBook;
  /** The business's Bookings, Jobs and blocked time: the Schedule is derived from these. */
  operations: OperationsData;
  /** The business's Quotes, Invoices and Payments: balances and statuses are derived from these. */
  financials: FinancialData;
  /** The business's Maintenance Plans with their coverage and visits: a visit's state is derived from its Booking in `operations`. */
  maintenance: PlansData;
  /** The business's Reviews (each with its one reply) and the review requests it recorded. */
  reviews: ReviewsData;
  /** The business's Marketing campaigns. Their recipients are not here: a page asks the server for one campaign's snapshot at a time. */
  marketing: MarketingData;
  /** The primary Site's Draft and Published snapshot, its addresses and publishing state; null when the business has no website yet. */
  website: WebsiteState | null;
  /** The business's Marketplace listing configuration (not set up, until it sets one up). */
  marketplace: MarketplaceState;
  /**
   * What the browser needs of the reporting layer for the active business: the imported adjustments to its Plans and Reviews totals
   * (none for a business without reporting history), and the headline totals of its current month for the Overview and the sidebar.
   */
  reporting: { adjustments: { plans: PlanAdjustment; reviews: ReviewAdjustment }; month: MonthTotals };
};
