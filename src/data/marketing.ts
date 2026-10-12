/**
 * Marketing: lightweight email and text-message campaigns to existing customers.
 *
 * This is campaign management and nothing more. A campaign is a name, a channel, an audience, a message and a status: Draft,
 * Scheduled or Sent. There are no workflows, sequences or performance analytics. A sent campaign shows what the approved screens
 * show: how many people it went to and, where a delivery result was recorded, for each recipient whether the message was delivered.
 *
 * Campaigns are rows in PostgreSQL, per organization, and reach the browser for the ACTIVE organization only
 * (src/db/marketing-queries, components/marketing/MarketingProvider). The canonical Apex campaigns are seed data
 * (scripts/db/seed-data/marketing.ts) and ship to no browser. Nothing is delivered anywhere: provider delivery (an email or SMS
 * service) is not built, so "sent" is a recorded state, and the delivery figures of a sent campaign are recorded data.
 *
 * The recipients of a Scheduled or Sent campaign are a SNAPSHOT taken when it was scheduled or sent. They are not part of this
 * data: a page that needs them asks the server for them (the people and their contact details are not sent with the campaigns).
 *
 * Times are business-local wall-clock strings ("2024-10-30T09:00") in the organization's time zone, converted on the server. Nothing
 * here reads the browser's clock or time zone.
 *
 * Sources: design-reference/stitch/ marketing_*, create_campaign_email, create_campaign_sms, campaign_review_schedule,
 * scheduled_campaign_detail, cancel_scheduled_campaign_modal, sent_campaign_detail. Conflicts are listed in
 * docs/stitch-screen-map.md §11.
 */
import { addDays, formatTime } from "@/lib/dates";
import { formatDate } from "@/lib/format";

export type CampaignChannel = "email" | "sms";
export const CHANNEL_LABEL: Record<CampaignChannel, string> = { email: "Email", sms: "SMS" };

export type CampaignStatus = "draft" | "scheduled" | "sent";
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { draft: "Draft", scheduled: "Scheduled", sent: "Sent" };

export type AudienceId = "all-customers" | "due-for-maintenance" | "maintenance-customers" | "active-plans" | "selected";

/**
 * The audiences a campaign can address. How many people each reaches is not here: it is worked out from the business's own
 * customers on the server (an audience size is a query over customers, jobs and plans, never a constant).
 */
export const AUDIENCES: readonly { id: AudienceId; label: string; description: string }[] = [
  { id: "all-customers", label: "All customers", description: "Everyone with a contact record" },
  { id: "due-for-maintenance", label: "Customers due for maintenance", description: "Completed tune-up more than 6 months ago" },
  { id: "maintenance-customers", label: "Maintenance customers", description: "Customers with a maintenance history" },
  { id: "active-plans", label: "Customers with active plans", description: "Active maintenance plan" },
  { id: "selected", label: "Selected customers", description: "Choose customers one by one" },
];

export const getAudience = (id: AudienceId) => AUDIENCES.find((audience) => audience.id === id)!;

/** What each channel starts with when a new campaign is created. */
export const DEFAULT_AUDIENCE: Record<CampaignChannel, AudienceId> = {
  email: "due-for-maintenance",
  sms: "maintenance-customers",
};

export const FIRST_NAME_TOKEN = "{{contact.first_name}}";
export const FIRST_NAME_HELPER = "Adds the customer’s first name when available.";
export const SMS_LIMIT = 160;
export const EMAIL_MESSAGE_MAX = 5000;
export const SUBJECT_MAX = 200;
export const CAMPAIGN_NAME_MAX = 120;

export const DEFAULT_SUBJECT = "Time for seasonal HVAC maintenance";
/** The starter message of a new campaign: the business's own name, never another's. */
export const defaultEmailMessage = (businessName: string) =>
  `Hi ${FIRST_NAME_TOKEN},\n\nIt may be time to schedule your seasonal HVAC maintenance. You can review available Services and booking options with ${businessName}.`;
export const defaultSmsMessage = (businessName: string): string => {
  const full = `Hi ${FIRST_NAME_TOKEN}, this is ${businessName}. If you’re due for seasonal maintenance, you can review available booking options in Climvia.`;
  // A text message is 160 characters at most: a long business name gets the short wording.
  return full.length <= SMS_LIMIT ? full : `Hi ${FIRST_NAME_TOKEN}, this is ${businessName}. Book your seasonal maintenance in Climvia.`.slice(0, SMS_LIMIT);
};

