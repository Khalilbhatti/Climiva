import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { getPropertyById } from "../src/data/customers";
import { business } from "../scripts/db/seed-data/apex";
import {
  COVERAGE,
  COVERAGE_IDS,
  getCustomerPlanSummary,
  getPlanById,
  getPlanMetrics,
  getPlanVisitForBooking,
  getUpcomingVisits,
  getVisitBooking,
  getVisitState,
  type MaintenancePlan,
} from "../src/data/maintenance-plans";
import {
  getInvoiceById,
  getOutstandingBalance,
  getPaymentsReceivedTotal,
  getRecordedPaymentsCount,
} from "../src/data/financials";
import { getPublicActiveServices } from "../src/data/services";
import { getPageStatus, getPrimaryDomain, getShownServices, hasUnpublishedChanges, orderedPages, platformHost } from "../src/data/website";
import { DEFAULT_TEMPLATE_KEY } from "../src/db/default-template";
import { normalizeDomain } from "../src/lib/site-domain";
import { validateTemplateDefinition } from "../src/lib/site-template";
import { parseNewPlan, planSlug, visitsOf } from "../src/lib/maintenance-rules";
import { APEX_CONTENT, BOOK, BOOKINGS, CUSTOMERS, FINANCIALS, JOBS, OPERATIONS, OVERVIEW_TOTALS, PLANS, PLANS_DATA, PLAN_ADJUSTMENT, PROPERTIES, SERVICES } from "./apex-data";
import { cancelled } from "./operations-edits";
import { websiteOf, withEditedSection, withPublished } from "./website-edits";

// Pure data/selector/state tests: no browser needed.

/** A plan as the server stores one created through the Create plan flow (not carried in with the sample history). */
const createdPlan = (): MaintenancePlan => {
  const slug = planSlug("elena-rodriguez", "Comfort Care", []);
  return {
    id: slug,
    customerId: "elena-rodriguez",
    propertyId: "prop-elena-condo",
    name: "Comfort Care",
    status: "active",
    price: 189,
    cadence: "year",
    startDate: "2024-10-25",
    endDate: "2025-10-25",
    coverage: [
      { coverageId: "cooling", visits: 1 },
      { coverageId: "heating", visits: 1 },
    ],
    visitsPerYear: 2,
    visits: visitsOf(slug, { cooling: 1, heating: 1 }).map((visit) => ({ id: visit.ref, sequence: visit.sequence, label: visit.label, coverageId: visit.coverageId })),
  };
};

const TODAY = "2024-10-25";
const visit2 = () => getPlanById("plan-sarah-comfort-care", PLANS_DATA)!.visits[1];

/** BK-1048 is the canonical scheduled visit: Sarah's Comfort Care visit 2, in the baseline operations. */
const bk1048 = () => OPERATIONS.bookings.find((booking) => booking.id === "BK-1048")!;

