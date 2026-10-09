import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { getPropertyById } from "../src/data/customers";
import { business, overviewMetrics } from "../src/data/fixtures";
import {
  COVERAGE,
  COVERAGE_IDS,
  PLANS,
  PLANS_DATA,
  getCustomerPlanSummary,
  getPlanById,
  getPlanMetrics,
  getPlanVisitForBooking,
  getUpcomingVisits,
  getVisitBooking,
  getVisitState,
} from "../src/data/maintenance-plans";
import type { Booking } from "../src/data/operations";
import {
  getInvoiceById,
  getOutstandingBalance,
  getPaymentsReceivedTotal,
  getRecordedPaymentsCount,
} from "../src/data/financials";
import { getPublicActiveServices } from "../src/data/services";
import {
  CLIMVIA_DOMAIN,
  DEFAULT_CUSTOM_DOMAIN,
  PAGE_SCHEMA,
  WEBSITE_PAGES,
  defaultSiteContent,
  getPageStatus,
  getPrimaryDomain,
  getShownServices,
  hasUnpublishedChanges,
  initialWebsiteState,
} from "../src/data/website";
import { createPlan } from "../src/lib/maintenance-plans-state";
import {
  connectCustomDomain,
  makeClimviaPrimary,
  makeCustomPrimary,
  normalizeDomain,
  publish,
  removeCustomDomain,
  savePage,
  unpublish,
} from "../src/lib/website-state";
import { BOOK, BOOKINGS, CUSTOMERS, FINANCIALS, JOBS, OPERATIONS, PROPERTIES, SERVICES } from "./apex-data";
import { cancelled, withBooking } from "./operations-edits";

// Pure data/selector/state tests: no browser needed.

const newPlan = {
  customerId: "elena-rodriguez",
  propertyId: "prop-elena-condo",
  name: "Comfort Care",
  status: "active" as const,
  coverage: { cooling: 1, heating: 1 },
  price: 189,
  cadence: "year" as const,
  startDate: "2024-10-25",
  endDate: "2025-10-25",
};

const visit2 = () => getPlanById("plan-sarah-comfort-care")!.visits[1];

/**
 * BK-1048 as the Schedule Included Visit flow stores it (the booking itself is created by the server action; bookings-db and
 * operations-bridges check that flow and its number against PostgreSQL). Here it is the record the plan screens READ.
 */
function scheduleVisit2(): { data: typeof OPERATIONS; booking: Booking } {
  const booking: Booking = {
    id: "BK-1048",
    customerId: "sarah-mitchell",
    propertyId: "prop-sarah-home",
    serviceId: COVERAGE.cooling.bookingServiceId,
    source: "Maintenance plan",
    date: "2024-11-19",
    start: "10:00",
    end: "12:00",
    assigneeId: "marcus-vance",
    status: "confirmed",
    receivedAt: "2024-10-25T10:45",
    confirmedAt: "2024-10-25T10:45",
    planVisit: { planId: "plan-sarah-comfort-care", visitId: visit2().id },
  };
  return { data: withBooking(OPERATIONS, booking), booking };
}

