/**
 * What a browser may ask of Marketing, as the server reads it. Pure functions: no database, no framework, no clock (the business's
 * "now" is handed in). The server actions call these before they write, and the database holds the same rules again (checks, guards
 * and grants in the marketing migrations), so a forged request cannot do what a screen would never offer.
 *
 * A campaign moves Draft -> Scheduled -> Sent. A Draft can also be sent at once; a Scheduled campaign can be rescheduled, taken back
 * to Draft (the schedule is cancelled) or sent; a Sent campaign is final. Nothing is delivered anywhere: "sent" is a recorded state.
 */
import {
  AUDIENCES,
  CAMPAIGN_NAME_MAX,
  EMAIL_MESSAGE_MAX,
  SMS_LIMIT,
  SUBJECT_MAX,
  type AudienceId,
  type CampaignChannel,
  type CampaignStatus,
} from "@/data/marketing";
import { addDays, isValidDate } from "./dates";
import { isRecord, slugify, type Parsed } from "./validation";

const fail = (error: string, fields?: Record<string, string>): { ok: false; error: string; fields?: Record<string, string> } => ({ ok: false, error, fields });

/* ───────────────────────── status transitions ───────────────────────── */

/** The one table of moves. A Sent campaign has none: it is a record. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["draft", "scheduled", "sent"],
  scheduled: ["scheduled", "draft", "sent"],
  sent: [],
};

export const canTransition = (from: CampaignStatus, to: CampaignStatus) => CAMPAIGN_TRANSITIONS[from].includes(to);

export const STALE_CAMPAIGN = "This campaign has changed since you opened it. Reload the page and try again.";
export const GONE_CAMPAIGN = "That campaign no longer exists. Reload the page and try again.";
export const SENT_CAMPAIGN = "A sent campaign can’t be changed. Duplicate it to start a new draft from the same message.";

/* ───────────────────────── references ───────────────────────── */

const CAMPAIGN_REFERENCE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const CUSTOMER_REFERENCE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** "cmp-fall-maintenance-reminder": a campaign is named by its reference; anything else names nothing. */
export const campaignRef = (value: unknown): string | undefined => (typeof value === "string" && CAMPAIGN_REFERENCE.test(value) ? value : undefined);

/** A new campaign's reference: "cmp-" and the name, made unique among the references already taken. */
export function newCampaignRef(name: string, taken: ReadonlySet<string>): string {
  const base = `cmp-${slugify(name, "campaign")}`.slice(0, 100).replace(/-+$/, "");
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/* ───────────────────────── the campaign itself ───────────────────────── */

export type CampaignContent = {
  name: string;
  channel: CampaignChannel;
  audienceId: AudienceId;
  /** Customer references, without duplicates. Only for the "selected" audience; otherwise empty. */
  selectedCustomerIds: string[];
  /** Email only. */
  subject: string | null;
  message: string | null;
};

const AUDIENCE_IDS = AUDIENCES.map((audience) => audience.id);
const MAX_SELECTED = 1000;

/**
 * A campaign's content. As a DRAFT only the name is required (a draft is saved half written). To SCHEDULE or SEND (`complete`) the
 * audience must reach someone, an email needs its subject, and the message must be written.
 */
export function parseCampaignContent(input: unknown, mode: "draft" | "complete"): Parsed<CampaignContent> {
  if (!isRecord(input)) return fail("The campaign was not understood.");
  const channel = input.channel === "email" || input.channel === "sms" ? input.channel : undefined;
  const audienceId = AUDIENCE_IDS.find((id) => id === input.audienceId);
  if (!channel || !audienceId || typeof input.name !== "string" || (input.subject !== undefined && typeof input.subject !== "string") || (input.message !== undefined && typeof input.message !== "string")) {
    return fail("The campaign was not understood.");
  }

  const fields: Record<string, string> = {};
  const name = input.name.trim();
  if (name === "") fields.name = "Enter a campaign name.";
  else if (name.length > CAMPAIGN_NAME_MAX) fields.name = `Keep the campaign name to ${CAMPAIGN_NAME_MAX} characters or fewer.`;

  let selectedCustomerIds: string[] = [];
  if (audienceId === "selected") {
    if (!Array.isArray(input.selectedCustomerIds) || input.selectedCustomerIds.length > MAX_SELECTED || input.selectedCustomerIds.some((id) => typeof id !== "string" || !CUSTOMER_REFERENCE.test(id))) {
      return fail("The campaign was not understood.");
    }
    selectedCustomerIds = [...new Set(input.selectedCustomerIds as string[])];
    if (mode === "complete" && selectedCustomerIds.length === 0) fields.audience = "Choose at least one customer.";
  }

  const subject = channel === "email" ? (typeof input.subject === "string" ? input.subject.trim() : "") : "";
  if (channel === "email" && subject.length > SUBJECT_MAX) fields.subject = `Keep the subject line to ${SUBJECT_MAX} characters or fewer.`;
  if (channel === "email" && mode === "complete" && subject === "") fields.subject = "Enter a subject line.";

  const message = typeof input.message === "string" ? input.message.trim() : "";
  const limit = channel === "email" ? EMAIL_MESSAGE_MAX : SMS_LIMIT;
  if (message.length > limit) fields.message = channel === "email" ? `Keep the message to ${EMAIL_MESSAGE_MAX} characters or fewer.` : `A text message can be ${SMS_LIMIT} characters or fewer.`;
  if (mode === "complete" && message === "") fields.message = "Write the message.";

  const first = Object.values(fields)[0];
  if (first) return fail(first, fields);
  return { ok: true, value: { name, channel, audienceId, selectedCustomerIds, subject: subject === "" ? null : subject, message: message === "" ? null : message } };
}

/* ───────────────────────── timing ───────────────────────── */

export type Timing = { mode: "now" } | { mode: "later"; date: string; time: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HORIZON_DAYS = 730;

/**
 * When a campaign goes out. "Now" has no time. A later time is the business's LOCAL date and time ("2024-10-30" and "09:00"),
 * read in the organization's time zone on the server, never the browser's: it must be today or later, and on today a time after
 * `now`. `clock` is the business's own today and now ("2024-10-25", "2024-10-25T10:45").
 */
export function parseTiming(input: unknown, clock: { today: string; now: string }): Parsed<Timing> {
  if (!isRecord(input)) return fail("The send time was not understood.");
  if (input.mode === "now") return { ok: true, value: { mode: "now" } };
  if (input.mode !== "later") return fail("The send time was not understood.");
  const fields: Record<string, string> = {};
  const date = typeof input.date === "string" ? input.date : "";
  const time = typeof input.time === "string" ? input.time : "";
  if (!isValidDate(date)) fields.date = "Choose the date to send.";
  else if (date < clock.today) fields.date = "Choose today or a later date.";
  else if (date > addDays(clock.today, HORIZON_DAYS)) fields.date = "Choose a date within the next two years.";
  if (!TIME.test(time)) fields.time = "Choose the time to send.";
  else if (!fields.date && date === clock.today && `${date}T${time}` <= clock.now) fields.time = "Choose a time later than now.";
  const first = Object.values(fields)[0];
  if (first) return fail(first, fields);
  return { ok: true, value: { mode: "later", date, time } };
}

/** A campaign's first moment as the business-local "YYYY-MM-DDTHH:mm" the database column is built from. */
export const localMoment = (timing: Extract<Timing, { mode: "later" }>) => `${timing.date}T${timing.time}`;