test.describe("maintenance plan data", () => {
  test("Sarah Mitchell's Comfort Care plan is the canonical record", () => {
    const plan = getPlanById("plan-sarah-comfort-care", PLANS_DATA)!;
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

  test("visit 1 is fulfilled; visit 2 is the cooling visit for November and is already scheduled as BK-1048", () => {
    const [v1, v2] = getPlanById("plan-sarah-comfort-care", PLANS_DATA)!.visits;
    expect(v1).toMatchObject({ coverageId: "heating", completed: true, completedOn: "2024-05-22" });
    expect(getVisitBooking(v1, OPERATIONS)).toBeUndefined();
    expect(v2).toMatchObject({ coverageId: "cooling", windowStart: "2024-11-01", windowEnd: "2024-11-30" });
    expect(getVisitBooking(v2, OPERATIONS)?.id).toBe("BK-1048");
    expect(getVisitState(v2, OPERATIONS)).toBe("scheduled");
  });

  test("aggregates are the approved 14 / 5 / 3 / 2, not a made-up 24 records", () => {
    expect(getPlanMetrics(PLANS_DATA, OPERATIONS, TODAY, PLAN_ADJUSTMENT)).toMatchObject({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1, pausedOrEnded: 2 });
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
    expect(getCustomerPlanSummary(CUSTOMERS.find((customer) => customer.id === "david-chen")!, PLANS_DATA)).toMatchObject({ name: "Seasonal Maintenance", status: "Active" });
    expect(getCustomerPlanSummary(CUSTOMERS.find((customer) => customer.id === "sarah-mitchell")!, PLANS_DATA)).toMatchObject({ name: "Comfort Care", price: "$189/yr", visitsPerYear: 2 });
    expect(PLANS.map((plan) => plan.name)).not.toContain("Comfort Plus");
    expect(getCustomerPlanSummary(CUSTOMERS.find((customer) => customer.id === "elena-rodriguez")!, PLANS_DATA)).toBeUndefined();
  });

  test("Sarah's Phase 2 customer, property and equipment records are unchanged", () => {
    const sarah = CUSTOMERS.find((customer) => customer.id === "sarah-mitchell")!;
    expect(sarah).toMatchObject({ phone: "(512) 555-0194", email: "sarah.m@gmail.com", propertyIds: ["prop-sarah-home"] });
    expect(sarah.maintenancePlan).toBeUndefined();
  });
});

test.describe("creating a plan and scheduling an included visit", () => {
  test("a new plan's visits are cooling first, then heating, numbered from 1, and its reference is unique among the business's plans", () => {
    const slug = planSlug("elena-rodriguez", "Comfort Care", []);
    expect(slug).toBe("plan-elena-rodriguez-comfort-care");
    expect(visitsOf(slug, { cooling: 1, heating: 1 }).map((visit) => [visit.ref, visit.sequence, visit.coverageId, visit.label])).toEqual([
      ["plan-elena-rodriguez-comfort-care-v1", 1, "cooling", "Cooling maintenance"],
      ["plan-elena-rodriguez-comfort-care-v2", 2, "heating", "Heating maintenance"],
    ]);
    // Creating the same plan twice keeps both, with different references.
    expect(planSlug("elena-rodriguez", "Comfort Care", [slug])).toBe(`${slug}-2`);
    expect(planSlug("elena-rodriguez", "Comfort Care", [slug, `${slug}-2`])).toBe(`${slug}-3`);
    expect(planSlug("a", "!!!", [])).toBe("plan-a-plan");
  });

  test("a new plan adds to the approved totals by exactly what was created, and the sample data is not touched", () => {
    const before = JSON.stringify(PLANS_DATA);
    const data = { plans: [...PLANS_DATA.plans, createdPlan()] };
    expect(JSON.stringify(PLANS_DATA)).toBe(before);
    expect(getPlanMetrics(data, OPERATIONS, TODAY, PLAN_ADJUSTMENT)).toMatchObject({ active: 15, visitsDue: 6 });
    expect(createdPlan().visits.every((visit) => getVisitBooking(visit, OPERATIONS) === undefined)).toBe(true);
  });

  test("a business with no reporting history counts its own plans, and none of the approved totals", () => {
    const data = { plans: [createdPlan()] };
    expect(getPlanMetrics(data, OPERATIONS, TODAY)).toMatchObject({ active: 1, visitsDue: 1, renewals: 0, paused: 0, ended: 0, pausedOrEnded: 0, all: 1 });
    expect(getPlanMetrics({ plans: [] }, OPERATIONS, TODAY)).toEqual({ active: 0, visitsDue: 0, renewals: 0, paused: 0, ended: 0, pausedOrEnded: 0, all: 0 });
    // A plan that ends within 60 days of the business's own today is renewing soon.
    expect(getPlanMetrics(data, OPERATIONS, "2025-09-01")).toMatchObject({ renewals: 1 });
  });

  test("the server reads a plan's price as exact cents and refuses what the screen would never send", () => {
    const input = { customerId: "elena-rodriguez", propertyId: "prop-elena-condo", name: " Comfort Care ", status: "active", coverage: { cooling: 1, heating: 1 }, price: "189.50", cadence: "year", startDate: "2024-10-25", endDate: "2025-10-25" };
    expect(parseNewPlan(input)).toMatchObject({ ok: true, value: { name: "Comfort Care", priceCents: 18950, coverage: { cooling: 1, heating: 1 } } });
    for (const bad of [{ price: "0" }, { price: "-5" }, { price: "12.345" }, { price: "abc" }, { coverage: {} }, { coverage: { cooling: 0, heating: 0 } }, { coverage: { cooling: 5 } }, { coverage: { plumbing: 1 } }, { name: "  " }, { status: "ended" }, { cadence: "weekly" }, { startDate: "2024-02-30" }, { endDate: "2024-10-25" }, { customerId: "Not A Slug" }]) {
      expect(parseNewPlan({ ...input, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("visit 2's booking is BK-1048 (Nov 19, 10:00–12:00, Marcus Vance) with no job, and there is exactly one", () => {
    const booking = bk1048();
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
      planVisit: { planId: "plan-sarah-comfort-care", visitId: visit2().id },
    });
    expect(booking.jobId).toBeUndefined();
    expect(OPERATIONS.bookings.filter((item) => item.id === "BK-1048")).toHaveLength(1);
    expect(OPERATIONS.jobs).toHaveLength(JOBS.length);
    expect(OPERATIONS.bookings).toHaveLength(BOOKINGS.length);
    expect(BOOKINGS).toHaveLength(14);
  });

  test("the plan holds no pointer of its own: the visit state is read from the stored booking that points at it", () => {
    const plan = getPlanById("plan-sarah-comfort-care", PLANS_DATA)!;
    expect(getVisitBooking(plan.visits[1], OPERATIONS)?.id).toBe("BK-1048");
    expect(getPlanVisitForBooking(bk1048(), PLANS_DATA)).toMatchObject({ visit: { id: visit2().id } });
    expect(getVisitState(plan.visits[1], OPERATIONS)).toBe("scheduled");
    // Still counted as due until it is completed; the approved total does not move.
    expect(getPlanMetrics(PLANS_DATA, OPERATIONS, TODAY, PLAN_ADJUSTMENT).visitsDue).toBe(5);
    expect(getUpcomingVisits(PLANS_DATA, OPERATIONS).find(({ plan: item }) => item.id === plan.id)?.visit.id).toBe(visit2().id);

    // Cancelling the booking reopens the visit rather than leaving it scheduled; without the booking there is nothing to read.
    expect(getVisitState(plan.visits[1], cancelled(OPERATIONS, "BK-1048", "Customer asked to rebook"))).toBe("needs-scheduling");
    expect(getVisitState(plan.visits[1], { ...OPERATIONS, bookings: OPERATIONS.bookings.filter((booking) => booking.id !== "BK-1048") })).toBe("needs-scheduling");
  });

  test("a scheduled visit leaves quotes, invoices, payments and the Overview financial baseline untouched", () => {
    expect(getRecordedPaymentsCount(FINANCIALS)).toBe(7);
    expect(getPaymentsReceivedTotal(FINANCIALS)).toBe(2130);
    expect(getOutstandingBalance(FINANCIALS)).toBe(680);
    expect(OVERVIEW_TOTALS.totalInvoiced).toBe(6240);
    expect(FINANCIALS.payments.map((payment) => payment.id)).not.toContain("PAY-1009");
    // Locked Phase 4 decisions.
    expect(getInvoiceById("INV-1044", FINANCIALS)?.quoteId).toBeUndefined();
    expect(getInvoiceById("INV-1050", FINANCIALS)?.previouslyPaid).toBe(200);
  });
});

const SITE = websiteOf(APEX_CONTENT);

test.describe("website data", () => {
  test("the site has exactly Home, Services, About, Contact and Booking", () => {
    expect(APEX_CONTENT.pages.map((page) => page.key)).toEqual(["home", "services", "about", "contact", "booking"]);
    expect(APEX_CONTENT.pages.map((page) => page.title)).toEqual(["Home", "Services", "About", "Contact", "Booking"]);
    expect(APEX_CONTENT.pages.map((page) => page.slug)).toEqual(["", "services", "about", "contact", "booking"]);
    expect(validateTemplateDefinition({ schema: 1, ...APEX_CONTENT }).ok).toBe(true);
  });

  test("the website owns no business details: it reads them from the organization and the Services catalog", () => {
    const text = JSON.stringify(APEX_CONTENT);
    for (const value of [business.phone, business.email, business.address.street, business.hours[0].hours]) expect(text).not.toContain(value);
    for (const service of SERVICES) {
      expect(text).not.toContain(service.name);
      expect(text).not.toContain(service.description);
    }
    // Which Services show is a list of references (none hidden, the catalog's own order), never a copy.
    expect(APEX_CONTENT.settings.serviceDisplay).toEqual({ order: [], hidden: [] });
  });

  test("no invented credentials, founding dates, awards or SEO and debug fields", () => {
    const text = JSON.stringify(APEX_CONTENT).toLowerCase();
    for (const phrase of ["licensed", "insured", "certified", "founded", "since 19", "since 20", "award", "years of experience", "seo", "meta ", "debug", "5-star", "4.9"]) {
      expect(text, phrase).not.toContain(phrase);
    }
  });

  test("showing, hiding and ordering services never changes the Services themselves", () => {
    const before = JSON.stringify(SERVICES);
    const order = getPublicActiveServices(SERVICES).map((service) => service.id);
    const shown = getShownServices({ order: [...order].reverse(), hidden: ["annual-cooling-tune-up"] }, SERVICES);
    expect(shown.map((service) => service.id)).toEqual([...order].reverse().filter((id) => id !== "annual-cooling-tune-up"));
    expect(shown.every((service) => SERVICES.includes(service))).toBe(true);
    expect(JSON.stringify(SERVICES)).toBe(before);
  });
});

test.describe("website state", () => {
  test("the baseline is published, with the Climvia address primary and nothing to publish", () => {
    expect(SITE.published).toBe(true);
    expect(getPrimaryDomain(SITE.site, SITE.domain)).toBe("apexclimate.climvia.com");
    expect(platformHost("apexclimate")).toBe("apexclimate.climvia.com");
    expect(orderedPages(SITE.draft).every((page) => getPageStatus(SITE, page.key) === "published")).toBe(true);
    expect(hasUnpublishedChanges(SITE)).toBe(false);
  });

  test("saving a page changes the draft only; publishing makes it live", () => {
    const saved = withEditedSection(SITE, "home", "hero", { headline: "Cool homes, fair prices" });
    const heroOf = (version: typeof SITE.draft) => version.pages.find((page) => page.key === "home")!.sections.find((section) => section.key === "hero")!.props.headline;
    expect(heroOf(SITE.draft)).not.toBe("Cool homes, fair prices");
    expect(heroOf(saved.draft)).toBe("Cool homes, fair prices");
    expect(heroOf(saved.live!)).not.toBe("Cool homes, fair prices");
    expect(getPageStatus(saved, "home")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "about")).toBe("published");
    const live = withPublished(saved);
    expect(heroOf(live.live!)).toBe("Cool homes, fair prices");
    expect(live.live!.number).toBe(2);
    expect(getPageStatus(live, "home")).toBe("published");
    expect(hasUnpublishedChanges(live)).toBe(false);
  });

  test("changing which services are shown marks the pages that list services", () => {
    const saved = { ...SITE, draft: { ...SITE.draft, settings: { serviceDisplay: { order: [], hidden: ["furnace-safety-inspection"] } } } };
    expect(getPageStatus(saved, "services")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "home")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "booking")).toBe("unpublished-changes");
    expect(getPageStatus(saved, "contact")).toBe("published");
    expect(getPageStatus(saved, "about")).toBe("published");
  });

  test("a private site has no published snapshot: every page is private, and the content is kept", () => {
    const site = websiteOf(APEX_CONTENT, { published: false });
    expect(site.published).toBe(false);
    expect(site.live).toBeNull();
    expect(orderedPages(site.draft).every((page) => getPageStatus(site, page.key) === "private")).toBe(true);
    expect(site.draft).toEqual(websiteOf(APEX_CONTENT).draft);
    expect(hasUnpublishedChanges(site)).toBe(true);
  });

  test("the main address is the platform address unless a recorded custom domain is made main", () => {
    expect(getPrimaryDomain(SITE.site, { primary: "climvia" })).toBe("apexclimate.climvia.com");
    expect(getPrimaryDomain(SITE.site, { custom: "www.apexclimateair.com", customStatus: "configured", primary: "custom" })).toBe("www.apexclimateair.com");
    // A "custom" choice with no domain recorded falls back to the platform address.
    expect(getPrimaryDomain(SITE.site, { primary: "custom" })).toBe("apexclimate.climvia.com");
    expect(DEFAULT_TEMPLATE_KEY).toBe("climvia-starter");
  });

  test("a domain name is only checked for shape and for not being one of Climvia's own; nothing is looked up", () => {
    expect(normalizeDomain(" https://WWW.Example.com/path ")).toBe("www.example.com");
    expect(normalizeDomain("not a domain")).toBeUndefined();
    expect(normalizeDomain("nodots")).toBeUndefined();
    expect(normalizeDomain("apexclimate.climvia.com")).toBeUndefined();
    expect(normalizeDomain("climvia.com")).toBeUndefined();
    expect(normalizeDomain("sub.climvia.com")).toBeUndefined();
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
      "src/lib/maintenance-rules.ts",
      "src/lib/site-sections.ts",
      "src/lib/site-template.ts",
      "src/lib/site-theme.ts",
      "src/lib/site-domain.ts",
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
