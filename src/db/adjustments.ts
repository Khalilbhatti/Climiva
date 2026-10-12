/**
 * The imported reporting adjustments of one business (analytics_imported_baselines), read for the active organization only.
 *
 * Kept apart from the reporting queries so the modules that need only the adjustments (the Marketing audience sizes, the browser's
 * Plans and Reviews totals) do not depend on the whole reporting layer. See db/schema/reporting for what an adjustment is.
 *
 * No `server-only` import on purpose: scripts and tests use these too.
 */
import { eq } from "drizzle-orm";
import { NO_PLAN_ADJUSTMENT, type PlanAdjustment } from "@/data/maintenance-plans";
import { NO_REVIEW_ADJUSTMENT, type ReviewAdjustment } from "@/data/reviews";
import { KEY, adjustmentOf, type AdjustmentRow } from "@/lib/analytics-rules";
import type { Tx } from "./index";
import { analyticsImportedBaselines } from "./schema";

/** Every imported adjustment of one business. Empty for any business without reporting history. */
export async function loadAdjustments(tx: Tx, organizationId: string): Promise<AdjustmentRow[]> {
  const rows = await tx.select().from(analyticsImportedBaselines).where(eq(analyticsImportedBaselines.organizationId, organizationId));
  return rows.map((row) => ({
    metricKey: row.metricKey,
    dimension: row.dimension,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    integerValue: row.integerValue,
    moneyCents: row.moneyCents,
  }));
}

/** The "as of today" plan adjustment (none have a period). */
export function planAdjustmentOf(rows: readonly AdjustmentRow[]): PlanAdjustment {
  if (rows.length === 0) return NO_PLAN_ADJUSTMENT;
  return {
    active: adjustmentOf(rows, null, KEY.planActive),
    visitsDue: adjustmentOf(rows, null, KEY.planVisitsDue),
    renewals: adjustmentOf(rows, null, KEY.planRenewals),
    paused: adjustmentOf(rows, null, KEY.planPaused),
    ended: adjustmentOf(rows, null, KEY.planEnded),
  };
}

/** The "as of today" review adjustment (none have a period). */
export function reviewAdjustmentOf(rows: readonly AdjustmentRow[]): ReviewAdjustment {
  if (rows.length === 0) return NO_REVIEW_ADJUSTMENT;
  return {
    count: adjustmentOf(rows, null, KEY.reviewCount),
    ratingSum: adjustmentOf(rows, null, KEY.reviewRatingSum),
    awaiting: adjustmentOf(rows, null, KEY.reviewAwaiting),
    requests: adjustmentOf(rows, null, KEY.reviewRequests),
  };
}

/** What the browser needs to show the Plans and Reviews totals: the two adjustments, for the active business only. */
export type ReportingAdjustments = { plans: PlanAdjustment; reviews: ReviewAdjustment };

export async function loadReportingAdjustments(tx: Tx, organizationId: string): Promise<ReportingAdjustments> {
  const rows = await loadAdjustments(tx, organizationId);
  return { plans: planAdjustmentOf(rows), reviews: reviewAdjustmentOf(rows) };
}