test.describe("maintenance plan data", () => {
  test("Sarah Mitchell's Comfort Care plan is the canonical record", () => {
    const plan = getPlanById("plan-sarah-comfort-care")!;
    expect(plan).toMatchObject({
      customerId: "sarah-mitchell",
      propertyId: "prop-sarah-home",
      name: "Comfort Care",
      status: "active",
      price: 189,
      cadence: "year",
      startDate: "2024-05-14",
      endDate: "2025-05-14",
      visitsPerYear: 2,
    });
    expect(getPropertyById(plan.propertyId!, BOOK)).toMatchObject({ street: "1402 Kinney Ave", city: "Austin", state: "TX", postalCode: "78704", label: "Home" });
    // Cooling and heating maintenance only, one visit each.
    expect(plan.coverage).toEqual([
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ]);
    expect(plan.visits).toHaveLength(2);
  });

  test("coverage is two maintenance definitions, distinct from the public Services but booked as them", () => {
    expect(COVERAGE_IDS).toEqual(["cooling", "heating"]);
    expect(COVERAGE.cooling.name).toBe("Cooling maintenance");
    expect(COVERAGE.heating.name).toBe("Heating maintenance");
    for (const id of COVERAGE_IDS) {
      expect(SERVICES.map((service) => service.id)).toContain(COVERAGE[id].bookingServiceId);
      expect(SERVICES.map((service) => service.name)).not.toContain(COVERAGE[id].name);
    }
  });

  test("visit 1 is fulfilled; visit 2 is the cooling visit due in November and has no booking yet", () => {
    const [v1, v2] = getPlanById("plan-sarah-comfort-care")!.visits;
    expect(v1).toMatchObject({ coverageId: "heating", completed: true, completedOn: "2024-05-22" });
    expect(getVisitBooking(v1, OPERATIONS)).toBeUndefined();
    expect(v2).toMatchObject({ coverageId: "cooling", windowStart: "2024-11-01", windowEnd: "2024-11-30" });
    expect(getVisitBooking(v2, OPERATIONS)).toBeUndefined();
    expect(getVisitState(v2, OPERATIONS)).toBe("needs-scheduling");
  });

  test("aggregates are the approved 14 / 5 / 3 / 2, not a made-up 24 records", () => {
    expect(getPlanMetrics(PLANS_DATA, OPERATIONS)).toMatchObject({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1, pausedOrEnded: 2 });
    expect(PLANS.length).toBeLessThan(14);
  });

  test("plans reference real customers and properties, or carry a name snapshot; ids are unique", () => {
    expect(new Set(PLANS.map((plan) => plan.id)).size).toBe(PLANS.length);
    for (const plan of PLANS) {
      expect(Boolean(plan.customerId) !== Boolean(plan.contactName), plan.id).toBe(true);
      if (plan.customerId) {
        const customer = CUSTOMERS.find((item) => item.id === plan.customerId);
        expect(customer, plan.id).toBeDefined();
        expect(PROPERTIES.find((property) => property.id === plan.propertyId)?.customerId, plan.id).toBe(plan.customerId);
      }
      expect(plan.visits.map((visit) => visit.sequence)).toEqual(plan.visits.map((_, index) => index + 1));
    }
  });

  test("the final plan names win over the older Customers labels", () => {
    expect(getCustomerPlanSummary(CUSTOMERS.find((customer) => customer.id === "david-chen")!)).toMatchObject({ name: "Seasonal Maintenance", status: "Active" });
    expect(getCustomerPlanSummary(CUSTOMERS.find((customer) => customer.id === "sarah-mitchell")!)).toMatchObject({ name: "Comfort Care", price: "$189/yr", visitsPerYear: 2 });
    expect(PLANS.map((plan) => plan.name)).not.toContain("Comfort Plus");
    expect(getCustomerPlanSummary(CUSTOMERS.find((customer) => customer.id === "elena-rodriguez")!)).toBeUndefined();
  });

  test("Sarah's Phase 2 customer, property and equipment records are unchanged", () => {
    const sarah = CUSTOMERS.find((customer) => customer.id === "sarah-mitchell")!;
    expect(sarah).toMatchObject({ phone: "(512) 555-0194", email: "sarah.m@gmail.com", propertyIds: ["prop-sarah-home"] });
    expect(sarah.maintenancePlan).toBeUndefined();
  });
});

