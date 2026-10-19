import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { business } from "../scripts/db/seed-data/apex";
import { PROTOTYPE_TODAY } from "../src/lib/prototype-clock";
import {
  AUDIENCES,
  FIRST_NAME_TOKEN,
  SMS_LIMIT,
  defaultSmsMessage,
  formatCampaignTime,
  getCampaignById,
  getCampaignMetrics,
  renderMessage,
} from "../src/data/marketing";
import { defaultListingConfig, emptyMarketplaceState, getEligibleServices, getListingServices, getOrderedEligibleServices, isAnyContactShown, sameConfig } from "../src/data/marketplace";
import { getJobById } from "../src/data/operations";
import { getReviewById, getReviewMetrics, getReviewStatus } from "../src/data/reviews";
import { getPublicActiveServices } from "../src/data/services";
import { parseListingConfig } from "../src/lib/marketplace-rules";
import { moveService, toggleService } from "../src/lib/marketplace-state";
import { APEX_APPROVED, APEX_LISTING, COOLING_TUNE_UP_RECIPIENTS, MARKETING, OPERATIONS, REVIEWS, REVIEWS_DATA, REVIEW_ADJUSTMENT, SARAH_REPLY, SERVICES } from "./apex-data";
import { withEditedReply, withReply, withRequest } from "./review-edits";

// Pure data/selector/state tests: no browser needed.

const EMERGENCY = "emergency-no-heat-no-cool";

test.describe("marketplace data", () => {
  test("the approved listing is published and shows exactly 5 of the 6 canonical Services", () => {
    expect(APEX_LISTING.status).toBe("published");
    expect(getEligibleServices(SERVICES)).toHaveLength(6);
    expect(getEligibleServices(SERVICES).map((service) => service.id)).toEqual(SERVICES.map((service) => service.id));
    expect(APEX_LISTING.config.selected).toHaveLength(5);
    expect(getListingServices(APEX_LISTING.config, SERVICES).map((service) => service.name)).toEqual([
      "AC Repair & Diagnostics",
      "Annual Cooling Tune-Up & Maintenance",
      "Heat Pump Diagnostics & Repair",
      "Ductless Mini-Split Installation & Estimate",
      "Furnace Safety Inspection & Tune-Up",
    ]);
  });

  test("Emergency No-Heat / No-Cool Service is not selected, and is neither deleted nor deactivated", () => {
    expect(APEX_LISTING.config.selected).not.toContain(EMERGENCY);
    const emergency = SERVICES.find((service) => service.id === EMERGENCY)!;
    expect(emergency).toMatchObject({ name: "Emergency No-Heat / No-Cool Service", active: true, visibility: "public-booking" });
    expect(getPublicActiveServices(SERVICES).map((service) => service.id)).toContain(EMERGENCY);
  });

  test("a business with no listing is not set up, and the setup starts from every eligible Service", () => {
    const empty = emptyMarketplaceState(SERVICES);
    expect(empty.status).toBe("not-set-up");
    expect(empty.config.selected).toEqual(SERVICES.map((service) => service.id));
    expect(empty.slug).toBeUndefined();
  });

  test("the listing owns no business or Service data, only its own configuration", () => {
    const text = JSON.stringify(APEX_LISTING);
    for (const value of [business.name, business.phone, business.email, business.address.street, business.hours[0].hours, business.website]) {
      expect(text, value).not.toContain(value);
    }
    for (const service of SERVICES) {
      expect(text).not.toContain(service.name);
      expect(text).not.toContain(service.description);
    }
    // Services are held as ids only.
    expect(Object.keys(APEX_LISTING.config).sort()).toEqual(["actions", "areas", "contact", "cover", "description", "order", "selected"]);
  });

  test("reordering and selecting Services never mutates the Services themselves", () => {
    const before = JSON.stringify(SERVICES);
    const config = defaultListingConfig(SERVICES);
    const moved = moveService(config, "annual-cooling-tune-up", -1);
    expect(getOrderedEligibleServices(moved, SERVICES)[0].id).toBe("annual-cooling-tune-up");
    expect(getListingServices(moved, SERVICES)[0].id).toBe("annual-cooling-tune-up");
    expect(config.order[0]).toBe("ac-repair-diagnostics");
    // Ends are left alone.
    expect(moveService(config, config.order[0], -1)).toBe(config);
    const withoutEmergency = toggleService(config, EMERGENCY, false);
    expect(getListingServices(withoutEmergency, SERVICES)).toHaveLength(5);
    expect(getListingServices(toggleService(withoutEmergency, EMERGENCY, true), SERVICES)).toHaveLength(6);
    expect(JSON.stringify(SERVICES)).toBe(before);
  });

  test("a configuration is checked the way the server checks it: every field, plain text, at least one Service", () => {
    const config = APEX_LISTING.config;
    expect(parseListingConfig(config)).toEqual({ ok: true, value: { ...config, cover: config.cover } });
    expect(parseListingConfig({ ...config, description: "   " }).ok).toBe(false);
    expect(parseListingConfig({ ...config, description: "x".repeat(301) }).ok).toBe(false);
    expect(parseListingConfig({ ...config, description: "<b>Hello</b>" }).ok).toBe(false);
    expect(parseListingConfig({ ...config, description: "Call {{business.name}}" }).ok).toBe(false);
    expect(parseListingConfig({ ...config, selected: [] }).ok).toBe(false);
    expect(parseListingConfig({ ...config, cover: "neon" }).ok).toBe(false);
    expect(parseListingConfig({ ...config, cover: undefined })).toMatchObject({ ok: true });
    expect(parseListingConfig({ ...config, contact: { ...config.contact, fax: true } }).ok).toBe(false);
    expect(parseListingConfig({ ...config, actions: { book: true } }).ok).toBe(false);
    expect(parseListingConfig({ ...config, selected: ["Not A Slug"] }).ok).toBe(false);
    expect(parseListingConfig("a listing").ok).toBe(false);
    expect(isAnyContactShown(config)).toBe(true);
    expect(isAnyContactShown({ ...config, contact: { phone: false, email: false, address: false, hours: false, website: false } })).toBe(false);
    expect(sameConfig(config, { ...config })).toBe(true);
  });
});

