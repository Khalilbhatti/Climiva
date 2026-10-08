import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { business } from "../src/data/fixtures";
import {
  AUDIENCES,
  CAMPAIGNS,
  CAMPAIGN_BASELINE,
  MARKETING_DATA,
  FIRST_NAME_TOKEN,
  SMS_LIMIT,
  DEFAULT_SMS_MESSAGE,
  formatCampaignTime,
  getAudienceCount,
  getCampaignById,
  getCampaignMetrics,
  renderMessage,
} from "../src/data/marketing";
import {
  BASELINE_EXCLUDED_SERVICE_ID,
  defaultListingConfig,
  getEligibleServices,
  getListingServices,
  getOrderedEligibleServices,
  initialMarketplaceState,
  isAnyContactShown,
  sameConfig,
} from "../src/data/marketplace";
import { JOBS, getJobById } from "../src/data/operations";
import {
  REVIEWS,
  REVIEWS_DATA,
  REVIEW_BASELINE,
  SARAH_REPLY,
  getReviewById,
  getReviewMetrics,
  getReviewStatus,
} from "../src/data/reviews";
import { SERVICES, getPublicActiveServices } from "../src/data/services";
import { cancelSchedule, createDraft, duplicateCampaign, saveAsDraft, scheduleCampaign, sendCampaign, updateCampaign } from "../src/lib/marketing-state";
import { hideListing, moveService, publishListing, saveListing, setUpListing, toggleService } from "../src/lib/marketplace-state";
import { addReviewRequest, editResponse, postResponse } from "../src/lib/reviews-state";

// Pure data/selector/state tests: no browser needed.

const EMERGENCY = "emergency-no-heat-no-cool";

test.describe("marketplace data", () => {
  test("the baseline is a published listing showing exactly 5 of the 6 canonical Services", () => {
    const state = initialMarketplaceState();
    expect(state.status).toBe("published");
    expect(getEligibleServices()).toHaveLength(6);
    expect(getEligibleServices().map((service) => service.id)).toEqual(SERVICES.map((service) => service.id));
    expect(state.config.selected).toHaveLength(5);
    expect(getListingServices(state.config).map((service) => service.name)).toEqual([
      "AC Repair & Diagnostics",
      "Annual Cooling Tune-Up & Maintenance",
      "Heat Pump Diagnostics & Repair",
      "Ductless Mini-Split Installation & Estimate",
      "Furnace Safety Inspection & Tune-Up",
    ]);
  });

  test("Emergency No-Heat / No-Cool Service is not selected, and is neither deleted nor deactivated", () => {
    const config = initialMarketplaceState().config;
    expect(BASELINE_EXCLUDED_SERVICE_ID).toBe(EMERGENCY);
    expect(config.selected).not.toContain(EMERGENCY);
    expect(config.order).toContain(EMERGENCY);
    const emergency = SERVICES.find((service) => service.id === EMERGENCY)!;
    expect(emergency).toMatchObject({ name: "Emergency No-Heat / No-Cool Service", active: true, visibility: "public-booking" });
    expect(getPublicActiveServices().map((service) => service.id)).toContain(EMERGENCY);
  });

  test("the listing owns no business or Service data, only its own configuration", () => {
    const text = JSON.stringify(initialMarketplaceState());
    for (const value of [business.name, business.phone, business.email, business.address.street, business.hours[0].hours, business.website]) {
      expect(text, value).not.toContain(value);
    }
    for (const service of SERVICES) {
      expect(text).not.toContain(service.name);
      expect(text).not.toContain(service.description);
    }
    // Services are held as ids only.
    expect(Object.keys(initialMarketplaceState().config).sort()).toEqual(["actions", "contact", "cover", "description", "order", "selected"]);
  });

  test("reordering and selecting Services never mutates the Services themselves", () => {
    const before = JSON.stringify(SERVICES);
    const config = defaultListingConfig();
    const moved = moveService(config, "annual-cooling-tune-up", -1);
    expect(getOrderedEligibleServices(moved)[0].id).toBe("annual-cooling-tune-up");
    expect(getListingServices(moved)[0].id).toBe("annual-cooling-tune-up");
    expect(config.order[0]).toBe("ac-repair-diagnostics");
    // Ends are left alone.
    expect(moveService(config, config.order[0], -1)).toBe(config);
    const withEmergency = toggleService(config, EMERGENCY, true);
    expect(getListingServices(withEmergency)).toHaveLength(6);
    expect(getListingServices(toggleService(withEmergency, EMERGENCY, false))).toHaveLength(5);
    expect(JSON.stringify(SERVICES)).toBe(before);
  });

  test("hiding keeps the saved configuration; publishing restores it; edits save without changing the status", () => {
    const state = initialMarketplaceState();
    const edited = saveListing(state, { ...state.config, description: "A new description.", contact: { ...state.config.contact, phone: false } });
    expect(edited.status).toBe("published");
    const hidden = hideListing(edited);
    expect(hidden.status).toBe("hidden");
    expect(hidden.config).toEqual(edited.config);
    const shown = publishListing(hidden);
    expect(shown.status).toBe("published");
    expect(sameConfig(shown.config, edited.config)).toBe(true);
    // Saving while hidden leaves it hidden.
    expect(saveListing(hidden, state.config).status).toBe("hidden");
    // The original baseline object was never touched.
    expect(state.config.description).not.toBe("A new description.");
  });

  test("first-time setup saves and publishes in one step", () => {
    const state = { status: "not-set-up" as const, config: defaultListingConfig() };
    const result = setUpListing(state, { ...state.config, description: "Our listing." });
    expect(result.status).toBe("published");
    expect(result.config.description).toBe("Our listing.");
    expect(isAnyContactShown(result.config)).toBe(true);
    expect(isAnyContactShown({ ...result.config, contact: { phone: false, email: false, address: false, hours: false, website: false } })).toBe(false);
  });
});