test.describe("creating a plan and scheduling an included visit", () => {
  test("createPlan adds one plan in memory, with cooling then heating visits, and changes nothing else", () => {
    const before = JSON.stringify(PLANS_DATA);
    const { data, plan } = createPlan(PLANS_DATA, newPlan, "elena-rodriguez");
    expect(JSON.stringify(PLANS_DATA)).toBe(before);
    expect(data.plans).toHaveLength(PLANS.length + 1);
    expect(plan).toMatchObject({ id: "plan-elena-rodriguez-comfort-care", name: "Comfort Care", status: "active", visitsPerYear: 2 });
    expect(plan.visits.map((visit) => visit.coverageId)).toEqual(["cooling", "heating"]);
    expect(plan.visits.every((visit) => getVisitBooking(visit, OPERATIONS) === undefined)).toBe(true);
    // The approved totals grow by exactly what was created.
    expect(getPlanMetrics(data, OPERATIONS)).toMatchObject({ active: 15, visitsDue: 6 });
  });

  test("creating the same plan twice keeps both, with different ids", () => {
    const first = createPlan(PLANS_DATA, newPlan, "elena-rodriguez");
    const second = createPlan(first.data, newPlan, "elena-rodriguez");
    expect(second.plan.id).toBe("plan-elena-rodriguez-comfort-care-2");
  });

  test("visit 2's booking is BK-1048 (Nov 19, 10:00–12:00, Marcus Vance) with no job", () => {
    const { data, booking } = scheduleVisit2();
    expect(booking).toMatchObject({
      id: "BK-1048",
      customerId: "sarah-mitchell",
      propertyId: "prop-sarah-home",
      serviceId: "annual-cooling-tune-up",
      date: "2024-11-19",
      start: "10:00",
      end: "12:00",
      assigneeId: "marcus-vance",
      status: "confirmed",
      source: "Maintenance plan",
    });
    expect(booking.jobId).toBeUndefined();
    expect(data.jobs).toHaveLength(JOBS.length);
    expect(data.bookings).toHaveLength(BOOKINGS.length + 1);
    expect(OPERATIONS.bookings).toHaveLength(BOOKINGS.length);
  });

  test("the plan holds no pointer of its own: the visit state is read from the stored booking that points at it", () => {
    const { data: ops, booking } = scheduleVisit2();
    const plan = getPlanById("plan-sarah-comfort-care")!;
    expect(getVisitBooking(plan.visits[1], ops)?.id).toBe("BK-1048");
    expect(getVisitBooking(plan.visits[1], OPERATIONS)).toBeUndefined();
    expect(getPlanVisitForBooking(booking, PLANS_DATA)).toMatchObject({ visit: { id: visit2().id } });
    expect(getVisitState(plan.visits[1], ops)).toBe("scheduled");
    // Still counted as due until it is completed; the approved total does not move.
    expect(getPlanMetrics(PLANS_DATA, ops).visitsDue).toBe(5);
    expect(getUpcomingVisits(PLANS_DATA, ops).find(({ plan: item }) => item.id === plan.id)?.visit.id).toBe(visit2().id);

    // Cancelling the booking reopens the visit rather than leaving it scheduled.
    expect(getVisitState(plan.visits[1], cancelled(ops, "BK-1048", "Customer asked to rebook"))).toBe("needs-scheduling");
  });

  test("scheduling a visit leaves quotes, invoices, payments and the Overview financial baseline untouched", () => {
    scheduleVisit2();
    expect(getRecordedPaymentsCount(FINANCIALS)).toBe(7);
    expect(getPaymentsReceivedTotal(FINANCIALS)).toBe(2130);
    expect(getOutstandingBalance(FINANCIALS)).toBe(680);
    expect(overviewMetrics.totalInvoiced).toBe(6240);
    expect(FINANCIALS.payments.map((payment) => payment.id)).not.toContain("PAY-1009");
    // Locked Phase 4 decisions.
    expect(getInvoiceById("INV-1044", FINANCIALS)?.quoteId).toBeUndefined();
    expect(getInvoiceById("INV-1050", FINANCIALS)?.previouslyPaid).toBe(200);
  });
});