export type DeliveryStatus = "delivered" | "not-delivered";
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = { delivered: "Delivered", "not-delivered": "Not delivered" };

/**
 * One person in a campaign's recipient snapshot. The name and the contact details are those the customer had WHEN the campaign was
 * scheduled or sent; a later edit of the customer does not change them. `customerId` (the customer's reference) links the person to
 * the Customers record where there still is one.
 */
export type CampaignRecipient = {
  /** A stable reference for lists: the position in the snapshot. */
  id: string;
  customerId?: string;
  name: string;
  email?: string;
  phone?: string;
  /** "pending": in the snapshot with no delivery result recorded. */
  status: DeliveryStatus | "pending";
  /** When the delivery result was recorded, business-local "2024-10-18T10:15". */
  at?: string;
  failureReason?: string;
};

export type Campaign = {
  /** URL slug: /marketing/[campaignId] */
  id: string;
  name: string;
  /** The short line under the name in the list. */
  summary?: string;
  channel: CampaignChannel;
  audienceId: AudienceId;
  /** Customers (by reference) chosen when the audience is "Selected customers". */
  selectedCustomerIds?: readonly string[];
  /** How many people the campaign is for or went to; unset for a draft that has not been saved with an audience yet. */
  recipients?: number;
  subject?: string;
  message?: string;
  status: CampaignStatus;
  /** Scheduled campaigns only: "2024-10-30T09:00", the business's local time. */
  scheduledFor?: string;
  /** Sent campaigns only: "2024-10-18T10:15", or a date alone where the time is not recorded. */
  sentAt?: string;
  /** Sent campaigns whose delivery result was recorded: how many messages were and were not delivered. */
  delivery?: { delivered: number; notDelivered: number };
};

export type MarketingData = { campaigns: readonly Campaign[] };

/** What the campaign builder sends to the server: a campaign's content. The customers are named by their references. */
export type CampaignInput = {
  name: string;
  channel: CampaignChannel;
  audienceId: AudienceId;
  selectedCustomerIds?: readonly string[];
  subject?: string;
  message?: string;
};

/** When a campaign goes out: now, or the business's local date and time. */
export type SendTiming = { mode: "now" } | { mode: "later"; date: string; time: string };

/* ───────────────────────── selectors ───────────────────────── */

export const getCampaignById = (id: string, data: MarketingData) => data.campaigns.find((campaign) => campaign.id === id);

export type CampaignMetrics = { drafts: number; scheduled: number; sent: number; total: number; recentRecipients: number };

/** "Recent" is the last 60 days: campaigns sent in that time, and every campaign still to go out. */
export const RECENT_WINDOW_DAYS = 60;

/**
 * The totals on the Marketing screens, counted from the campaigns: one per status, and the people reached recently (the recipients
 * of campaigns sent within the last 60 days of `today`, plus those of campaigns scheduled to go out). Scheduling, sending and
 * cancelling move them by exactly that campaign's own recipients.
 */
export function getCampaignMetrics(data: MarketingData, today: string): CampaignMetrics {
  const since = addDays(today, -RECENT_WINDOW_DAYS);
  let drafts = 0;
  let scheduled = 0;
  let sent = 0;
  let recentRecipients = 0;
  for (const campaign of data.campaigns) {
    if (campaign.status === "draft") drafts += 1;
    else if (campaign.status === "scheduled") {
      scheduled += 1;
      recentRecipients += campaign.recipients ?? 0;
    } else {
      sent += 1;
      const day = campaign.sentAt?.slice(0, 10);
      if (day !== undefined && day >= since && day <= today) recentRecipients += campaign.recipients ?? 0;
    }
  }
  return { drafts, scheduled, sent, total: drafts + scheduled + sent, recentRecipients };
}

/** "Oct 30, 2024 · 9:00 AM" from "2024-10-30T09:00"; a date alone is "Oct 5, 2024". */
export function formatCampaignTime(value: string): string {
  const [date, time] = value.split("T");
  return time ? `${formatDate(date)} · ${formatTime(time)}` : formatDate(date);
}

/** "Hi {{contact.first_name}}," → "Hi Sarah,". With no first name available the greeting reads "there". */
export function renderMessage(text: string, firstName?: string): string {
  return text.split(FIRST_NAME_TOKEN).join(firstName?.trim() || "there");
}