test.describe("reviews data", () => {
  test("the approved totals are 12 reviews, 4.7 average, 3 awaiting a reply and 5 review requests", () => {
    expect(REVIEW_BASELINE).toEqual({ total: 12, average: 4.7, awaiting: 3, requests: 5 });
    expect(getReviewMetrics(REVIEWS_DATA)).toEqual({ total: 12, average: 4.7, awaiting: 3, responded: 9, requests: 5 });
    // A representative sample, not twelve invented records.
    expect(REVIEWS.length).toBeLessThan(12);
  });

  test("Sarah Mitchell's review is the canonical one, tied to her Customers record and to job JB-204", () => {
    const review = getReviewById("rev-sarah-mitchell")!;
    expect(review).toMatchObject({
      source: "Climvia",
      customerId: "sarah-mitchell",
      relatedJobId: "JB-204",
      rating: 5,
      text: "The technician explained the repair clearly and completed the work as scheduled.",
    });
    expect(getReviewStatus(review)).toBe("awaiting");
    expect(review.replyDraft).toBe(SARAH_REPLY);
    const job = getJobById("JB-204")!;
    expect(job).toMatchObject({ customerId: "sarah-mitchell", serviceId: "ac-repair-diagnostics" });
    expect(JOBS.map((item) => item.id)).toContain("JB-204");
  });

  test("every review points at a real customer and job, or carries a name; the only source is Climvia", () => {
    for (const review of REVIEWS) {
      expect(Boolean(review.customerId) !== Boolean(review.contactName), review.id).toBe(true);
      expect(review.source).toBe("Climvia");
      if (review.relatedJobId) expect(getJobById(review.relatedJobId), review.id).toBeDefined();
      expect(review.date <= "2024-10-25", `${review.id} is not dated in the future`).toBe(true);
    }
    expect(REVIEWS.map((review) => review.customerId ?? "").join(" ")).not.toContain("rostova");
  });

  test("posting the canonical reply moves the same review to Responded, and the totals follow", () => {
    const after = postResponse(REVIEWS_DATA, "rev-sarah-mitchell", SARAH_REPLY);
    const review = getReviewById("rev-sarah-mitchell", after)!;
    expect(getReviewStatus(review)).toBe("responded");
    expect(review.response).toMatchObject({ body: SARAH_REPLY, by: "Alex Morgan", at: "2024-10-25T10:45" });
    expect(after.reviews).toHaveLength(REVIEWS.length);
    expect(getReviewMetrics(after)).toEqual({ total: 12, average: 4.7, awaiting: 2, responded: 10, requests: 5 });
    // The baseline was not mutated, and a second reply does not replace the first.
    expect(getReviewStatus(getReviewById("rev-sarah-mitchell")!)).toBe("awaiting");
    expect(postResponse(after, "rev-sarah-mitchell", "Something else")).toEqual(after);
    expect(postResponse(REVIEWS_DATA, "rev-sarah-mitchell", "   ")).toEqual(REVIEWS_DATA);
  });

  test("editing a response changes the same response, not a new one", () => {
    const posted = postResponse(REVIEWS_DATA, "rev-sarah-mitchell", SARAH_REPLY);
    const edited = editResponse(posted, "rev-sarah-mitchell", "Thank you, Sarah. We're glad it went well.");
    const response = getReviewById("rev-sarah-mitchell", edited)!.response!;
    expect(response).toMatchObject({ body: "Thank you, Sarah. We're glad it went well.", by: "Alex Morgan", at: "2024-10-25T10:45", edited: true });
    expect(edited.reviews).toHaveLength(posted.reviews.length);
    // Nothing to edit before a reply, and the totals do not move.
    expect(editResponse(REVIEWS_DATA, "rev-sarah-mitchell", "Hello")).toEqual(REVIEWS_DATA);
    expect(getReviewMetrics(edited).awaiting).toBe(2);
  });

  test("replying to a review that was already answered does not move the totals", () => {
    const edited = editResponse(REVIEWS_DATA, "rev-david-chen", "Thanks again, David!");
    expect(getReviewMetrics(edited)).toEqual(getReviewMetrics(REVIEWS_DATA));
  });

  test("a review request is recorded and nothing else: it adds one to the count and creates no campaign", () => {
    const marketingBefore = JSON.stringify(MARKETING_DATA);
    const { data, id } = addReviewRequest(REVIEWS_DATA, { customerId: "sarah-mitchell", relatedJobId: "JB-204", channel: "sms", message: "  Please review us.  " });
    expect(data.requests).toEqual([{ id, customerId: "sarah-mitchell", relatedJobId: "JB-204", channel: "sms", message: "Please review us.", at: "2024-10-25T10:45" }]);
    expect(getReviewMetrics(data).requests).toBe(6);
    expect(data.reviews).toBe(REVIEWS_DATA.reviews);
    expect(JSON.stringify(MARKETING_DATA)).toBe(marketingBefore);
    expect(REVIEWS_DATA.requests).toHaveLength(0);
  });
});