test.describe("website data", () => {
  test("the site has exactly Home, Services, About, Contact and Booking", () => {
    expect(WEBSITE_PAGES.map((page) => page.id)).toEqual(["home", "services", "about", "contact", "booking"]);
    expect(Object.keys(PAGE_SCHEMA)).toEqual(["home", "services", "about", "contact", "booking"]);
  });

  test("the website owns no business details: it reads them from the Business fixture and the Services catalog", () => {
    const text = JSON.stringify(PAGE_SCHEMA) + JSON.stringify(defaultSiteContent(SERVICES));
    for (const value of [business.phone, business.email, business.address.street, business.hours[0].hours]) expect(text).not.toContain(value);
    for (const service of SERVICES) {
      expect(text).not.toContain(service.name);
      expect(text).not.toContain(service.description);
    }
    // Services are held as ids only.
    expect(defaultSiteContent(SERVICES).services.order).toEqual(getPublicActiveServices(SERVICES).map((service) => service.id));
  });

  test("no invented credentials, founding dates, awards or SEO and debug fields", () => {
    const text = (JSON.stringify(PAGE_SCHEMA) + JSON.stringify(defaultSiteContent(SERVICES))).toLowerCase();
    for (const phrase of ["licensed", "insured", "certified", "founded", "since 19", "since 20", "award", "years of experience", "seo", "meta ", "debug", "5-star", "4.9"]) {
      expect(text, phrase).not.toContain(phrase);
    }
  });

  test("showing, hiding and ordering services never changes the Services themselves", () => {
    const before = JSON.stringify(SERVICES);
    const content = defaultSiteContent(SERVICES);
    const shown = getShownServices({ order: [...content.services.order].reverse(), hidden: ["annual-cooling-tune-up"] }, SERVICES);
    expect(shown.map((service) => service.id)).toEqual(
      [...content.services.order].reverse().filter((id) => id !== "annual-cooling-tune-up"),
    );
    expect(shown.every((service) => SERVICES.includes(service))).toBe(true);
    expect(JSON.stringify(SERVICES)).toBe(before);
  });
});

