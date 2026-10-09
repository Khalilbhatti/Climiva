/**
 * The directory: the business's customers, properties, equipment, Services and team, as the browser holds them.
 *
 * The workspace's server code reads these from PostgreSQL for the ACTIVE organization only and hands them to the providers
 * (components/workspace/DirectoryProvider). The modules that are not on the database yet (Bookings, Jobs, Schedule, the
 * money modules …) look people, places and Services up here by id, so none of them keeps its own copy of a name.
 *
 * Customers, properties and equipment are only loaded for a business that still runs on the sample operations data: they
 * are what that sample data points at. Any other business reads its customers page by page on the server.
 */
import type { CustomerBook } from "./customers";
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
};
