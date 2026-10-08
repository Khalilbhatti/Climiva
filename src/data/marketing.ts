/**
 * Marketing: lightweight email and text-message campaigns to existing customers.
 *
 * This is campaign management and nothing more. A campaign is a name, a channel, an audience, a message and
 * a status: Draft, Scheduled or Sent. There are no workflows, sequences or performance analytics. A sent
 * campaign shows what the approved screens show: how many people it went to, and for each recipient whether the
 * message was delivered.
 *
 * The workspace totals (2 drafts, 1 scheduled, 8 sent, 146 recent recipients) and the audience sizes are approved
 * aggregates, held in CAMPAIGN_BASELINE and AUDIENCES. The campaigns below are the representative sample the
 * approved screens show; they are not eleven invented records. Recipient names that match a Customers record use
 * it (name and phone or email come from the customer); the rest are deliberate contact snapshots.
 *
 * Times are business-local wall-clock strings ("2024-10-30T09:00", America/Chicago). Nothing here reads the
 * browser's clock or timezone.
 *
 * Sources: design-reference/stitch/ marketing_*, create_campaign_email, create_campaign_sms, campaign_review_schedule,
 * scheduled_campaign_detail, cancel_scheduled_campaign_modal, sent_campaign_detail. Conflicts are listed in
 * docs/stitch-screen-map.md §11.
 *
 * Fixtures are read-only. Demo changes live in components/marketing/MarketingProvider and reset on reload.
 */
import { formatTime } from "@/lib/dates";
import { formatDate } from "@/lib/format";

export type CampaignChannel = "email" | "sms";
export const CHANNEL_LABEL: Record<CampaignChannel, string> = { email: "Email", sms: "SMS" };

export type CampaignStatus = "draft" | "scheduled" | "sent";
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { draft: "Draft", scheduled: "Scheduled", sent: "Sent" };

export type AudienceId = "all-customers" | "due-for-maintenance" | "maintenance-customers" | "active-plans" | "selected";