test.describe("reviews data", () => {
  test("the approved totals are 12 reviews, 4.7 average, 3 awaiting a reply and 5 review requests", () => {
    expect(APEX_APPROVED.reviews).toEqual({ count: 12, average: 4.7, ratingSum: 56, awaiting: 3, requests: 5 });
    expect(getReviewMetrics(REVIEWS_DATA, REVIEW_ADJUSTMENT)).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
    // A representative sample, not twelve invented records.
    expect(REVIEWS.length).toBeLessThan(12);
  });

  test("Sarah Mitchell's review is the canonical one, tied to her Customers record and to job JB-204", () => {
    const review = getReviewById("rev-sarah-mitchell", REVIEWS_DATA)!;
    expect(review).toMatchObject({
      source: "Climvia",
      customerId: "sarah-mitchell",
      relatedJobId: "JB-204",
      rating: 5,
      text: "The technician explained the repair clearly and completed the work as scheduled.",
    });
    expect(getReviewStatus(review)).toBe("awaiting");
    expect(review.replyDraft).toBe(SARAH_REPLY);
    const job = getJobById("JB-204", OPERATIONS)!;
    expect(job).toMatchObject({ customerId: "sarah-mitchell", serviceId: "ac-repair-diagnostics" });
    expect(OPERATIONS.jobs.map((item) => item.id)).toContain("JB-204");
  });

  test("every review points at a real customer and job, or carries a name; the only source is Climvia", () => {
    for (const review of REVIEWS) {
      expect(Boolean(review.customerId) !== Boolean(review.contactName), review.id).toBe(true);
      expect(review.source).toBe("Climvia");
      if (review.relatedJobId) expect(getJobById(review.relatedJobId, OPERATIONS), review.id).toBeDefined();
      expect(review.date <= "2024-10-25", `${review.id} is not dated in the future`).toBe(true);
    }
    expect(REVIEWS.map((review) => review.customerId ?? "").join(" ")).not.toContain("rostova");
  });

  test("posting the canonical reply moves the same review to Responded, and the totals follow", () => {
    // The reply itself is stored by the server (maintenance-reviews-flows.spec.ts posts it through the screen); this is what the totals do with it.
    const after = withReply(REVIEWS_DATA, "rev-sarah-mitchell", SARAH_REPLY);
    const review = getReviewById("rev-sarah-mitchell", after)!;
    expect(getReviewStatus(review)).toBe("responded");
    expect(review.response).toMatchObject({ body: SARAH_REPLY, by: "Alex Morgan", at: "2024-10-25T10:45" });
    expect(after.reviews).toHaveLength(REVIEWS.length);
    expect(getReviewMetrics(after, REVIEW_ADJUSTMENT)).toEqual({ total: 12, average: 4.7, awaiting: 2, responded: 10, requests: 5 });
    // The baseline was not mutated, and a review has one response.
    expect(getReviewStatus(getReviewById("rev-sarah-mitchell", REVIEWS_DATA)!)).toBe("awaiting");
    expect(withReply(after, "rev-sarah-mitchell", "Something else")).toEqual(after);
    expect(withReply(REVIEWS_DATA, "rev-sarah-mitchell", "   ")).toEqual(REVIEWS_DATA);
  });

  test("editing a response changes the same response, not a new one", () => {
    const posted = withReply(REVIEWS_DATA, "rev-sarah-mitchell", SARAH_REPLY);
    const edited = withEditedReply(posted, "rev-sarah-mitchell", "Thank you, Sarah. We're glad it went well.");
    const response = getReviewById("rev-sarah-mitchell", edited)!.response!;
    expect(response).toMatchObject({ body: "Thank you, Sarah. We're glad it went well.", by: "Alex Morgan", at: "2024-10-25T10:45", edited: true });
    expect(edited.reviews).toHaveLength(posted.reviews.length);
    // Nothing to edit before a reply, and the totals do not move.
    expect(withEditedReply(REVIEWS_DATA, "rev-sarah-mitchell", "Hello")).toEqual(REVIEWS_DATA);
    expect(getReviewMetrics(edited, REVIEW_ADJUSTMENT).awaiting).toBe(2);
  });

  test("replying to a review that was already answered does not move the totals", () => {
    const edited = withEditedReply(REVIEWS_DATA, "rev-david-chen", "Thanks again, David!");
    expect(getReviewMetrics(edited, REVIEW_ADJUSTMENT)).toEqual(getReviewMetrics(REVIEWS_DATA, REVIEW_ADJUSTMENT));
  });

  test("a review request is recorded and nothing else: it adds one to the count and creates no campaign", () => {
    const marketingBefore = JSON.stringify(MARKETING);
    const { data, id } = withRequest(REVIEWS_DATA, { customerId: "sarah-mitchell", relatedJobId: "JB-204", channel: "sms", message: "  Please review us.  " });
    expect(data.requests).toEqual([{ id, customerId: "sarah-mitchell", relatedJobId: "JB-204", channel: "sms", message: "Please review us.", at: "2024-10-25T10:45" }]);
    expect(getReviewMetrics(data, REVIEW_ADJUSTMENT).requests).toBe(6);
    expect(data.reviews).toBe(REVIEWS_DATA.reviews);
    expect(JSON.stringify(MARKETING)).toBe(marketingBefore);
    expect(REVIEWS_DATA.requests).toHaveLength(0);
  });
});

