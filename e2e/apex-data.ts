/**
 * The canonical records of the Apex sample business, as the pure-data specs read them.
 *
 * They are the same records the seed script writes to PostgreSQL (scripts/db/seed-data); the app itself reads them from the
 * database, so a spec that needs them as plain values imports them here rather than from the application's source.
 * That includes the operations (bookings, jobs, blocked time), the financials (quotes, invoices, payments), the maintenance plans and
 * the reviews: they ship to no browser either.
 */
import type { CustomerBook } from "../src/data/customers";
import type { Directory } from "../src/data/directory";
import { PROTOTYPE_TODAY } from "../src/data/fixtures";
import { getPlanContribution, type PlanAdjustment } from "../src/data/maintenance-plans";
import { getReviewContribution, type ReviewAdjustment } from "../src/data/reviews";
import type { TeamData } from "../src/data/team";
import { CUSTOMERS, EQUIPMENT, PROPERTIES } from "../scripts/db/seed-data/customers";
import { FINANCIALS, INVOICES, PAYMENTS, QUOTES } from "../scripts/db/seed-data/financials";
import { MAINTENANCE, PLANS } from "../scripts/db/seed-data/maintenance";
import { COOLING_TUNE_UP_RECIPIENTS, MARKETING } from "../scripts/db/seed-data/marketing";
import { NORTHSTAR_MARKETING } from "../scripts/db/seed-data/northstar";
import { APEX_APPROVED, APEX_REPORT_PERIOD, NORTHSTAR_APPROVED } from "../scripts/db/seed-data/reporting";
import { REVIEWS, REVIEWS_DATA, SARAH_REPLY } from "../scripts/db/seed-data/reviews";
import { SERVICES } from "../scripts/db/seed-data/services";
import { BOOKINGS, JOBS, OPERATIONS, SCHEDULE_BLOCKS } from "../scripts/db/seed-data/operations";
import { ROLES, TEAM } from "../scripts/db/seed-data/team";

export { APEX_APPROVED, APEX_REPORT_PERIOD, BOOKINGS, COOLING_TUNE_UP_RECIPIENTS, CUSTOMERS, EQUIPMENT, FINANCIALS, INVOICES, JOBS, MAINTENANCE, MARKETING, NORTHSTAR_APPROVED, NORTHSTAR_MARKETING, OPERATIONS, PAYMENTS, PLANS, PROPERTIES, QUOTES, REVIEWS, REVIEWS_DATA, ROLES, SARAH_REPLY, SCHEDULE_BLOCKS, SERVICES, TEAM };

export const BOOK: CustomerBook = { customers: CUSTOMERS, properties: PROPERTIES, equipment: EQUIPMENT };
export const TEAM_DATA: TeamData = { members: TEAM, roles: ROLES };
/** The sample business's plans as the selectors take them (the seed's visits also carry the booking that schedules them, which the screens derive). */
export const PLANS_DATA = { plans: PLANS };
/** Customers, properties, equipment, Services and team: what `useDirectory()` hands the app for the sample business. */
export const DIR: Directory = { ...BOOK, services: SERVICES, team: TEAM_DATA };

/**
 * The sample business's approved Overview totals for its reporting month (October 2024): Bookings 24, Completed Jobs 18, Total Invoiced $6,240,
 * Payments Received $2,130 from 7 recorded payments. Worked out by the reporting layer from its records plus the imported adjustments; written
 * here only as what the specs expect.
 */
export const OVERVIEW_TOTALS = { bookings: 24, completedJobs: 18, totalInvoiced: 6240, paymentsReceived: 2130, recordedPayments: 7 } as const;

/** What the stored sample records add up to on their own, before any imported adjustment. */
export const STORED_INVOICED = 3010;

/** The imported adjustment to the Maintenance Plans totals: the approved 14 / 5 / 3 / 1 / 1 minus what the stored plans contribute. */
export const PLAN_ADJUSTMENT: PlanAdjustment = (() => {
  const approved = APEX_APPROVED.plans!;
  const own = getPlanContribution(PLANS_DATA, OPERATIONS, PROTOTYPE_TODAY);
  return { active: approved.active - own.active, visitsDue: approved.visitsDue - own.visitsDue, renewals: approved.renewals - own.renewals, paused: approved.paused - own.paused, ended: approved.ended - own.ended };
})();

/** The imported adjustment to the Reviews totals: the approved 12 reviews / 56 points / 3 awaiting / 5 requests minus what the stored reviews contribute. */
export const REVIEW_ADJUSTMENT: ReviewAdjustment = (() => {
  const approved = APEX_APPROVED.reviews!;
  const own = getReviewContribution(REVIEWS_DATA);
  return { count: approved.count - own.count, ratingSum: approved.ratingSum - own.ratingSum, awaiting: approved.awaiting - own.awaiting, requests: approved.requests - own.requests };
})();
