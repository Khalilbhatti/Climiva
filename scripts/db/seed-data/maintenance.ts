/**
 * The canonical Apex Climate maintenance plans.
 *
 * SEED AND TEST INFRASTRUCTURE ONLY (nothing in src/ imports this file, so none of it is compiled into a browser bundle).
 * scripts/db/seed-lib.ts writes it to PostgreSQL for the sample business, with deterministic ids; the specs read it as the
 * expected record. Sources: design-reference/stitch/ maintenance_plans_*, maintenance_plan_detail_comfort_care and
 * create_maintenance_plan_flow; every conflict is listed in docs/stitch-screen-map.md §10. In short:
 *
 *  - Sarah Mitchell's Comfort Care is locked: $189 / year, 2 visits a year, May 14, 2024 to May 14, 2025, Active, covering
 *    Cooling maintenance and Heating maintenance (coverage labels, NOT Services). Visit 1 (heating) was fulfilled on May 22,
 *    2024 with no Booking or Job link (the Stitch ids conflict with other records). Visit 2 (cooling) is already SCHEDULED in the
 *    approved baseline: it points at the real Booking BK-1048 (Nov 19, 2024, 10:00 AM to 12:00 PM, Marcus Vance, confirmed, no
 *    Job), which scripts/db/seed-data/operations.ts writes. There is exactly one BK-1048, and the booking counter starts above it.
 *  - The six plans are `imported`: a representative sample of the workspace totals the screens report (14 active, 5 visits due,
 *    3 renewals, 1 paused, 1 ended), already inside them. Plans created since add to the totals.
 *  - People without a Customers record (Kevin Vance, Arthur Pendleton, Robert Miller, James Thornton) are a name and address
 *    snapshot, the same pattern bookings and jobs use.
 *
 * Prices are the display dollars the screens use; the database stores whole cents.
 */
import { COVERAGE } from "@/data/maintenance-plans";
import type { SeedPlans } from "@/db/maint-queries";

export const PLANS: SeedPlans["plans"] = [
  {
    id: "plan-sarah-comfort-care",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    name: "Comfort Care",
    status: "active",
    price: 189,
    cadence: "year",
    startDate: "2024-05-14",
    endDate: "2025-05-14",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    visits: [
      { id: "plan-sarah-comfort-care-v1", sequence: 1, label: COVERAGE.heating.name, coverageId: "heating", completed: true, completedOn: "2024-05-22" },
      {
        id: "plan-sarah-comfort-care-v2",
        sequence: 2,
        label: COVERAGE.cooling.name,
        coverageId: "cooling",
        windowStart: "2024-11-01",
        windowEnd: "2024-11-30",
        bookingId: "BK-1048",
      },
    ],
    imported: true,
  },
  {
    id: "plan-david-seasonal-maintenance",
    customerId: "david-chen",
    propertyId: "prop-david-home",
    name: "Seasonal Maintenance",
    status: "active",
    price: 29,
    cadence: "month",
    endDate: "2025-01-10",
    coverage: [],
    visitsPerYear: 2,
    visits: [
      { id: "plan-david-seasonal-maintenance-v1", sequence: 1, label: "Annual Precision Maintenance" },
      { id: "plan-david-seasonal-maintenance-v2", sequence: 2, label: "Seasonal maintenance visit" },
    ],
    imported: true,
  },
  {
    id: "plan-kevin-heating-cooling-care",
    contactName: "Kevin Vance",
    propertyText: "7401 Burnet Rd, Austin, TX",
    name: "Heating & Cooling Care",
    status: "active",
    price: 220,
    cadence: "year",
    endDate: "2024-11-30",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    visits: [
      { id: "plan-kevin-heating-cooling-care-v1", sequence: 1, label: COVERAGE.cooling.name, coverageId: "cooling", completed: true },
      { id: "plan-kevin-heating-cooling-care-v2", sequence: 2, label: COVERAGE.heating.name, coverageId: "heating", completed: true },
    ],
    imported: true,
  },
  {
    id: "plan-arthur-seasonal-maintenance",
    contactName: "Arthur Pendleton",
    propertyText: "1904 Guadalupe St, Austin, TX",
    name: "Seasonal Maintenance",
    status: "active",
    price: 29,
    cadence: "month",
    endDate: "2025-08-15",
    coverage: [],
    visitsPerYear: 2,
    visits: [
      { id: "plan-arthur-seasonal-maintenance-v1", sequence: 1, label: "Seasonal maintenance visit", completed: true },
      {
        id: "plan-arthur-seasonal-maintenance-v2",
        sequence: 2,
        label: "Heating Safety & Airflow Inspection",
        windowStart: "2024-12-01",
        windowEnd: "2024-12-31",
      },
    ],
    imported: true,
  },
  {
    id: "plan-robert-comfort-care",
    contactName: "Robert Miller",
    propertyText: "4502 Travis Heights Blvd, Austin, TX",
    name: "Comfort Care",
    status: "paused",
    price: 189,
    cadence: "year",
    endDate: "2025-08-22",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    statusNote: "Paused at customer request (renovations)",
    visits: [
      { id: "plan-robert-comfort-care-v1", sequence: 1, label: COVERAGE.cooling.name, coverageId: "cooling" },
      { id: "plan-robert-comfort-care-v2", sequence: 2, label: COVERAGE.heating.name, coverageId: "heating" },
    ],
    imported: true,
  },
  {
    id: "plan-james-seasonal-maintenance",
    contactName: "James Thornton",
    propertyText: "2801 Oakmont Blvd, Austin, TX",
    name: "Seasonal Maintenance",
    status: "ended",
    price: 29,
    cadence: "month",
    endDate: "2024-10-15",
    coverage: [],
    visitsPerYear: 2,
    statusNote: "Agreement ended on property sale (Oct 15, 2024)",
    visits: [
      { id: "plan-james-seasonal-maintenance-v1", sequence: 1, label: "Seasonal maintenance visit", completed: true },
      { id: "plan-james-seasonal-maintenance-v2", sequence: 2, label: "Seasonal maintenance visit", completed: true },
    ],
    imported: true,
  },
];

export const MAINTENANCE: SeedPlans = { plans: PLANS };
