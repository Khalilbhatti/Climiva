/**
 * Reporting: the queries behind Analytics, the Overview totals and the sidebar counts.
 *
 * Analytics is a reading layer over the domain tables; it has no tables of its own besides the imported baseline. Every function
 * here takes an open transaction (`tx`) and the organization it reports on, and names that organization in every statement's WHERE
 * clause. They are meant to be called from `withTenant(...)`, where Row Level Security enforces the same boundary again. The seed
 * calls the same functions on the owner connection to reconcile the sample business to its approved figures.
 *
 * A report is two explicit sources, kept apart until `composeReport`:
 *   - the DETAILED rows the date range selects, counted by PostgreSQL (aggregates, grouped, indexed on organization and date); and
 *   - the IMPORTED adjustments (analytics_imported_baselines) the range covers, which exist only for the sample business.
 * See lib/analytics-rules for how they are combined, and docs/saas-architecture.md for why nothing can be counted twice.
 *
 * No `server-only` import on purpose: scripts and tests use these too. Nothing under src/ that is a Client Component may import
 * this file (a test enforces it).
 */
import { eq, sql } from "drizzle-orm";
import type { MarketingData } from "@/data/marketing";
import { getCampaignMetrics, type CampaignMetrics } from "@/data/marketing";
import type { InvoiceStatus, QuoteStatus } from "@/data/financials";
import { getPlanMetrics, type PlanMetrics, type PlansData } from "@/data/maintenance-plans";
import type { OperationsData } from "@/data/operations";
import { getReviewMetrics, type ReviewMetrics, type ReviewsData } from "@/data/reviews";
import {
  adjustmentPeriod,
  composeFinancials,
  composeOperations,
  covers,
  kpisOf,
  type AdjustmentRow,
  type AnalyticsReport,
  type DateRange,
  type DatedCount,
  type DetailedFacts,
  type FinancialReport,
  type OperationsReport,
} from "@/lib/analytics-rules";
import { loadAdjustments, planAdjustmentOf, reviewAdjustmentOf } from "./adjustments";
import type { Tx } from "./index";
import { loadMarketing } from "./marketing-queries";
import { loadMaintenance } from "./maint-queries";
import { loadOperations } from "./ops-queries";
import { loadReviews } from "./review-queries";
import { services } from "./schema";

/* ───────────────────────── the detailed rows ───────────────────────── */

type CountRow = { day: string; status: string; service: string | null; n: number };

const toDated = (rows: readonly CountRow[]): DatedCount[] => rows.map((row) => ({ date: row.day, status: row.status, service: row.service, count: Number(row.n) }));

/**
 * What the database counts for a date range, before any imported adjustment. Bookings and Jobs are selected by the day of the
 * service, Quotes by the day they were created, Invoices by the day they were issued and Payments by the day they were paid. The
 * status of an Invoice is worked out the way the Payments module works it out (paid when nothing is owed, partially paid when
 * something has been received, otherwise unpaid), and an invoice's balance counts every recorded payment, whenever it was made.
 */
export async function loadDetailedFacts(tx: Tx, organizationId: string, range: Pick<DateRange, "from" | "to">): Promise<DetailedFacts> {
  const { from, to } = range;

  const bookings = await tx.execute<CountRow>(sql`
    select b.service_date::text as day, b.status, s.slug as service, count(*)::int as n
      from bookings b
      left join services s on s.organization_id = b.organization_id and s.id = b.service_id
     where b.organization_id = ${organizationId} and b.service_date between ${from} and ${to}
     group by b.service_date, b.status, s.slug`);

  const jobs = await tx.execute<CountRow>(sql`
    select j.service_date::text as day, j.status, s.slug as service, count(*)::int as n
      from jobs j
      left join services s on s.organization_id = j.organization_id and s.id = j.service_id
     where j.organization_id = ${organizationId} and j.service_date between ${from} and ${to}
     group by j.service_date, j.status, s.slug`);

  const quotes = await tx.execute<{ status: QuoteStatus; n: number; value: string }>(sql`
    select q.status, count(*)::int as n,
           coalesce(sum(coalesce((select sum(l.line_total_cents) from quote_line_items l where l.organization_id = q.organization_id and l.quote_id = q.id), 0)), 0)::bigint as value
      from quotes q
     where q.organization_id = ${organizationId} and q.created_on between ${from} and ${to}
     group by q.status`);

  const invoices = await tx.execute<{ status: InvoiceStatus; n: number; total: string; balance: string }>(sql`
    with inv as (
      select coalesce((select sum(l.line_total_cents) from invoice_line_items l where l.organization_id = i.organization_id and l.invoice_id = i.id), 0) as total,
             i.previously_paid_cents as previous,
             coalesce((select sum(p.amount_cents) from payments p where p.organization_id = i.organization_id and p.invoice_id = i.id and p.status = 'recorded'), 0) as recorded
        from invoices i
       where i.organization_id = ${organizationId} and i.issue_date between ${from} and ${to}
    ), owed as (
      select total, previous + recorded as paid, greatest(0, total - previous - recorded) as balance from inv
    )
    select case when balance = 0 then 'paid' when paid > 0 then 'partially-paid' else 'unpaid' end as status,
           count(*)::int as n, sum(total)::bigint as total, sum(balance)::bigint as balance
      from owed
     group by 1`);

  const received = await tx.execute<{ n: number; amount: string }>(sql`
    select count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as amount
      from payments
     where organization_id = ${organizationId} and status = 'recorded' and paid_on between ${from} and ${to}`);

  const voided = await tx.execute<{ number: number; amount: number }>(sql`
    select number, amount_cents as amount
      from payments
     where organization_id = ${organizationId} and status = 'voided' and paid_on between ${from} and ${to}
     order by number`);

  const names = await tx.select({ slug: services.slug, name: services.name }).from(services).where(eq(services.organizationId, organizationId));

  return {
    bookings: toDated(bookings.rows),
    jobs: toDated(jobs.rows),
    quotes: quotes.rows.map((row) => ({ status: row.status, count: Number(row.n), valueCents: Number(row.value) })),
    invoices: invoices.rows.map((row) => ({ status: row.status, count: Number(row.n), totalCents: Number(row.total), balanceCents: Number(row.balance) })),
    payments: {
      recorded: Number(received.rows[0]?.n ?? 0),
      receivedCents: Number(received.rows[0]?.amount ?? 0),
      voided: voided.rows.map((row) => ({ number: Number(row.number), amountCents: Number(row.amount) })),
    },
    serviceNames: new Map(names.map((row) => [row.slug, row.name])),
  };
}