test.describe("marketing data", () => {
  test("the approved totals are 2 drafts, 1 scheduled, 8 sent and 146 recent recipients", () => {
    expect(CAMPAIGN_BASELINE).toEqual({ draft: 2, scheduled: 1, sent: 8, recentRecipients: 146 });
    expect(getCampaignMetrics(MARKETING_DATA)).toEqual({ drafts: 2, scheduled: 1, sent: 8, total: 11, recentRecipients: 146 });
    expect(CAMPAIGNS.length).toBeLessThan(11);
  });

  test("the scheduled campaign is Fall maintenance reminder, an email to 38 customers on Oct 30, 2024 at 9:00 AM business time", () => {
    const campaign = getCampaignById("cmp-fall-maintenance-reminder")!;
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
    const campaign = getCampaignById("cmp-cooling-tune-up-reminder")!;
    expect(campaign).toMatchObject({ name: "Cooling tune-up reminder", channel: "sms", recipients: 42, status: "sent" });
    expect(campaign.delivery).toMatchObject({ delivered: 40, notDelivered: 2 });
    expect(campaign.delivery!.records.filter((record) => record.status === "not-delivered")).toHaveLength(2);
    expect(campaign.delivery!.records.length).toBeLessThan(42);
    // Recipients with a Customers record are read from it; the rest are snapshots.
    expect(campaign.delivery!.records.filter((record) => record.customerId).map((record) => record.customerId)).toEqual(["david-chen", "sarah-mitchell"]);
    expect(formatCampaignTime(campaign.sentAt!)).toBe("Oct 18, 2024 · 10:15 AM");
    // The SMS starter message fits one text.
    expect(DEFAULT_SMS_MESSAGE.length).toBe(155);
    expect(DEFAULT_SMS_MESSAGE.length).toBeLessThanOrEqual(SMS_LIMIT);
  });

  test("audience sizes: customers due for maintenance 38, maintenance customers 42, a chosen list is counted", () => {
    expect(getAudienceCount("due-for-maintenance")).toBe(38);
    expect(getAudienceCount("maintenance-customers")).toBe(42);
    expect(getAudienceCount("selected")).toBeUndefined();
    expect(getAudienceCount("selected", ["sarah-mitchell", "david-chen"])).toBe(2);
  });

  test("the first-name token is a placeholder that renders the first name, or 'there' when there is none", () => {
    expect(FIRST_NAME_TOKEN).toBe("{{contact.first_name}}");
    expect(renderMessage("Hi {{contact.first_name}},", "Sarah")).toBe("Hi Sarah,");
    expect(renderMessage("Hi {{contact.first_name}}, and {{contact.first_name}}", "Sarah")).toBe("Hi Sarah, and Sarah");
    expect(renderMessage("Hi {{contact.first_name}},")).toBe("Hi there,");
    expect(renderMessage("No token here", "Sarah")).toBe("No token here");
  });

  test("cancelling a scheduled send makes it a Draft, keeping its content and recipients, and never deletes it", () => {
    const after = cancelSchedule(MARKETING_DATA, "cmp-fall-maintenance-reminder");
    const campaign = getCampaignById("cmp-fall-maintenance-reminder", after)!;
    const original = getCampaignById("cmp-fall-maintenance-reminder")!;
    expect(campaign).toMatchObject({ status: "draft", name: original.name, recipients: 38, subject: original.subject, message: original.message, channel: "email" });
    expect(campaign.scheduledFor).toBeUndefined();
    expect(after.campaigns).toHaveLength(MARKETING_DATA.campaigns.length);
    expect(getCampaignMetrics(after)).toEqual({ drafts: 3, scheduled: 0, sent: 8, total: 11, recentRecipients: 146 });
    // Only a scheduled campaign can be cancelled.
    expect(cancelSchedule(MARKETING_DATA, "cmp-seasonal-service-reminder")).toEqual(MARKETING_DATA);
    expect(getCampaignById("cmp-fall-maintenance-reminder")!.status).toBe("scheduled");
  });

  test("a cancelled campaign can be rescheduled, and a draft can be sent now", () => {
    const draft = cancelSchedule(MARKETING_DATA, "cmp-fall-maintenance-reminder");
    const again = scheduleCampaign(draft, "cmp-fall-maintenance-reminder", "2024-11-02T10:30");
    expect(getCampaignById("cmp-fall-maintenance-reminder", again)).toMatchObject({ status: "scheduled", scheduledFor: "2024-11-02T10:30" });
    const sent = sendCampaign(again, "cmp-fall-maintenance-reminder");
    expect(getCampaignById("cmp-fall-maintenance-reminder", sent)).toMatchObject({ status: "sent", sentAt: "2024-10-25T10:45", scheduledFor: undefined });
    // 38 more recent recipients are not added: the campaign was one of the approved ones.
    expect(getCampaignMetrics(sent)).toEqual({ drafts: 2, scheduled: 0, sent: 9, total: 11, recentRecipients: 146 });
  });

  test("duplicating a Sent campaign creates a new Draft and leaves the original exactly as it was", () => {
    const before = JSON.stringify(getCampaignById("cmp-cooling-tune-up-reminder"));
    const { data, campaign } = duplicateCampaign(MARKETING_DATA, "cmp-cooling-tune-up-reminder");
    expect(campaign).toMatchObject({
      id: "cmp-cooling-tune-up-reminder-copy",
      name: "Cooling tune-up reminder (copy)",
      status: "draft",
      channel: "sms",
      audienceId: "maintenance-customers",
      recipients: 42,
      message: getCampaignById("cmp-cooling-tune-up-reminder")!.message,
    });
    expect(campaign!.sentAt).toBeUndefined();
    expect(campaign!.delivery).toBeUndefined();
    expect(data.campaigns).toHaveLength(MARKETING_DATA.campaigns.length + 1);
    expect(JSON.stringify(getCampaignById("cmp-cooling-tune-up-reminder", data))).toBe(before);
    expect(getCampaignMetrics(data)).toEqual({ drafts: 3, scheduled: 1, sent: 8, total: 12, recentRecipients: 146 });
    // A second copy gets its own id.
    expect(duplicateCampaign(data, "cmp-cooling-tune-up-reminder").campaign!.id).toBe("cmp-cooling-tune-up-reminder-copy-2");
  });

  test("a Sent campaign cannot be edited, rescheduled, re-sent or turned back into a Draft", () => {
    const input = { name: "Changed", channel: "email" as const, audienceId: "all-customers" as const, subject: "x", message: "y" };
    const unchanged = (data: typeof MARKETING_DATA) => JSON.stringify(getCampaignById("cmp-cooling-tune-up-reminder", data));
    const before = JSON.stringify(getCampaignById("cmp-cooling-tune-up-reminder"));
    expect(unchanged(updateCampaign(MARKETING_DATA, "cmp-cooling-tune-up-reminder", input))).toBe(before);
    expect(unchanged(saveAsDraft(MARKETING_DATA, "cmp-cooling-tune-up-reminder", input))).toBe(before);
    expect(unchanged(scheduleCampaign(MARKETING_DATA, "cmp-cooling-tune-up-reminder", "2024-11-01T09:00"))).toBe(before);
    expect(unchanged(sendCampaign(MARKETING_DATA, "cmp-cooling-tune-up-reminder"))).toBe(before);
    expect(unchanged(cancelSchedule(MARKETING_DATA, "cmp-cooling-tune-up-reminder"))).toBe(before);
  });

  test("a new draft is counted once, and sending it adds its recipients to the recent recipients", () => {
    const input = { name: "Fall maintenance reminder", channel: "email" as const, audienceId: "due-for-maintenance" as const, subject: "Time for seasonal HVAC maintenance", message: `Hi ${FIRST_NAME_TOKEN},` };
    const { data, campaign } = createDraft(MARKETING_DATA, input);
    expect(campaign).toMatchObject({ id: "cmp-fall-maintenance-reminder-2", status: "draft", recipients: 38 });
    expect(getCampaignMetrics(data)).toMatchObject({ drafts: 3, total: 12, recentRecipients: 146 });
    expect(getCampaignMetrics(sendCampaign(data, campaign.id))).toMatchObject({ drafts: 2, sent: 9, total: 12, recentRecipients: 184 });
    // A text message has no subject.
    expect(createDraft(MARKETING_DATA, { ...input, name: "Texty", channel: "sms" }).campaign.subject).toBeUndefined();
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
      "src/data/marketing.ts",
      "src/lib/marketplace-state.ts",
      "src/lib/reviews-state.ts",
      "src/lib/marketing-state.ts",
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
    const text = JSON.stringify([initialMarketplaceState(), REVIEWS_DATA, MARKETING_DATA]);
    for (const service of SERVICES) expect(text).not.toContain(service.description);
    for (const value of [business.phone, business.email, business.address.street]) expect(text).not.toContain(value);
    expect(text).not.toContain("sarah.m@gmail.com");
    expect(text).not.toContain("(512) 555-0194");
  });
});
