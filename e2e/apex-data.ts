/**
 * The canonical records of the Apex sample business, as the pure-data specs read them.
 *
 * They are the same records the seed script writes to PostgreSQL (scripts/db/seed-data); the app itself reads them from the
 * database, so a spec that needs them as plain values imports them here rather than from the application's source.
 * That includes the operations (bookings, jobs, blocked time) and the financials (quotes, invoices, payments): they ship to no
 * browser either.
 */
import type { CustomerBook } from "../src/data/customers";
import type { Directory } from "../src/data/directory";
import type { TeamData } from "../src/data/team";
import { CUSTOMERS, EQUIPMENT, PROPERTIES } from "../scripts/db/seed-data/customers";
import { FINANCIALS, INVOICES, PAYMENTS, QUOTES } from "../scripts/db/seed-data/financials";
import { SERVICES } from "../scripts/db/seed-data/services";
import { BOOKINGS, JOBS, OPERATIONS, SCHEDULE_BLOCKS } from "../scripts/db/seed-data/operations";
import { ROLES, TEAM } from "../scripts/db/seed-data/team";

export { BOOKINGS, CUSTOMERS, EQUIPMENT, FINANCIALS, INVOICES, JOBS, OPERATIONS, PAYMENTS, PROPERTIES, QUOTES, ROLES, SCHEDULE_BLOCKS, SERVICES, TEAM };

export const BOOK: CustomerBook = { customers: CUSTOMERS, properties: PROPERTIES, equipment: EQUIPMENT };
export const TEAM_DATA: TeamData = { members: TEAM, roles: ROLES };
/** Customers, properties, equipment, Services and team: what `useDirectory()` hands the app for the sample business. */
export const DIR: Directory = { ...BOOK, services: SERVICES, team: TEAM_DATA };