/* ───────────────────────── the reporting functions ───────────────────────── */

export type ReportOptions = {
  /** Whether the imported adjustments are part of the answer. True by default; the seed asks for the detailed rows alone. */
  includeImported?: boolean;
};

/** Bookings, Jobs, the weekly activity and the Service table for a range. */
export async function getOperationsAnalytics(tx: Tx, organizationId: string, range: DateRange, options: ReportOptions = {}): Promise<OperationsReport> {
  const facts = await loadDetailedFacts(tx, organizationId, range);
  const rows = options.includeImported === false ? [] : await loadAdjustments(tx, organizationId);
  return composeOperations(facts, rows, range);
}

/** Quotes, Invoices and Payments for a range. */
export async function getFinancialAnalytics(tx: Tx, organizationId: string, range: DateRange, options: ReportOptions = {}): Promise<FinancialReport> {
  const facts = await loadDetailedFacts(tx, organizationId, range);
  const rows = options.includeImported === false ? [] : await loadAdjustments(tx, organizationId);
  return composeFinancials(facts, rows, range);
}

/** Maintenance plan totals, as of `today`, from the business's plans and the plan adjustment. */
export function getMaintenanceAnalytics(plans: PlansData, operations: OperationsData, today: string, rows: readonly AdjustmentRow[]): PlanMetrics {
  return getPlanMetrics(plans, operations, today, planAdjustmentOf(rows));
}

/** Review totals from the business's reviews and the review adjustment. The average is always (sum of ratings) / (number of reviews). */
export function getReviewAnalytics(reviews: ReviewsData, rows: readonly AdjustmentRow[]): ReviewMetrics {
  return getReviewMetrics(reviews, reviewAdjustmentOf(rows));
}

/** Campaign totals from the business's campaigns. */
export function getMarketingAnalytics(marketing: MarketingData, today: string): CampaignMetrics {
  return getCampaignMetrics(marketing, today);
}

/** The part of a report that depends on the range alone: what the Overview and the sidebar need. */
export type PeriodReport = OperationsReport & FinancialReport & { range: DateRange; kpis: AnalyticsReport["kpis"]; imported: AnalyticsReport["imported"] };

export async function getPeriodReport(tx: Tx, organizationId: string, range: DateRange, options: ReportOptions = {}): Promise<PeriodReport> {
  const facts = await loadDetailedFacts(tx, organizationId, range);
  const rows = options.includeImported === false ? [] : await loadAdjustments(tx, organizationId);
  const operations = composeOperations(facts, rows, range);
  const financials = composeFinancials(facts, rows, range);
  const period = adjustmentPeriod(rows);
  return {
    range,
    ...operations,
    ...financials,
    kpis: kpisOf(operations, financials),
    imported: { period, included: period !== null && covers(range, { periodStart: period.from, periodEnd: period.to }) },
  };
}

export type ReportInput = ReportOptions & {
  organizationId: string;
  timeZone: string;
  /** The business's own today (the sample business's fixed day). */
  today: string;
  range: DateRange;
  /** The records the "as of today" figures are counted from. Read from the database when not given. */
  records?: { operations: OperationsData; maintenance: PlansData; reviews: ReviewsData; marketing: MarketingData };
};

/** The whole Analytics report for a range: the period figures and the as-of totals for plans, reviews and campaigns. */
export async function getAnalyticsReport(tx: Tx, input: ReportInput): Promise<AnalyticsReport> {
  const { organizationId, timeZone, today, range } = input;
  const period = await getPeriodReport(tx, organizationId, range, input);
  const rows = input.includeImported === false ? [] : await loadAdjustments(tx, organizationId);
  const records = input.records ?? {
    operations: await loadOperations(tx, organizationId, timeZone),
    maintenance: await loadMaintenance(tx, organizationId),
    reviews: await loadReviews(tx, organizationId, timeZone),
    marketing: await loadMarketing(tx, organizationId, timeZone),
  };
  return {
    ...period,
    today,
    plans: getMaintenanceAnalytics(records.maintenance, records.operations, today, rows),
    reviews: getReviewAnalytics(records.reviews, rows),
    marketing: getMarketingAnalytics(records.marketing, today),
  };
}