/** Audience sizes are approved aggregates over the full customer base, not counts of the Customers sample. */
export const AUDIENCES: readonly { id: AudienceId; label: string; description: string; count?: number }[] = [
  { id: "all-customers", label: "All customers", description: "Everyone with a contact record", count: 146 },
  { id: "due-for-maintenance", label: "Customers due for maintenance", description: "Completed tune-up more than 6 months ago", count: 38 },
  { id: "maintenance-customers", label: "Maintenance customers", description: "Customers with a maintenance history", count: 42 },
  { id: "active-plans", label: "Customers with active plans", description: "Active maintenance plan", count: 18 },
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

export const DEFAULT_SUBJECT = "Time for seasonal HVAC maintenance";
export const DEFAULT_EMAIL_MESSAGE = `Hi ${FIRST_NAME_TOKEN},\n\nIt may be time to schedule your seasonal HVAC maintenance. You can review available Services and booking options with Apex Climate Heating & Air.`;
export const DEFAULT_SMS_MESSAGE = `Hi ${FIRST_NAME_TOKEN}, this is Apex Climate Heating & Air. If you’re due for seasonal maintenance, you can review available booking options in Climvia.`;

export type DeliveryStatus = "delivered" | "not-delivered";
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = { delivered: "Delivered", "not-delivered": "Not delivered" };

export type DeliveryRecord = {
  /** A Customers record where there is one; its name and phone are then read from it. */
  customerId?: string;
  /** Snapshot for a contact with no Customers record. */
  contact?: { name: string; phone: string };
  status: DeliveryStatus;
  /** "2024-10-18T10:15" */
  at: string;
};

export type Campaign = {
  /** URL slug: /marketing/[campaignId] */
  id: string;
  name: string;
  /** The short line under the name in the list. */
  summary?: string;
  channel: CampaignChannel;
  audienceId: AudienceId;
  /** Customers chosen when the audience is "Selected customers". */
  selectedCustomerIds?: readonly string[];
  /** How many people the campaign is for or went to; unset for a draft with no audience yet. */
  recipients?: number;
  subject?: string;
  message?: string;
  status: CampaignStatus;
  /** Scheduled campaigns only: "2024-10-30T09:00" */
  scheduledFor?: string;
  /** Sent campaigns only: "2024-10-18T10:15", or a date alone where the time is not recorded. */
  sentAt?: string;
  /** Where a sent campaign's delivery is recorded. */
  delivery?: { delivered: number; notDelivered: number; records: readonly DeliveryRecord[] };
};

export type MarketingData = { campaigns: readonly Campaign[] };

export const CAMPAIGNS: readonly Campaign[] = [
  {
    id: "cmp-fall-maintenance-reminder",
    name: "Fall maintenance reminder",
    summary: "Pre-season tune-up scheduling",
    channel: "email",
    audienceId: "due-for-maintenance",
    recipients: 38,
    subject: DEFAULT_SUBJECT,
    message: DEFAULT_EMAIL_MESSAGE,
    status: "scheduled",
    scheduledFor: "2024-10-30T09:00",
  },
  {
    id: "cmp-cooling-tune-up-reminder",
    name: "Cooling tune-up reminder",
    summary: "AC final maintenance checklist",
    channel: "sms",
    audienceId: "maintenance-customers",
    recipients: 42,
    message: DEFAULT_SMS_MESSAGE,
    status: "sent",
    sentAt: "2024-10-18T10:15",
    delivery: {
      delivered: 40,
      notDelivered: 2,
      // A sample of the 42: the two that were not delivered, and some of those that were.
      records: [
        { customerId: "david-chen", status: "delivered", at: "2024-10-18T10:15" },
        { customerId: "sarah-mitchell", status: "delivered", at: "2024-10-18T10:15" },
        { contact: { name: "Robert Garcia", phone: "(555) 441-2098" }, status: "delivered", at: "2024-10-18T10:15" },
        { contact: { name: "Linda Zhao", phone: "(555) 782-9904" }, status: "not-delivered", at: "2024-10-18T10:16" },
        { contact: { name: "James Wilson", phone: "(555) 883-1200" }, status: "delivered", at: "2024-10-18T10:15" },
        { contact: { name: "Marcus Sterling", phone: "(555) 310-7742" }, status: "not-delivered", at: "2024-10-18T10:16" },
      ],
    },
  },
  {
    id: "cmp-seasonal-service-reminder",
    name: "Seasonal service reminder",
    summary: "Early heating audit offer",
    channel: "email",
    audienceId: "selected",
    selectedCustomerIds: [],
    status: "draft",
  },
  {
    id: "cmp-winter-heating-prep-notice",
    name: "Winter heating prep notice",
    summary: "Furnace diagnostics protocol",
    channel: "email",
    audienceId: "all-customers",
    recipients: 48,
    status: "sent",
    sentAt: "2024-10-05",
  },
  {
    id: "cmp-filter-replacement-reminder",
    name: "Filter replacement reminder",
    summary: "Quarterly filter renewal notice",
    channel: "sms",
    audienceId: "active-plans",
    recipients: 18,
    status: "sent",
    sentAt: "2024-09-22",
  },
];

/** The workspace figures the approved Marketing screens show. */
export const CAMPAIGN_BASELINE = { draft: 2, scheduled: 1, sent: 8, recentRecipients: 146 } as const;

export const MARKETING_DATA: MarketingData = { campaigns: CAMPAIGNS };

const CANONICAL_STATUS: Record<string, CampaignStatus> = Object.fromEntries(CAMPAIGNS.map((campaign) => [campaign.id, campaign.status]));

/* ───────────────────────── selectors ───────────────────────── */

export const getCampaignById = (id: string, data: MarketingData = MARKETING_DATA) => data.campaigns.find((campaign) => campaign.id === id);

export type CampaignMetrics = { drafts: number; scheduled: number; sent: number; total: number; recentRecipients: number };

/**
 * The totals on the Marketing screens: the approved figures, moved by what happened in the session. A sample campaign
 * that changed status moves a count from one column to the other; a campaign created in the session adds one to the
 * column it is in. Recipients of campaigns sent in the session are added to the recent recipients.
 */
export function getCampaignMetrics(data: MarketingData): CampaignMetrics {
  const counts: Record<CampaignStatus, number> = { draft: CAMPAIGN_BASELINE.draft, scheduled: CAMPAIGN_BASELINE.scheduled, sent: CAMPAIGN_BASELINE.sent };
  let recentRecipients: number = CAMPAIGN_BASELINE.recentRecipients;
  for (const campaign of data.campaigns) {
    const original = CANONICAL_STATUS[campaign.id];
    if (original === undefined) {
      counts[campaign.status] += 1;
      if (campaign.status === "sent") recentRecipients += campaign.recipients ?? 0;
    } else if (original !== campaign.status) {
      counts[original] -= 1;
      counts[campaign.status] += 1;
    }
  }
  return { drafts: counts.draft, scheduled: counts.scheduled, sent: counts.sent, total: counts.draft + counts.scheduled + counts.sent, recentRecipients };
}

/** How many people an audience reaches. A chosen list is counted; the others are approved sizes. */
export function getAudienceCount(audienceId: AudienceId, selectedCustomerIds: readonly string[] = []): number | undefined {
  return audienceId === "selected" ? (selectedCustomerIds.length > 0 ? selectedCustomerIds.length : undefined) : getAudience(audienceId).count;
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