test.describe("marketing data", () => {
  const campaigns = MARKETING.campaigns;
  const byId = (id: string) => campaigns.find((campaign) => campaign.id === id)!;

  test("the approved totals are 2 drafts, 1 scheduled, 8 sent and 146 recent recipients, counted from eleven stored campaigns", () => {
    expect(campaigns).toHaveLength(11);
    expect(getCampaignMetrics({ campaigns }, PROTOTYPE_TODAY)).toEqual({ drafts: 2, scheduled: 1, sent: 8, total: 11, recentRecipients: 146 });
    // The recent recipients are those of the campaigns sent in the last 60 days and the one still to go out: 42 + 48 + 18 + 38.
    expect(campaigns.filter((campaign) => campaign.status === "sent" && campaign.sentAt!.slice(0, 10) < "2024-08-26")).toHaveLength(5);
  });

  test("the scheduled campaign is Fall maintenance reminder, an email to 38 customers on Oct 30, 2024 at 9:00 AM business time", () => {
    const campaign = byId("cmp-fall-maintenance-reminder");
    expect(campaign).toMatchObject({
      name: "Fall maintenance reminder",
      channel: "email",
      audienceId: "due-for-maintenance",
      recipients: 38,
      status: "scheduled",
      scheduledFor: "2024-10-30T09:00",
    });
    expect(AUDIENCES.find((audience) => audience.id === campaign.audienceId)!.label).toBe("Customers due for maintenance");
    expect(campaign.message).toContain(FIRST_NAME_TOKEN);
    expect(formatCampaignTime(campaign.scheduledFor!)).toBe("Oct 30, 2024 · 9:00 AM");
  });

  test("the sent campaign is Cooling tune-up reminder: 42 recipients, 42 sent, 40 delivered, 2 not delivered", () => {
    const campaign = byId("cmp-cooling-tune-up-reminder");
    expect(campaign).toMatchObject({ name: "Cooling tune-up reminder", channel: "sms", recipients: 42, status: "sent" });
    expect(campaign.delivery).toMatchObject({ delivered: 40, notDelivered: 2 });
    const rows = campaign.recipientRows!;
    expect(rows.filter((record) => record.status === "not-delivered")).toHaveLength(2);
    expect(rows.length).toBeLessThan(42);
    expect(rows).toEqual(COOLING_TUNE_UP_RECIPIENTS);
    // Recipients with a Customers record link to it; the rest are snapshots of a name and a number.
    expect(rows.filter((record) => record.customerId).map((record) => record.customerId)).toEqual(["david-chen", "sarah-mitchell"]);
    expect(formatCampaignTime(campaign.sentAt!)).toBe("Oct 18, 2024 · 10:15 AM");
    // The SMS starter message fits one text.
    expect(defaultSmsMessage(business.name).length).toBe(155);
    expect(defaultSmsMessage(business.name).length).toBeLessThanOrEqual(SMS_LIMIT);
  });

  test("the first-name token is a placeholder that renders the first name, or 'there' when there is none", () => {
    expect(FIRST_NAME_TOKEN).toBe("{{contact.first_name}}");
    expect(renderMessage("Hi {{contact.first_name}},", "Sarah")).toBe("Hi Sarah,");
    expect(renderMessage("Hi {{contact.first_name}}, and {{contact.first_name}}", "Sarah")).toBe("Hi Sarah, and Sarah");
    expect(renderMessage("Hi {{contact.first_name}},")).toBe("Hi there,");
    expect(renderMessage("No token here", "Sarah")).toBe("No token here");
  });

  test("a campaign is found by its reference, in the campaigns it is given", () => {
    expect(getCampaignById("cmp-fall-maintenance-reminder", { campaigns })?.status).toBe("scheduled");
    expect(getCampaignById("cmp-nothing", { campaigns })).toBeUndefined();
  });
});