test.describe("website state", () => {
  test("the baseline is published on both addresses, with the Climvia address primary", () => {
    const site = initialWebsiteState(SERVICES);
    expect(site.published).toBe(true);
    expect(site.domain).toEqual({ custom: DEFAULT_CUSTOM_DOMAIN, primary: "climvia" });
    expect(CLIMVIA_DOMAIN).toBe("apexclimate.climvia.com");
    expect(DEFAULT_CUSTOM_DOMAIN).toBe("www.apexclimateair.com");
    expect(getPrimaryDomain(site.domain)).toBe(CLIMVIA_DOMAIN);
    expect(WEBSITE_PAGES.every((page) => getPageStatus(site, page.id) === "published")).toBe(true);
    expect(hasUnpublishedChanges(site)).toBe(false);
  });

  test("saving a page changes the draft only; publishing makes it live", () => {
    const site = initialWebsiteState(SERVICES);
    const home = { ...site.draft.pages.home, hero: { ...site.draft.pages.home.hero, values: { ...site.draft.pages.home.hero.values, headline: "Cool homes, fair prices" } } };
    const saved = savePage(site, "home", home);
    expect(site.draft.pages.home.hero.values.headline).not.toBe("Cool homes, fair prices");
    expect(saved.live.pages.home.hero.values.headline).not.toBe("Cool homes, fair prices");
    expect(getPageStatus(saved, "home")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "about")).toBe("published");
    const live = publish(saved);
    expect(live.live.pages.home.hero.values.headline).toBe("Cool homes, fair prices");
    expect(getPageStatus(live, "home")).toBe("published");
  });

  test("changing which services are shown marks the pages that list services", () => {
    const site = initialWebsiteState(SERVICES);
    const saved = savePage(site, "services", site.draft.pages.services, { ...site.draft.services, hidden: ["furnace-safety-inspection"] });
    expect(getPageStatus(saved, "services")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "home")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "booking")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "contact")).toBe("published");
  });

  test("unpublishing makes every page private and keeps the content; publishing again restores it", () => {
    const site = unpublish(initialWebsiteState(SERVICES));
    expect(site.published).toBe(false);
    expect(WEBSITE_PAGES.every((page) => getPageStatus(site, page.id) === "private")).toBe(true);
    expect(site.draft).toEqual(initialWebsiteState(SERVICES).draft);
    expect(publish(site).published).toBe(true);
  });

  test("domains and publishing are independent", () => {
    const private_ = unpublish(initialWebsiteState(SERVICES));
    const removed = removeCustomDomain(private_);
    expect(removed.published).toBe(false);
    expect(removed.draft).toEqual(private_.draft);
    expect(removed.live).toEqual(private_.live);
    // A site with no custom domain still publishes.
    expect(publish(removed).published).toBe(true);
  });

  test("remove restores the Climvia address as primary; make primary and connect behave", () => {
    const site = initialWebsiteState(SERVICES);
    const custom = makeCustomPrimary(site);
    expect(getPrimaryDomain(custom.domain)).toBe(DEFAULT_CUSTOM_DOMAIN);
    expect(getPrimaryDomain(makeClimviaPrimary(custom).domain)).toBe(CLIMVIA_DOMAIN);
    const removed = removeCustomDomain(custom);
    expect(removed.domain).toEqual({ custom: undefined, primary: "climvia" });
    expect(getPrimaryDomain(removed.domain)).toBe(CLIMVIA_DOMAIN);
    // Nothing to make primary without a custom domain.
    expect(makeCustomPrimary(removed)).toBe(removed);
    expect(connectCustomDomain(removed, "www.example.com").domain).toEqual({ custom: "www.example.com", primary: "climvia" });
    expect(site.domain.custom).toBe(DEFAULT_CUSTOM_DOMAIN);
  });

  test("a domain name is only checked for shape; nothing is looked up", () => {
    expect(normalizeDomain(" https://WWW.Example.com/path ")).toBe("www.example.com");
    expect(normalizeDomain("not a domain")).toBeUndefined();
    expect(normalizeDomain("nodots")).toBeUndefined();
    expect(normalizeDomain(CLIMVIA_DOMAIN)).toBeUndefined();
  });
});

test.describe("Phase 5 source", () => {
  const PROHIBITED = [
    "subscription billing",
    "auto-charge",
    "auto charge",
    "autocharge",
    "recurring billing",
    "telemetry",
    "gps",
    "dispatch",
    "fleet",
    "ai website builder",
    "website builder",
    "seo score",
    "conversion analytics",
    "domain verification",
    "dns automation",
    "dns record",
    "predictive maintenance",
    "health score",
    "rostova",
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(tsx?|css)$/.test(entry) ? [path] : [];
    });
  }

  test("production source contains none of the prohibited concepts", () => {
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const phrase of PROHIBITED) if (text.includes(phrase)) hits.push(`${file}: ${phrase}`);
    }
    expect(hits).toEqual([]);
  });

  test("plan and website code never reads the real clock or the browser's timezone", () => {
    const files = [
      ...sourceFiles("src/components/maintenance-plans"),
      ...sourceFiles("src/components/website"),
      "src/data/maintenance-plans.ts",
      "src/data/website.ts",
      "src/lib/maintenance-plans-state.ts",
      "src/lib/website-state.ts",
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/new Date\(\s*\)/, /Date\.now\(/, /Intl\.DateTimeFormat/, /toLocale(Date|Time)?String/, /getTimezoneOffset/]) {
        if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("no stray trailing export lists in source files", () => {
    const hits = sourceFiles("src").filter((file) => /^export \{[^}]*\};?\s*$/m.test(readFileSync(file, "utf8")) && !file.endsWith("index.ts"));
    expect(hits).toEqual([]);
  });
});
