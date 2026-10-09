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
import type { CustomerBook } from "./customers";
import type { FinancialData } from "./financials";
import type { OperationsData } from "./operations";
import type { Service } from "./services";
import type { TeamData } from "./team";

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
};
