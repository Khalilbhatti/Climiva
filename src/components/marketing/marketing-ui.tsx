import { CircleAlert, Mail, MessageSquare, Check } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { getCustomerById } from "@/data/customers";
import {
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_LABEL,
  DELIVERY_STATUS_LABEL,
  formatCampaignTime,
  getAudience,
  type Campaign,
  type CampaignChannel,
  type CampaignStatus,
  type DeliveryRecord,
  type DeliveryStatus,
} from "@/data/marketing";

const STATUS_TONE: Record<CampaignStatus, StatusTone> = { draft: "neutral", scheduled: "warning", sent: "positive" };

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{CAMPAIGN_STATUS_LABEL[status]}</StatusBadge>;
}

/** The channel as an icon and its name: the name is the text, the icon only decoration. */
export function ChannelBadge({ channel }: { channel: CampaignChannel }) {
  const Icon = channel === "email" ? Mail : MessageSquare;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-btn bg-surface-low px-2 py-1 text-xs font-medium text-ink">
      <Icon aria-hidden className="size-3.5 text-ink-muted" />
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

/** Delivery status as an icon and a word, never colour alone. */
export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const delivered = status === "delivered";
  const Icon = delivered ? Check : CircleAlert;
  return (
    <span
      className={
        delivered
          ? "inline-flex items-center gap-1.5 rounded-full border border-positive-line bg-positive-soft px-2.5 py-1 text-xs font-semibold text-positive"
          : "inline-flex items-center gap-1.5 rounded-full border border-danger-line bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger"
      }
    >
      <Icon aria-hidden className="size-3.5" />
      {DELIVERY_STATUS_LABEL[status]}
    </span>
  );
}

export const audienceName = (campaign: Pick<Campaign, "audienceId">) => getAudience(campaign.audienceId).label;

/** The list's "Send date": when it goes, when it went, or that it has no date. */
export function sendDateText(campaign: Campaign, withTime = true): string {
  if (campaign.status === "scheduled" && campaign.scheduledFor) return formatCampaignTime(campaign.scheduledFor);
  if (campaign.status === "sent" && campaign.sentAt) return withTime ? formatCampaignTime(campaign.sentAt) : formatCampaignTime(campaign.sentAt.split("T")[0]);
  return "Not scheduled";
}

export const recipientsText = (campaign: Pick<Campaign, "recipients">) => (campaign.recipients === undefined ? "—" : String(campaign.recipients));

/** Who a delivery record is for, and where it went. A Customers record supplies both where there is one. */
export function describeDelivery(record: DeliveryRecord, channel: CampaignChannel) {
  const customer = record.customerId ? getCustomerById(record.customerId) : undefined;
  return {
    name: customer?.name ?? record.contact?.name ?? "Contact",
    customerId: customer?.id,
    destination: customer ? (channel === "email" ? customer.email : customer.phone) : (record.contact?.phone ?? ""),
  };
}
