/**
 * What a browser may ask of Marketing, as the server reads it (src/lib/marketing-rules): the status transitions, the campaign's
 * content, the send time in the business's own clock, and the references. Pure functions: no database, no browser. The server
 * actions call these before they write, and the database holds the same rules again (marketing-database.spec.ts).
 */
import { expect, test } from "playwright/test";
import { SMS_LIMIT, defaultEmailMessage, defaultSmsMessage, type CampaignStatus } from "../src/data/marketing";
import {
  CAMPAIGN_TRANSITIONS,
  campaignRef,
  canTransition,
  localMoment,
  newCampaignRef,
  parseCampaignContent,
  parseTiming,
} from "../src/lib/marketing-rules";

const CLOCK = { today: "2024-10-25", now: "2024-10-25T10:45" };

const email = { name: "Fall reminder", channel: "email", audienceId: "all-customers", subject: "Hello", message: "Hi {{contact.first_name}}" };
const sms = { name: "Text reminder", channel: "sms", audienceId: "maintenance-customers", message: "Hi {{contact.first_name}}" };

test.describe("status transitions", () => {
  test("a Draft can be saved, scheduled or sent; a Scheduled campaign can be rescheduled, taken back to Draft or sent; a Sent campaign goes nowhere", () => {
    expect(CAMPAIGN_TRANSITIONS).toEqual({ draft: ["draft", "scheduled", "sent"], scheduled: ["scheduled", "draft", "sent"], sent: [] });
    const all: CampaignStatus[] = ["draft", "scheduled", "sent"];
    for (const to of all) expect(canTransition("sent", to), `sent -> ${to}`).toBe(false);
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "draft")).toBe(true);
    expect(canTransition("scheduled", "sent")).toBe(true);
    expect(canTransition("draft", "sent")).toBe(true);
  });
});

test.describe("a campaign's content", () => {
  test("a draft needs a name and nothing else; scheduling or sending needs the audience, the subject of an email and the message", () => {
    expect(parseCampaignContent({ name: "Just a name", channel: "email", audienceId: "all-customers" }, "draft")).toMatchObject({ ok: true, value: { name: "Just a name", subject: null, message: null } });
    expect(parseCampaignContent({ name: "  ", channel: "email", audienceId: "all-customers" }, "draft")).toMatchObject({ ok: false, fields: { name: "Enter a campaign name." } });
    const incomplete = parseCampaignContent({ name: "Needs more", channel: "email", audienceId: "all-customers" }, "complete");
    expect(incomplete).toMatchObject({ ok: false, fields: { subject: "Enter a subject line.", message: "Write the message." } });
    expect(parseCampaignContent(email, "complete")).toMatchObject({ ok: true });
    // A text message has no subject, so does not need one.
    expect(parseCampaignContent(sms, "complete")).toMatchObject({ ok: true, value: { subject: null } });
  });

  test("the name, subject and message are trimmed, and a subject is dropped from a text message", () => {
    const parsed = parseCampaignContent({ ...email, name: "  Fall reminder  ", subject: "  Hello  ", message: "  Hi  " }, "complete");
    expect(parsed).toMatchObject({ ok: true, value: { name: "Fall reminder", subject: "Hello", message: "Hi" } });
    expect(parseCampaignContent({ ...sms, subject: "Ignored" }, "complete")).toMatchObject({ ok: true, value: { subject: null } });
  });

  test("a text message is at most 160 characters; an email is at most 5000; names and subjects have limits", () => {
    expect(SMS_LIMIT).toBe(160);
    expect(parseCampaignContent({ ...sms, message: "x".repeat(160) }, "complete").ok).toBe(true);
    expect(parseCampaignContent({ ...sms, message: "x".repeat(161) }, "complete")).toMatchObject({ ok: false, fields: { message: "A text message can be 160 characters or fewer." } });
    expect(parseCampaignContent({ ...email, message: "x".repeat(5000) }, "complete").ok).toBe(true);
    expect(parseCampaignContent({ ...email, message: "x".repeat(5001) }, "complete").ok).toBe(false);
    expect(parseCampaignContent({ ...email, name: "n".repeat(121) }, "draft").ok).toBe(false);
    expect(parseCampaignContent({ ...email, subject: "s".repeat(201) }, "draft").ok).toBe(false);
  });

  test("an unknown channel or audience, or a value of the wrong type, is not understood", () => {
    for (const bad of [{ channel: "fax" }, { channel: undefined }, { audienceId: "everyone" }, { audienceId: undefined }, { name: 5 }, { subject: 5 }, { message: {} }]) {
      expect(parseCampaignContent({ ...email, ...bad }, "draft").ok, JSON.stringify(bad)).toBe(false);
    }
    for (const bad of [null, undefined, "campaign", 5, [], [email]]) expect(parseCampaignContent(bad, "draft").ok).toBe(false);
  });

  test("a chosen list is customer references without duplicates, needs at least one to schedule, and is dropped from any other audience", () => {
    const selected = { ...email, audienceId: "selected" };
    expect(parseCampaignContent({ ...selected, selectedCustomerIds: ["sarah-mitchell", "david-chen", "sarah-mitchell"] }, "complete")).toMatchObject({ ok: true, value: { selectedCustomerIds: ["sarah-mitchell", "david-chen"] } });
    expect(parseCampaignContent({ ...selected, selectedCustomerIds: [] }, "draft").ok).toBe(true);
    expect(parseCampaignContent({ ...selected, selectedCustomerIds: [] }, "complete")).toMatchObject({ ok: false, fields: { audience: "Choose at least one customer." } });
    expect(parseCampaignContent({ ...email, selectedCustomerIds: ["sarah-mitchell"] }, "complete")).toMatchObject({ ok: true, value: { selectedCustomerIds: [] } });
    // Anything that is not a reference is refused outright.
    for (const bad of [["Sarah Mitchell"], ["../x"], [5], ["a".repeat(81)], "sarah-mitchell"]) expect(parseCampaignContent({ ...selected, selectedCustomerIds: bad }, "draft").ok, JSON.stringify(bad)).toBe(false);
    expect(parseCampaignContent({ ...selected, selectedCustomerIds: Array.from({ length: 1001 }, (_, index) => `c-${index}`) }, "draft").ok).toBe(false);
  });

  test("the starter messages name the business that is writing, and a text starter always fits one text", () => {
    expect(defaultEmailMessage("Northstar Heating & Cooling")).toContain("Northstar Heating & Cooling");
    expect(defaultEmailMessage("Northstar Heating & Cooling")).not.toContain("Apex");
    expect(defaultSmsMessage("Apex Climate Heating & Air")).toHaveLength(155);
    expect(defaultSmsMessage("A".repeat(150)).length).toBeLessThanOrEqual(SMS_LIMIT);
    expect(defaultSmsMessage("Northstar Heating & Cooling")).toContain("Northstar Heating & Cooling");
  });
});