test.describe("Phase 6 source", () => {
  const PROHIBITED = [
    "wake county",
    "north carolina",
    "verified experience",
    "verified provider",
    "licensed",
    "licensing",
    "dispatch",
    "automation",
    "trigger",
    "ai response",
    "ai campaign",
    "seo reputation",
    "review incentive",
    "review gating",
    "gateway",
    "ledger",
    "encoding",
    "carrier route",
    "sponsored",
    "ranking score",
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

  test("growth code never reads the real clock or the browser's timezone", () => {
    const files = [
      ...sourceFiles("src/components/marketplace"),
      ...sourceFiles("src/components/reviews"),
      ...sourceFiles("src/components/marketing"),
      "src/data/marketplace.ts",
      "src/data/reviews.ts",
      "src/lib/review-rules.ts",
      "src/data/marketing.ts",
      "src/lib/marketplace-state.ts",
      "src/lib/marketplace-rules.ts",
      "src/lib/marketing-rules.ts",
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

  test("the Marketplace, Reviews and Marketing data never copy Service, business or customer details", () => {
    // The campaigns the application holds carry no recipients (the snapshot is read for one campaign at a time), so none of a customer's details.
    const campaigns = MARKETING.campaigns.map((campaign) => ({ ...campaign, recipientRows: undefined }));
    const text = JSON.stringify([APEX_LISTING, REVIEWS_DATA, campaigns]);
    for (const service of SERVICES) expect(text).not.toContain(service.description);
    for (const value of [business.phone, business.email, business.address.street]) expect(text).not.toContain(value);
    expect(text).not.toContain("sarah.m@gmail.com");
    expect(text).not.toContain("(512) 555-0194");
  });
});
