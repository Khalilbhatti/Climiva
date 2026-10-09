/**
 * Phase 8, Part J. The canonical facts every module must agree on, read from the real exported data and the same
 * selectors the screens use, so a change to one module that the others do not follow fails here by name. Aggregates
 * that describe more history than the sample records (Analytics, the Overview counts) are checked against their own
 * baselines, never forced to equal the sample.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { buildAnalytics } from "../src/lib/analytics-state";
import { recordPayment } from "../src/lib/financial-state";
import { getCustomerById, getPropertiesForCustomer, getPropertyById } from "../src/data/customers";
import {
  BOOKING_BREAKDOWN,
  JOB_BREAKDOWN,
  QUOTE_BASELINE,
  SERVICE_ACTIVITY,
  WEEKLY_ACTIVITY,
} from "../src/data/analytics";
import {
  FINANCIALS,
  INVOICES,
  getInvoiceBalance,
  getInvoiceById,
  getInvoiceStatus,
  getOutstandingBalance,
  getOutstandingInvoices,
  getPaymentsReceivedTotal,
  getRecordedPaymentsCount,
  getTotalInvoiced,
} from "../src/data/financials";
import { BUSINESS_TIME_ZONE, PROTOTYPE_NOW, PROTOTYPE_TODAY, business, businessHoursByWeekday, currentUser, overviewMetrics } from "../src/data/fixtures";
import { COVERAGE, PLANS, PLANS_DATA, PLAN_BASELINE, getCurrentPlanForCustomer, getPlanById, getPlanMetrics } from "../src/data/maintenance-plans";
import { CAMPAIGN_BASELINE, MARKETING_DATA, getCampaignMetrics } from "../src/data/marketing";
import { BASELINE_EXCLUDED_SERVICE_ID, getEligibleServices, getListingServices, initialMarketplaceState } from "../src/data/marketplace";
import { getBookingById, getJobById } from "../src/data/operations";
import { REVIEWS, REVIEWS_DATA, REVIEW_BASELINE, getReviewById, getReviewMetrics } from "../src/data/reviews";
import { getPublicActiveServices } from "../src/data/services";
import { initialSettings } from "../src/data/settings";
import { getTeamMemberById } from "../src/data/team";
import { WEBSITE_PAGES, defaultSiteContent, getShownServices } from "../src/data/website";
import { RESERVED_BOOKING_NUMBERS } from "../src/lib/operations-rules";
import { BOOK, BOOKINGS, CUSTOMERS, JOBS, OPERATIONS, ROLES, SCHEDULE_BLOCKS, SERVICES, TEAM, TEAM_DATA } from "./apex-data";

const SIX_SERVICES = [
  "AC Repair & Diagnostics",
  "Annual Cooling Tune-Up & Maintenance",
  "Heat Pump Diagnostics & Repair",
  "Emergency No-Heat / No-Cool Service",
  "Ductless Mini-Split Installation & Estimate",
  "Furnace Safety Inspection & Tune-Up",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?)$/.test(entry) ? [path] : [];
  });
}

test.describe("the business", () => {
  test("one record: name, phone, email, address, hours, time zone, currency", () => {
    expect(business.name).toBe("Apex Climate Heating & Air");
    expect(business.phone).toBe("(555) 392-8100");
    expect(business.email).toBe("service@apexclimate.com");
    expect(business.address).toEqual({ street: "4820 East Riverside Dr, Suite 110", city: "Austin", state: "TX", postalCode: "78741" });
    expect(business.hours).toEqual([
      { days: "Mon–Fri", hours: "7:30 AM–6:00 PM" },
      { days: "Sat", hours: "8:00 AM–2:00 PM" },
      { days: "Sun", hours: "Closed" },
    ]);
    expect(BUSINESS_TIME_ZONE).toBe("America/Chicago");
    expect(initialSettings.preferences.currency).toBe("USD");
  });

  test("Settings starts as that record, and its structured hours are the same hours", () => {
    expect(initialSettings.business).toEqual({ name: business.name, phone: business.phone, email: business.email, address: business.address });
    expect(initialSettings.preferences.timeZone).toBe(BUSINESS_TIME_ZONE);
    expect(initialSettings.hours).toEqual(businessHoursByWeekday);
    for (const day of [1, 2, 3, 4, 5]) expect(businessHoursByWeekday[day]).toEqual({ open: "07:30", close: "18:00" });
    expect(businessHoursByWeekday[6]).toEqual({ open: "08:00", close: "14:00" });
    expect(businessHoursByWeekday[0]).toBeNull();
  });

  test("the current user is Alex Morgan, Operations Lead, with no invented email, and is a Team member", () => {
    expect(currentUser).toEqual({ name: "Alex Morgan", role: "Operations Lead" });
    expect(initialSettings.profile).toEqual({ name: "Alex Morgan", role: "Operations Lead" });
    const member = getTeamMemberById("alex-morgan", TEAM_DATA);
    expect(member).toMatchObject({ name: "Alex Morgan", role: "Operations Lead", roleId: "owner" });
    expect(member?.email).toBeUndefined();
  });

  test("the product's fixed clock is Friday, October 25, 2024, business-local", () => {
    expect(PROTOTYPE_TODAY).toBe("2024-10-25");
    expect(PROTOTYPE_NOW).toBe("2024-10-25T10:45");
    expect(new Date(`${PROTOTYPE_TODAY}T12:00:00Z`).getUTCDay()).toBe(5);
  });

  test("the business facts are typed once: nothing else in the source repeats the phone, email or street", () => {
    const repeats: string[] = [];
    for (const file of sourceFiles("src")) {
      if (file.replace(/\\/g, "/").endsWith("src/data/fixtures.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const fact of [business.phone, business.email, business.address.street]) {
        // The only other mention is the format example in a comment and a validation hint.
        if (text.includes(fact) && !/settings-state\.ts$|format\.ts$/.test(file.replace(/\\/g, "/"))) repeats.push(`${file}: ${fact}`);
      }
    }
    expect(repeats).toEqual([]);
  });
});

test.describe("people", () => {
  test("Elena Rodriguez is the customer, and the stale spelling exists nowhere in the data", () => {
    expect(CUSTOMERS.filter((customer) => customer.name === "Elena Rodriguez")).toHaveLength(1);
    const everything = JSON.stringify([CUSTOMERS, TEAM, ROLES, BOOKINGS, JOBS, FINANCIALS, PLANS, REVIEWS, MARKETING_DATA, SERVICES]);
    expect(everything).not.toContain("Elena Rostova");
    expect(everything).not.toContain("Wake County");
    expect(everything).not.toContain("North Carolina");
  });

  test("Marcus Vance is one Team record, and Jobs, Schedule and Plans all point at it", () => {
    expect(TEAM.filter((member) => member.name === "Marcus Vance")).toHaveLength(1);
    expect(new Set(TEAM.map((member) => member.id)).size).toBe(TEAM.length);
    const ids = new Set(TEAM.map((member) => member.id));
    const assignees = JOBS.map((job) => job.assigneeId).filter((id): id is string => Boolean(id));
    expect(assignees).toContain("marcus-vance");
    for (const id of assignees) expect(ids.has(id), `job assignee ${id}`).toBe(true);
    for (const block of SCHEDULE_BLOCKS) for (const id of block.memberIds ?? []) expect(ids.has(id), `schedule block member ${id}`).toBe(true);
    // A plan visit has no technician of its own: once scheduled, its Booking and Job carry the same Team ids.
    for (const booking of BOOKINGS) if (booking.assigneeId) expect(ids.has(booking.assigneeId), `booking assignee ${booking.assigneeId}`).toBe(true);
  });

  test("Sarah Mitchell has exactly one property: Home, 1402 Kinney Ave, Austin, TX 78704", () => {
    const properties = getPropertiesForCustomer("sarah-mitchell", BOOK);
    expect(properties).toHaveLength(1);
    expect(properties[0]).toMatchObject({ id: "prop-sarah-home", label: "Home", street: "1402 Kinney Ave", city: "Austin", state: "TX", postalCode: "78704" });
    expect(getCustomerById("sarah-mitchell", BOOK)?.name).toBe("Sarah Mitchell");
  });
});

test.describe("the Services", () => {
  test("six public Services, with the approved names, and the plan labels are not Services", () => {
    const services = getPublicActiveServices(SERVICES);
    expect(services.map((service) => service.name)).toEqual(SIX_SERVICES);
    expect(SERVICES.map((service) => service.name)).toEqual(SIX_SERVICES);
    const names = SERVICES.map((service) => service.name.toLowerCase());
    for (const label of ["cooling maintenance", "heating maintenance", COVERAGE.cooling.name.toLowerCase(), COVERAGE.heating.name.toLowerCase()]) {
      expect(names, label).not.toContain(label);
    }
  });

  test("the Website and the Marketplace read that same list", () => {
    expect(getShownServices(defaultSiteContent(SERVICES).services, SERVICES).map((service) => service.id)).toEqual(getPublicActiveServices(SERVICES).map((service) => service.id));
    expect(getEligibleServices(SERVICES).map((service) => service.id)).toEqual(getPublicActiveServices(SERVICES).map((service) => service.id));
    expect(WEBSITE_PAGES.map((page) => page.id)).toEqual(["home", "services", "about", "contact", "booking"]);
  });

  test("the Marketplace opens with five of the six; Emergency No-Heat / No-Cool is the one not selected", () => {
    const listed = getListingServices(initialMarketplaceState(SERVICES).config, SERVICES);
    expect(listed).toHaveLength(5);
    expect(listed.map((service) => service.id)).not.toContain(BASELINE_EXCLUDED_SERVICE_ID);
    expect(SERVICES.find((service) => service.id === BASELINE_EXCLUDED_SERVICE_ID)?.name).toBe("Emergency No-Heat / No-Cool Service");
    expect(initialMarketplaceState(SERVICES).status).toBe("published");
  });
});

test.describe("Job #JB-204 and Sarah's record", () => {
  test("JB-204 is Sarah Mitchell's AC Repair & Diagnostics at her one property, Completed, from BK-1042", () => {
    const job = getJobById("JB-204", OPERATIONS)!;
    expect(job).toMatchObject({ customerId: "sarah-mitchell", serviceId: "ac-repair-diagnostics", propertyId: "prop-sarah-home", status: "completed", bookingId: "BK-1042" });
    expect(getPropertyById(job.propertyId!, BOOK)?.street).toBe("1402 Kinney Ave");
    expect(getBookingById("BK-1042", OPERATIONS)).toMatchObject({ customerId: "sarah-mitchell", status: "completed", jobId: "JB-204" });
  });

  test("Sarah's review points at JB-204, and her last service is JB-204", () => {
    expect(getReviewById("rev-sarah-mitchell")).toMatchObject({ customerId: "sarah-mitchell", relatedJobId: "JB-204", rating: 5 });
    expect(getCustomerById("sarah-mitchell", BOOK)?.lastService?.jobId).toBe("JB-204");
  });

  test("her Comfort Care plan is $189 a year, two visits, May 14 2024 to May 14 2025, and BK-1048 is held for its cooling visit", () => {
    const plan = getCurrentPlanForCustomer("sarah-mitchell")!;
    expect(plan).toMatchObject({ id: "plan-sarah-comfort-care", name: "Comfort Care", status: "active", price: 189, cadence: "year", visitsPerYear: 2, startDate: "2024-05-14", endDate: "2025-05-14", propertyId: "prop-sarah-home" });
    expect(plan.visits).toHaveLength(2);
    expect(getPlanById("plan-sarah-comfort-care", PLANS_DATA)).toBe(plan);
    expect(RESERVED_BOOKING_NUMBERS).toEqual({ "plan-sarah-comfort-care-v2": 1048 });
    // Not scheduled yet: the number is held, not used.
    expect(getBookingById("BK-1048", OPERATIONS)).toBeUndefined();
  });
});

test.describe("money", () => {
  test("the baseline: 7 payments recorded, $2,130 received, 2 outstanding invoices, $680 outstanding", () => {
    expect(getRecordedPaymentsCount()).toBe(7);
    expect(getPaymentsReceivedTotal()).toBe(2130);
    expect(getOutstandingInvoices()).toHaveLength(2);
    expect(getOutstandingBalance()).toBe(680);
    expect(getTotalInvoiced()).toBe(6240);
    expect(overviewMetrics).toMatchObject({ totalInvoiced: 6240, paymentsReceived: 2130, recordedPayments: 7 });
  });

  test("#INV-1044 is paid and cannot take another payment; #INV-1050 owes $300", () => {
    const paid = getInvoiceById("INV-1044")!;
    expect(getInvoiceStatus(paid)).toBe("paid");
    expect(getInvoiceBalance(paid)).toBe(0);
    expect(recordPayment(FINANCIALS, { invoiceId: "INV-1044", amount: 1, method: "cash", date: PROTOTYPE_TODAY }).payment).toBeUndefined();
    expect(getInvoiceBalance(getInvoiceById("INV-1050")!)).toBe(300);
    expect(INVOICES.length).toBeGreaterThan(2);
  });

  test("recording $300 on #INV-1050 makes #PAY-1009: 8 payments, $2,430, 1 outstanding invoice, $380", () => {
    const { data, payment } = recordPayment(FINANCIALS, { invoiceId: "INV-1050", amount: 300, method: "cash", date: PROTOTYPE_TODAY });
    expect(payment?.id).toBe("PAY-1009");
    expect(getRecordedPaymentsCount(data)).toBe(8);
    expect(getPaymentsReceivedTotal(data)).toBe(2430);
    expect(getOutstandingInvoices(data)).toHaveLength(1);
    expect(getOutstandingBalance(data)).toBe(380);
    expect(getInvoiceStatus(getInvoiceById("INV-1050", data)!, data)).toBe("paid");
    // The canonical records themselves are untouched.
    expect(getRecordedPaymentsCount()).toBe(7);
  });
});

test.describe("Growth and Insights baselines", () => {
  test("Reviews: 12 reviews, 4.7 average, 3 awaiting a reply, 5 requests", () => {
    expect(REVIEW_BASELINE).toEqual({ total: 12, average: 4.7, awaiting: 3, requests: 5 });
    expect(getReviewMetrics(REVIEWS_DATA)).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
  });

  test("Marketing: 2 drafts, 1 scheduled, 8 sent, 146 recent recipients", () => {
    expect(CAMPAIGN_BASELINE).toEqual({ draft: 2, scheduled: 1, sent: 8, recentRecipients: 146 });
    expect(getCampaignMetrics(MARKETING_DATA)).toMatchObject({ drafts: 2, scheduled: 1, sent: 8, total: 11, recentRecipients: 146 });
  });

  test("Maintenance Plans: the approved workspace totals", () => {
    expect(PLAN_BASELINE).toEqual({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1 });
  });

  test("Analytics: 24 Bookings, 18 Completed Jobs, $4,820 quoted, $6,240 invoiced, $2,130 received, all from the same sources", () => {
    const model = buildAnalytics(FINANCIALS, PLANS_DATA, OPERATIONS, SERVICES);
    expect(model.kpis).toEqual({ bookings: 24, completedJobs: 18, quoteValue: 4820, invoiced: 6240, paymentsReceived: 2130 });
    expect(model.bookings.total).toBe(24);
    expect(model.jobs.completed).toBe(18);
    expect(QUOTE_BASELINE.totalValue).toBe(4820);
    // The money and the plans are the shared selectors' answers, not a second copy.
    expect(model.payments.recorded).toBe(getRecordedPaymentsCount());
    expect(model.payments.received).toBe(getPaymentsReceivedTotal());
    expect(model.invoices.outstanding).toBe(getOutstandingBalance());
    expect(model.plans).toEqual(getPlanMetrics(PLANS_DATA, OPERATIONS));
    expect(model.plans.active).toBe(PLAN_BASELINE.active);
  });

  test("Analytics aggregates are internally consistent and are not forced to equal the sample records", () => {
    const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
    expect(sum(Object.values(BOOKING_BREAKDOWN))).toBe(24);
    expect(sum(Object.values(JOB_BREAKDOWN))).toBe(24);
    expect(sum(WEEKLY_ACTIVITY.map((week) => week.bookings))).toBe(24);
    expect(sum(WEEKLY_ACTIVITY.map((week) => week.completedJobs))).toBe(18);
    expect(sum(SERVICE_ACTIVITY.map((row) => row.bookings))).toBe(24);
    expect(sum(SERVICE_ACTIVITY.map((row) => row.completedJobs))).toBe(18);
    // The sample is smaller than the aggregate, by design.
    expect(BOOKINGS.length).toBeLessThan(24 + 1);
    expect(JOBS.filter((job) => job.status === "completed").length).toBeLessThan(18);
    for (const row of SERVICE_ACTIVITY) expect(SERVICES.some((service) => service.id === row.serviceId), row.serviceId).toBe(true);
  });
});
