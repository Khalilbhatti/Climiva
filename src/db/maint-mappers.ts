/**
 * Maintenance Plans: rows <-> the shapes the screens already use.
 *
 * The UI types (MaintenancePlan, PlanVisit) predate the database and stay as they are; this file is the only place that knows
 * how they map to columns. A plan's `id` in the UI is its reference ("plan-sarah-comfort-care") and a visit's is its own
 * ("plan-sarah-comfort-care-v2"); the people and places a plan points at are their slugs. The database uuids never leave the
 * server. Prices leave as dollars (cents divided by 100), a display value; dates are the business's calendar dates and cross
 * unchanged.
 *
 * No `server-only` here on purpose: the seed and the tests import it too.
 */
import type { CoverageId, MaintenancePlan, PlanCadence, PlanStatus, PlanVisit } from "@/data/maintenance-plans";
import { fromCents } from "@/lib/money";
import type { SlugLookup } from "./ops-mappers";
import type { MaintenancePlanCoverageRow, MaintenancePlanRow, MaintenancePlanVisitRow } from "./schema";

const orUndefined = <T,>(value: T | null | undefined): T | undefined => (value === null || value === undefined ? undefined : value);

export function visitFromRow(row: MaintenancePlanVisitRow, coverageKeyById: ReadonlyMap<string, CoverageId>): PlanVisit {
  const completed = row.status === "completed";
  return {
    id: row.ref,
    sequence: row.sequence,
    label: row.label,
    coverageId: row.coverageId ? coverageKeyById.get(row.coverageId) : undefined,
    windowStart: orUndefined(row.windowStart),
    windowEnd: orUndefined(row.windowEnd),
    completed: completed ? true : undefined,
    completedOn: orUndefined(row.completedOn),
  };
}

export function planFromRow(
  row: MaintenancePlanRow,
  coverage: readonly MaintenancePlanCoverageRow[],
  visits: readonly MaintenancePlanVisitRow[],
  lookup: Pick<SlugLookup, "customers" | "properties">,
): MaintenancePlan {
  const sortedCoverage = [...coverage].sort((a, b) => a.sortOrder - b.sortOrder);
  const keyById = new Map(sortedCoverage.map((item) => [item.id, item.coverageKey as CoverageId]));
  return {
    id: row.slug,
    customerId: row.customerId ? lookup.customers.get(row.customerId) : undefined,
    contactName: orUndefined(row.contactName),
    propertyId: row.propertyId ? lookup.properties.get(row.propertyId) : undefined,
    propertyText: orUndefined(row.propertyText),
    name: row.name,
    status: row.status as PlanStatus,
    price: fromCents(row.priceCents),
    cadence: row.cadence as PlanCadence,
    startDate: orUndefined(row.startDate),
    endDate: orUndefined(row.endDate),
    coverage: sortedCoverage.map((item) => ({ coverageId: item.coverageKey as CoverageId, visits: item.visits })),
    visitsPerYear: row.visitsPerYear,
    visits: [...visits].sort((a, b) => a.sequence - b.sequence).map((visit) => visitFromRow(visit, keyById)),
    statusNote: orUndefined(row.statusNote),
    note: orUndefined(row.note),
    imported: row.imported ? true : undefined,
  };
}