test.describe("when a campaign goes out", () => {
  test("Send now has no time; a later time is the business's local date and time", () => {
    expect(parseTiming({ mode: "now" }, CLOCK)).toEqual({ ok: true, value: { mode: "now" } });
    const later = parseTiming({ mode: "later", date: "2024-10-30", time: "09:00" }, CLOCK);
    expect(later).toEqual({ ok: true, value: { mode: "later", date: "2024-10-30", time: "09:00" } });
    if (later.ok && later.value.mode === "later") expect(localMoment(later.value)).toBe("2024-10-30T09:00");
  });

  test("the date must be today or later and the time later than now, on the business's own clock", () => {
    expect(parseTiming({ mode: "later", date: "2024-10-24", time: "09:00" }, CLOCK)).toMatchObject({ ok: false, fields: { date: "Choose today or a later date." } });
    expect(parseTiming({ mode: "later", date: "2024-10-25", time: "10:45" }, CLOCK)).toMatchObject({ ok: false, fields: { time: "Choose a time later than now." } });
    expect(parseTiming({ mode: "later", date: "2024-10-25", time: "09:00" }, CLOCK)).toMatchObject({ ok: false, fields: { time: "Choose a time later than now." } });
    expect(parseTiming({ mode: "later", date: "2024-10-25", time: "10:46" }, CLOCK).ok).toBe(true);
    // The same wall-clock time is fine on another business's later day.
    expect(parseTiming({ mode: "later", date: "2026-10-12", time: "09:00" }, { today: "2026-10-12", now: "2026-10-12T08:00" }).ok).toBe(true);
    expect(parseTiming({ mode: "later", date: "2026-10-12", time: "09:00" }, { today: "2026-10-12", now: "2026-10-12T09:30" }).ok).toBe(false);
  });

  test("a missing, malformed or absurd date or time is refused", () => {
    for (const bad of [{ date: "", time: "09:00" }, { date: "2024-13-01", time: "09:00" }, { date: "2024-10-30", time: "" }, { date: "2024-10-30", time: "9:00" }, { date: "2024-10-30", time: "24:00" }, { date: "2024-10-30", time: "09:60" }, { date: "2027-10-26", time: "09:00" }, { date: 20241030, time: "09:00" }]) {
      expect(parseTiming({ mode: "later", ...bad }, CLOCK).ok, JSON.stringify(bad)).toBe(false);
    }
    for (const bad of [null, "now", { mode: "whenever" }, {}, []]) expect(parseTiming(bad, CLOCK).ok).toBe(false);
  });
});

test.describe("references", () => {
  test("a campaign is named by its reference; anything else names nothing", () => {
    expect(campaignRef("cmp-fall-maintenance-reminder")).toBe("cmp-fall-maintenance-reminder");
    for (const bad of ["", "Cmp-Fall", "cmp fall", "-cmp", "../cmp", `cmp-${"a".repeat(130)}`, 5, null, undefined, {}]) expect(campaignRef(bad), String(bad)).toBeUndefined();
  });

  test("a new campaign's reference comes from its name, and is made unique among those taken", () => {
    expect(newCampaignRef("Fall maintenance reminder", new Set())).toBe("cmp-fall-maintenance-reminder");
    expect(newCampaignRef("Fall maintenance reminder", new Set(["cmp-fall-maintenance-reminder"]))).toBe("cmp-fall-maintenance-reminder-2");
    expect(newCampaignRef("Fall maintenance reminder", new Set(["cmp-fall-maintenance-reminder", "cmp-fall-maintenance-reminder-2"]))).toBe("cmp-fall-maintenance-reminder-3");
    expect(newCampaignRef("!!!", new Set())).toBe("cmp-campaign");
    const long = newCampaignRef("x".repeat(200), new Set());
    expect(campaignRef(long)).toBe(long);
    expect(long.length).toBeLessThanOrEqual(100);
  });
});
