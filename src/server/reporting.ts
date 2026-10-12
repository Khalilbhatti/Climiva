import "server-only";
import { cache } from "react";
import { getAnalyticsReport, getPeriodReport } from "@/db/reporting-queries";
import { withTenant } from "@/db/tenant";
import { monthTotalsOf, presetRange, resolveRange, type AnalyticsReport, type MonthTotals } from "@/lib/analytics-rules";
import { getCoreSnapshot } from "./core-data";
import { requireWorkspaceContext } from "./workspace";

/**
 * Reading the reporting layer for the ACTIVE organization.
 *
 * Every reader resolves the workspace itself (a verified session, a verified active membership) and runs inside the tenant
 * transaction, so PostgreSQL's Row Level Security applies on top of the explicit organization predicates in src/db/reporting-queries.
 * None takes an organization from its arguments, and the only things taken from the URL are the three range parameters, which
 * lib/analytics-rules parses against the approved presets and the custom bounds (anything else is the default range).
 *
 * `cache()` memoises within ONE request; React's cache is scoped to the request and is never shared between people or businesses.
 */

/** The current month's headline totals of the active business: the Overview's four numbers (it is the same report Analytics shows). */
export const getMonthTotals = cache(async (): Promise<MonthTotals> => {
  const { userId, organizationId, snapshot } = await requireWorkspaceContext();
  const report = await withTenant({ userId, organizationId }, (tx) => getPeriodReport(tx, organizationId, presetRange("this-month", snapshot.clock.today)));
  return monthTotalsOf(report);
});

/** The Analytics report of the active business for the range the URL asks for. */
export const getAnalytics = cache(async (range: string | null, from: string | null, to: string | null): Promise<AnalyticsReport> => {
  const { userId, organizationId, organization, snapshot } = await requireWorkspaceContext();
  const selected = resolveRange(range, from, to, snapshot.clock.today);
  // The plans, reviews and campaigns are counted from the records the workspace already read for this request.
  const core = await getCoreSnapshot();
  return withTenant({ userId, organizationId }, (tx) =>
    getAnalyticsReport(tx, {
      organizationId,
      timeZone: organization.timezone,
      today: snapshot.clock.today,
      range: selected,
      records: core ? { operations: core.operations, maintenance: core.maintenance, reviews: core.reviews, marketing: core.marketing } : undefined,
    }),
  );
});
