/**
 * Phase 13: the rules the server applies before it writes a plan, a visit, a reply or a review request, and the totals the screens
 * report from them. Pure functions, no database and no browser: a forged request meets the same checks a screen's would, and
 * the database holds them again (maintenance-reviews-database.spec.ts).
 */
import { expect, test } from "playwright/test";
import { COVERAGE, PLAN_BASELINE, getCurrentPlanForCustomer, getNextVisit, getPlanMetrics, getVisitBooking, getVisitState, isRenewingSoon } from "../src/data/maintenance-plans";
import { REQUEST_MESSAGE_MAX, RESPONSE_MAX, REVIEW_BASELINE, defaultRequestMessage, getReviewMetrics } from "../src/data/reviews";
import { MAX_COVERAGE_VISITS, PLAN_NAME_MAX, PLAN_NOTE_MAX, parseNewPlan, parseScheduleVisit, planSlug, visitWindowError, visitsOf } from "../src/lib/maintenance-rules";
import { eligibleReviewJobs, parseReplyBody, parseReviewRequest, reviewSlug } from "../src/lib/review-rules";
import { OPERATIONS, PLANS_DATA, REVIEWS_DATA } from "./apex-data";
import { withReply, withRequest } from "./review-edits";

const TODAY = "2024-10-25";

const plan = {
  customerId: "elena-rodriguez",
  propertyId: "prop-elena-condo",
  name: "Comfort Care",
  status: "active",
  coverage: { cooling: 1, heating: 1 },
  price: "189",
  cadence: "year",
  startDate: "2024-10-25",
  endDate: "2025-10-25",
};

