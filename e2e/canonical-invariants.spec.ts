/**
 * Phase 8, Part J. The canonical facts every module must agree on, read from the real exported data and the same
 * selectors the screens use, so a change to one module that the others do not follow fails here by name. Aggregates
 * that describe more history than the sample records (Analytics, the Overview counts) are checked against their own
 * baselines, never forced to equal the sample.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { paymentAmountError } from "../src/lib/financial-rules";
import { getCustomerById, getPropertiesForCustomer, getPropertyById } from "../src/data/customers";
import {
  getInvoiceBalance,
  getInvoiceById,
  getInvoiceStatus,
  getOutstandingBalance,
  getOutstandingInvoices,
  getPaymentsReceivedTotal,
  getRecordedPaymentsCount,
  getTotalInvoiced,
} from "../src/data/financials";
import { BUSINESS_TIME_ZONE, PROTOTYPE_NOW, PROTOTYPE_TODAY, business, businessHoursByWeekday, currentUser } from "../src/data/fixtures";
import { COVERAGE, getCurrentPlanForCustomer, getPlanById, getPlanMetrics, getVisitState } from "../src/data/maintenance-plans";
import { getCampaignMetrics } from "../src/data/marketing";
import { getEligibleServices, getListingServices } from "../src/data/marketplace";
import { getBookingById, getJobById } from "../src/data/operations";
import { getReviewById, getReviewMetrics } from "../src/data/reviews";
import { getPublicActiveServices } from "../src/data/services";
import { initialSettings } from "../src/data/settings";
import { getTeamMemberById } from "../src/data/team";
import { getShownServices } from "../src/data/website";
import { APEX_APPROVED, APEX_CONTENT, APEX_LISTING, BOOK, BOOKINGS, CUSTOMERS, FINANCIALS, INVOICES, JOBS, MARKETING, OPERATIONS, OVERVIEW_TOTALS, PLANS, PLANS_DATA, PLAN_ADJUSTMENT, REVIEWS, REVIEWS_DATA, REVIEW_ADJUSTMENT, ROLES, SCHEDULE_BLOCKS, SERVICES, STORED_INVOICED, TEAM, TEAM_DATA } from "./apex-data";
import { withPayment } from "./financial-edits";

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
    const everything = JSON.stringify([CUSTOMERS, TEAM, ROLES, BOOKINGS, JOBS, FINANCIALS, PLANS, REVIEWS, MARKETING, SERVICES]);
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
    // With nothing hidden the Website shows every public Service, in the catalog's order: the site owns only which are hidden and in what order.
    expect(getShownServices(APEX_CONTENT.settings.serviceDisplay, SERVICES).map((service) => service.id)).toEqual(getPublicActiveServices(SERVICES).map((service) => service.id));
    expect(getEligibleServices(SERVICES).map((service) => service.id)).toEqual(getPublicActiveServices(SERVICES).map((service) => service.id));
    expect(APEX_CONTENT.pages.map((page) => page.key)).toEqual(["home", "services", "about", "contact", "booking"]);
  });

  test("the Marketplace opens with five of the six; Emergency No-Heat / No-Cool is the one not selected", () => {
    const emergency = "emergency-no-heat-no-cool";
    const listed = getListingServices(APEX_LISTING.config, SERVICES);
    expect(listed).toHaveLength(5);
    expect(listed.map((service) => service.id)).not.toContain(emergency);
    expect(SERVICES.find((service) => service.id === emergency)?.name).toBe("Emergency No-Heat / No-Cool Service");
    expect(APEX_LISTING.status).toBe("published");
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
    expect(getReviewById("rev-sarah-mitchell", REVIEWS_DATA)).toMatchObject({ customerId: "sarah-mitchell", relatedJobId: "JB-204", rating: 5 });
    expect(getCustomerById("sarah-mitchell", BOOK)?.lastService?.jobId).toBe("JB-204");
  });

  test("her Comfort Care plan is $189 a year, two visits, May 14 2024 to May 14 2025, and its cooling visit is already scheduled as BK-1048", () => {
    const plan = getCurrentPlanForCustomer("sarah-mitchell", PLANS_DATA)!;
    expect(plan).toMatchObject({ id: "plan-sarah-comfort-care", name: "Comfort Care", status: "active", price: 189, cadence: "year", visitsPerYear: 2, startDate: "2024-05-14", endDate: "2025-05-14", propertyId: "prop-sarah-home" });
    expect(plan.visits).toHaveLength(2);
    expect(getPlanById("plan-sarah-comfort-care", PLANS_DATA)).toBe(plan);
    // Visit 1 was fulfilled in May; visit 2 is scheduled, and BK-1048 is the one real booking it points at.
    expect(plan.visits.map((visit) => getVisitState(visit, OPERATIONS))).toEqual(["completed", "scheduled"]);
    expect(getBookingById("BK-1048", OPERATIONS)).toMatchObject({
      customerId: "sarah-mitchell",
      propertyId: "prop-sarah-home",
      source: "Maintenance plan",
      date: "2024-11-19",
      start: "10:00",
      end: "12:00",
      assigneeId: "marcus-vance",
      status: "confirmed",
      planVisit: { planId: "plan-sarah-comfort-care", visitId: "plan-sarah-comfort-care-v2" },
    });
    expect(getBookingById("BK-1048", OPERATIONS)?.jobId).toBeUndefined();
    expect(OPERATIONS.bookings.filter((booking) => booking.id === "BK-1048")).toHaveLength(1);
  });
});

test.describe("money", () => {
  test("the baseline: 7 payments recorded, $2,130 received, 2 outstanding invoices, $680 outstanding", () => {
    expect(getRecordedPaymentsCount(FINANCIALS)).toBe(7);
    expect(getPaymentsReceivedTotal(FINANCIALS)).toBe(2130);
    expect(getOutstandingInvoices(FINANCIALS)).toHaveLength(2);
    expect(getOutstandingBalance(FINANCIALS)).toBe(680);
    // The stored invoices add up to $3,010; the approved $6,240 the Overview reports is those records plus imported history (reporting layer).
    expect(getTotalInvoiced(FINANCIALS)).toBe(STORED_INVOICED);
    expect(OVERVIEW_TOTALS).toMatchObject({ totalInvoiced: 6240, paymentsReceived: 2130, recordedPayments: 7 });
    expect(APEX_APPROVED.invoices?.totalCents).toBe(624_000);
  });

  test("#INV-1044 is paid and cannot take another payment; #INV-1050 owes $300", () => {
    const paid = getInvoiceById("INV-1044", FINANCIALS)!;
    expect(getInvoiceStatus(paid, FINANCIALS)).toBe("paid");
    expect(getInvoiceBalance(paid, FINANCIALS)).toBe(0);
    // The rule the server applies before it records anything: nothing can be recorded against a balance of $0.
    expect(paymentAmountError(100, 0)).toMatch(/no balance due/);
    expect(getInvoiceBalance(getInvoiceById("INV-1050", FINANCIALS)!, FINANCIALS)).toBe(300);
    expect(INVOICES.length).toBeGreaterThan(2);
  });

  test("with $300 recorded on #INV-1050 the selectors answer: 8 payments, $2,430, 1 outstanding invoice, $380", () => {
    // The recording itself is the server's (financials-flows.spec.ts does it through the screen); this is what the totals do with it.
    const { data, payment } = withPayment(FINANCIALS, "INV-1050", 300, { method: "cash", date: PROTOTYPE_TODAY });
    expect(payment.id).toBe("PAY-1009");
    expect(getRecordedPaymentsCount(data)).toBe(8);
    expect(getPaymentsReceivedTotal(data)).toBe(2430);
    expect(getOutstandingInvoices(data)).toHaveLength(1);
    expect(getOutstandingBalance(data)).toBe(380);
    expect(getInvoiceStatus(getInvoiceById("INV-1050", data)!, data)).toBe("paid");
    // The canonical records themselves are untouched.
    expect(getRecordedPaymentsCount(FINANCIALS)).toBe(7);
  });
});

test.describe("Growth and Insights baselines", () => {
  test("Reviews: 12 reviews, 4.7 average, 3 awaiting a reply, 5 requests", () => {
    expect(APEX_APPROVED.reviews).toEqual({ count: 12, average: 4.7, ratingSum: 56, awaiting: 3, requests: 5 });
    expect(getReviewMetrics(REVIEWS_DATA, REVIEW_ADJUSTMENT)).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
  });

  test("Marketing: 2 drafts, 1 scheduled, 8 sent, 146 recent recipients, counted from the eleven stored campaigns", () => {
    expect(getCampaignMetrics({ campaigns: MARKETING.campaigns }, PROTOTYPE_TODAY)).toMatchObject({ drafts: 2, scheduled: 1, sent: 8, total: 11, recentRecipients: 146 });
  });

  test("Maintenance Plans: the approved workspace totals", () => {
    expect(APEX_APPROVED.plans).toEqual({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1 });
    expect(getPlanMetrics(PLANS_DATA, OPERATIONS, PROTOTYPE_TODAY, PLAN_ADJUSTMENT)).toMatchObject({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1 });
  });

  test("Analytics: the approved aggregates are internally consistent and are not forced to equal the sample records", () => {
    const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
    const approved = APEX_APPROVED;
    expect(sum(Object.values(approved.bookings!))).toBe(24);
    expect(sum(Object.values(approved.jobs!))).toBe(24);
    expect(approved.jobs!.completed).toBe(18);
    expect(sum(approved.weekly!.map((week) => week.bookings))).toBe(24);
    expect(sum(approved.weekly!.map((week) => week.completedJobs))).toBe(18);
    expect(sum(approved.services!.map((row) => row.bookings))).toBe(24);
    expect(sum(approved.services!.map((row) => row.completedJobs))).toBe(18);
    expect(approved.quotes).toMatchObject({ valueCents: 482_000, approvedValueCents: 297_500 });
    expect(sum(Object.values(approved.quotes!.counts))).toBe(12);
    expect(sum(Object.values(approved.invoices!.counts))).toBe(18);
    // The sample is smaller than the aggregate, by design.
    expect(BOOKINGS.length).toBeLessThan(24 + 1);
    expect(JOBS.filter((job) => job.status === "completed").length).toBeLessThan(18);
    for (const row of approved.services!) expect(SERVICES.some((service) => service.id === row.serviceId), row.serviceId).toBe(true);
  });
});