test.describe("a new plan: what the server accepts", () => {
  test("the canonical plan parses to exact cents, trimmed, with both kinds of visit", () => {
    const parsed = parseNewPlan({ ...plan, name: "  Comfort Care  ", note: "  Gate code 4411  " });
    expect(parsed).toEqual({
      ok: true,
      value: {
        customerSlug: "elena-rodriguez",
        propertySlug: "prop-elena-condo",
        name: "Comfort Care",
        status: "active",
        coverage: { cooling: 1, heating: 1 },
        priceCents: 18900,
        cadence: "year",
        startDate: "2024-10-25",
        endDate: "2025-10-25",
        note: "Gate code 4411",
      },
    });
  });

  test("an end date is optional (an open-ended plan), a pending plan is allowed, a paused or ended one is not creatable", () => {
    expect(parseNewPlan({ ...plan, endDate: undefined })).toMatchObject({ ok: true, value: { endDate: undefined } });
    expect(parseNewPlan({ ...plan, endDate: "" })).toMatchObject({ ok: true, value: { endDate: undefined } });
    expect(parseNewPlan({ ...plan, status: "pending" })).toMatchObject({ ok: true, value: { status: "pending" } });
    for (const status of ["paused", "ended", "Active", "", undefined, 1]) expect(parseNewPlan({ ...plan, status }).ok, String(status)).toBe(false);
  });

  test("the price is an amount above $0, in whole cents, never a float or a string of nonsense", () => {
    expect(parseNewPlan({ ...plan, price: "189.50" })).toMatchObject({ ok: true, value: { priceCents: 18950 } });
    expect(parseNewPlan({ ...plan, price: 189 })).toMatchObject({ ok: true, value: { priceCents: 18900 } });
    expect(parseNewPlan({ ...plan, price: "0.10" })).toMatchObject({ ok: true, value: { priceCents: 10 } });
    for (const price of ["0", "-1", "12.345", "abc", "", "1e3", "NaN", "Infinity", undefined, null, {}, []]) expect(parseNewPlan({ ...plan, price }).ok, JSON.stringify(price)).toBe(false);
  });

  test("coverage is Cooling and Heating maintenance only, a whole number of visits each, at least one visit in all", () => {
    expect(Object.keys(COVERAGE).sort()).toEqual(["cooling", "heating"]);
    expect(COVERAGE.cooling.name).toBe("Cooling maintenance");
    expect(COVERAGE.heating.name).toBe("Heating maintenance");
    expect(parseNewPlan({ ...plan, coverage: { cooling: 2 } })).toMatchObject({ ok: true, value: { coverage: { cooling: 2 } } });
    expect(parseNewPlan({ ...plan, coverage: { heating: MAX_COVERAGE_VISITS } })).toMatchObject({ ok: true });
    for (const coverage of [{}, { cooling: 0, heating: 0 }, { cooling: MAX_COVERAGE_VISITS + 1 }, { cooling: 1.5 }, { cooling: -1 }, { cooling: "1" }, { plumbing: 1 }, { cooling: 1, "AC Repair & Diagnostics": 1 }, null, [], "cooling"]) {
      expect(parseNewPlan({ ...plan, coverage }).ok, JSON.stringify(coverage)).toBe(false);
    }
  });

  test("the dates are real calendar dates and the end is after the start", () => {
    for (const bad of [{ startDate: "2024-02-30" }, { startDate: "10/25/2024" }, { startDate: "" }, { startDate: undefined }, { endDate: "2024-10-25" }, { endDate: "2024-10-24" }, { endDate: "2025-13-01" }, { endDate: 20251025 }]) {
      expect(parseNewPlan({ ...plan, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseNewPlan({ ...plan, startDate: "2024-02-29", endDate: "2025-02-28" }).ok).toBe(true);
  });

  test("names, notes, references and shapes are bounded", () => {
    for (const bad of [{ name: "" }, { name: "   " }, { name: "x".repeat(PLAN_NAME_MAX + 1) }, { note: "x".repeat(PLAN_NOTE_MAX * 4 + 1) }, { cadence: "weekly" }, { cadence: undefined }, { customerId: "Not A Slug" }, { customerId: "" }, { propertyId: "../etc" }, { propertyId: undefined }]) {
      expect(parseNewPlan({ ...plan, ...bad }).ok, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
    for (const input of [null, undefined, "plan", 7, [], [plan]]) expect(parseNewPlan(input).ok).toBe(false);
    expect(parseNewPlan({ ...plan, name: "x".repeat(PLAN_NAME_MAX) }).ok).toBe(true);
  });

  test("an organization, a plan id, a status note or an imported flag in the request are ignored, never read", () => {
    const parsed = parseNewPlan({ ...plan, organizationId: "00000000-0000-0000-0000-000000000000", organization_id: "x", id: "plan-x", imported: true, statusNote: "x", visitsPerYear: 99 });
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(parsed)).not.toMatch(/0000-0000|plan-x|imported|statusNote|visitsPerYear/);
  });
});

test.describe("a plan's reference and its visits", () => {
  test("the reference is made from the customer and the name, and is unique among the business's plans", () => {
    expect(planSlug("sarah-mitchell", "Comfort Care", [])).toBe("plan-sarah-mitchell-comfort-care");
    expect(planSlug("sarah-mitchell", "  Comfort   Care! ", [])).toBe("plan-sarah-mitchell-comfort-care");
    expect(planSlug("sarah-mitchell", "!!!", [])).toBe("plan-sarah-mitchell-plan");
    expect(planSlug("sarah-mitchell", "Comfort Care", ["plan-sarah-mitchell-comfort-care"])).toBe("plan-sarah-mitchell-comfort-care-2");
    expect(planSlug("sarah-mitchell", "Comfort Care", ["plan-sarah-mitchell-comfort-care", "plan-sarah-mitchell-comfort-care-2"])).toBe("plan-sarah-mitchell-comfort-care-3");
    expect(planSlug("sarah-mitchell", "x".repeat(300), []).length).toBeLessThanOrEqual(100);
    expect(planSlug("sarah-mitchell", "Comfort Care", [])).toMatch(/^[a-z0-9][a-z0-9-]{0,119}$/);
  });

  test("visits are used cooling first, then heating, numbered 1..n, each with its own reference", () => {
    expect(visitsOf("p", { cooling: 2, heating: 1 }).map((visit) => [visit.ref, visit.sequence, visit.coverageId, visit.label])).toEqual([
      ["p-v1", 1, "cooling", "Cooling maintenance"],
      ["p-v2", 2, "cooling", "Cooling maintenance"],
      ["p-v3", 3, "heating", "Heating maintenance"],
    ]);
    expect(visitsOf("p", { heating: 2 }).map((visit) => visit.sequence)).toEqual([1, 2]);
    expect(visitsOf("p", {})).toEqual([]);
  });
});

test.describe("scheduling a visit: what the server accepts", () => {
  const input = { serviceId: "annual-cooling-tune-up", date: "2024-11-19", start: "10:00", end: "12:00", assigneeId: "marcus-vance", internalNotes: "  Side gate  " };

  test("the canonical BK-1048 request parses", () => {
    expect(parseScheduleVisit("plan-sarah-comfort-care", "plan-sarah-comfort-care-v2", input)).toEqual({
      ok: true,
      value: { planSlug: "plan-sarah-comfort-care", visitRef: "plan-sarah-comfort-care-v2", serviceSlug: "annual-cooling-tune-up", date: "2024-11-19", start: "10:00", end: "12:00", assigneeSlug: "marcus-vance", internalNotes: "Side gate" },
    });
  });

  test("it names no customer, property, source or status: those come from the plan, never the browser", () => {
    const parsed = parseScheduleVisit("plan-sarah-comfort-care", "plan-sarah-comfort-care-v2", { ...input, customerId: "david-chen", propertyId: "prop-david-home", source: "Phone", status: "completed", organizationId: "x" });
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(parsed)).not.toMatch(/david|Phone|completed|organizationId/);
  });

  test("references, dates and times are checked", () => {
    const ok = (plan: unknown, visit: unknown, body: unknown) => parseScheduleVisit(plan, visit, body).ok;
    expect(ok("Plan X", "v", input)).toBe(false);
    expect(ok("p", "V2!", input)).toBe(false);
    expect(ok("p", undefined, input)).toBe(false);
    expect(ok("p", "v", null)).toBe(false);
    for (const bad of [{ serviceId: "" }, { serviceId: "AC Repair" }, { date: "2024-02-30" }, { date: "11/19/2024" }, { start: "9:00" }, { start: "25:00" }, { end: "09:00" }, { end: "10:00" }, { end: "10:60" }, { assigneeId: "Marcus Vance" }, { internalNotes: "x".repeat(8001) }]) {
      expect(parseScheduleVisit("p", "p-v1", { ...input, ...bad }).ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    // The assignee is optional (the business can assign later).
    expect(parseScheduleVisit("p", "p-v1", { ...input, assigneeId: undefined }).ok).toBe(true);
  });

  test("a visit's target window bounds the date; a visit with no window can be booked any day", () => {
    expect(visitWindowError({}, "2030-01-01")).toBeUndefined();
    expect(visitWindowError({ start: "2024-11-01", end: "2024-11-30" }, "2024-11-01")).toBeUndefined();
    expect(visitWindowError({ start: "2024-11-01", end: "2024-11-30" }, "2024-11-30")).toBeUndefined();
    expect(visitWindowError({ start: "2024-11-01", end: "2024-11-30" }, "2024-10-31")).toMatch(/target window/);
    expect(visitWindowError({ start: "2024-11-01", end: "2024-11-30" }, "2024-12-01")).toMatch(/target window/);
  });
});

test.describe("a reply", () => {
  test("it is trimmed, not empty and within the limit", () => {
    expect(parseReplyBody("  Thank you, Sarah.  ")).toEqual({ ok: true, value: "Thank you, Sarah." });
    expect(parseReplyBody("x".repeat(RESPONSE_MAX))).toMatchObject({ ok: true });
    for (const bad of ["", "   ", "\n\t", "x".repeat(RESPONSE_MAX + 1), undefined, null, 7, {}, []]) expect(parseReplyBody(bad).ok, JSON.stringify(bad)?.slice(0, 40)).toBe(false);
  });

  test("a review is named by its reference only", () => {
    expect(reviewSlug("rev-sarah-mitchell")).toBe("rev-sarah-mitchell");
    for (const bad of ["Rev Sarah", "", undefined, 7, "../x", "rev_sarah"]) expect(reviewSlug(bad), String(bad)).toBeUndefined();
  });
});

test.describe("a review request", () => {
  const request = { customerId: "sarah-mitchell", relatedJobId: "JB-204", channel: "email", message: "  Thanks for choosing Apex.  " };

  test("it parses to a customer, a job number, a channel and a trimmed message", () => {
    expect(parseReviewRequest(request)).toEqual({ ok: true, value: { customerSlug: "sarah-mitchell", jobNumber: 204, channel: "email", message: "Thanks for choosing Apex." } });
    expect(parseReviewRequest({ ...request, relatedJobId: undefined })).toMatchObject({ ok: true, value: { jobNumber: undefined } });
    expect(parseReviewRequest({ ...request, relatedJobId: "", channel: "sms" })).toMatchObject({ ok: true, value: { jobNumber: undefined, channel: "sms" } });
  });

  test("a channel is email or SMS (nothing else, and nothing is sent), a job is a JB reference, a message is bounded", () => {
    for (const bad of [{ channel: "fax" }, { channel: undefined }, { channel: "EMAIL" }, { relatedJobId: "BK-1048" }, { relatedJobId: "JB-" }, { relatedJobId: "204" }, { relatedJobId: 204 }, { message: "" }, { message: "  " }, { message: "x".repeat(REQUEST_MESSAGE_MAX + 1) }, { message: 7 }, { customerId: "Sarah" }, { customerId: undefined }]) {
      expect(parseReviewRequest({ ...request, ...bad }).ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    for (const input of [null, undefined, "x", 7, []]) expect(parseReviewRequest(input).ok).toBe(false);
  });

  test("the default message names the business", () => {
    expect(defaultRequestMessage("Apex Climate Heating & Air")).toContain("Apex Climate Heating & Air");
    expect(defaultRequestMessage("Northstar Heating & Cooling")).toContain("Northstar Heating & Cooling");
    expect(defaultRequestMessage("Apex Climate Heating & Air").length).toBeLessThanOrEqual(REQUEST_MESSAGE_MAX);
  });

  test("only the customer's own COMPLETED jobs are offered, newest first, and never one that already has a request", () => {
    const sarah = eligibleReviewJobs("sarah-mitchell", OPERATIONS, []);
    expect(sarah.length).toBeGreaterThan(0);
    expect(sarah.every((job) => job.customerId === "sarah-mitchell" && job.status === "completed")).toBe(true);
    expect(sarah.map((job) => job.id)).toContain("JB-204");
    expect(sarah.map((job) => job.date)).toEqual([...sarah.map((job) => job.date)].sort().reverse());
    expect(eligibleReviewJobs("sarah-mitchell", OPERATIONS, [{ relatedJobId: "JB-204" }]).map((job) => job.id)).not.toContain("JB-204");
    // Another customer's job, or one that is not completed, is never in the list.
    const david = eligibleReviewJobs("david-chen", OPERATIONS, []);
    expect(david.map((job) => job.id)).not.toContain("JB-204");
    expect(eligibleReviewJobs("nobody", OPERATIONS, [])).toEqual([]);
    expect(eligibleReviewJobs("sarah-mitchell", { jobs: OPERATIONS.jobs.map((job) => ({ ...job, status: "scheduled" as const })) }, [])).toEqual([]);
  });
});

test.describe("the totals the screens report", () => {
  test("a business with no history counts exactly what it has: nothing", () => {
    expect(getPlanMetrics({ plans: [] }, OPERATIONS, TODAY)).toEqual({ active: 0, visitsDue: 0, renewals: 0, paused: 0, ended: 0, pausedOrEnded: 0, all: 0 });
    expect(getReviewMetrics({ reviews: [], requests: [] })).toEqual({ total: 0, average: 0, awaiting: 0, responded: 0, requests: 0 });
  });

  test("the sample business reports its approved totals through the baseline: 14 / 5 / 3 / 2 and 12 / 4.7 / 3 / 5", () => {
    expect(getPlanMetrics(PLANS_DATA, OPERATIONS, TODAY, PLAN_BASELINE)).toMatchObject({ active: 14, visitsDue: 5, renewals: 3, paused: 1, ended: 1, pausedOrEnded: 2 });
    expect(getReviewMetrics(REVIEWS_DATA, REVIEW_BASELINE)).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
  });

  test("a reply moves one review from awaiting to responded; a request adds one to the requests, and nothing else moves", () => {
    const replied = withReply(REVIEWS_DATA, "rev-sarah-mitchell", "Thank you, Sarah.");
    expect(getReviewMetrics(replied, REVIEW_BASELINE)).toEqual({ total: 12, average: 4.7, awaiting: 2, responded: 10, requests: 5 });
    const { data } = withRequest(REVIEWS_DATA, { customerId: "sarah-mitchell", channel: "email", message: "Please review us." });
    expect(getReviewMetrics(data, REVIEW_BASELINE)).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 6 });
  });

  test("a plan's visits and the booking that schedules one are read from the bookings, never copied", () => {
    const sarah = getCurrentPlanForCustomer("sarah-mitchell", PLANS_DATA)!;
    expect(sarah.name).toBe("Comfort Care");
    const [first, second] = sarah.visits;
    expect(getVisitState(first, OPERATIONS)).toBe("completed");
    // Visit 2 is scheduled as BK-1048; take the booking away and the visit is open again.
    expect(getVisitState(second, OPERATIONS)).toBe("scheduled");
    expect(getVisitBooking(second, OPERATIONS)?.id).toBe("BK-1048");
    const without = { ...OPERATIONS, bookings: OPERATIONS.bookings.filter((booking) => booking.id !== "BK-1048") };
    expect(getVisitState(second, without)).toBe("needs-scheduling");
    expect(getVisitBooking(second, without)).toBeUndefined();
    expect(getNextVisit(sarah, OPERATIONS)?.id).toBe(second.id);
    expect(isRenewingSoon(sarah, TODAY)).toBe(false);
  });
});
