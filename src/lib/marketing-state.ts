/**
 * Pure state transitions for the Marketing demo. Nothing is delivered anywhere: "sent" is a status and a time held in
 * memory. A sent campaign is immutable: duplicating it creates a new Draft and never reopens the original. No
 * function here mutates its input.
 */
import { PROTOTYPE_NOW } from "@/data/fixtures";
import {
  getAudienceCount,
  type AudienceId,
  type Campaign,
  type CampaignChannel,
  type MarketingData,
} from "@/data/marketing";
import { slugify } from "./team-state";

export type CampaignInput = {
  name: string;
  channel: CampaignChannel;
  audienceId: AudienceId;
  selectedCustomerIds?: readonly string[];
  subject?: string;
  message?: string;
};

function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const fromInput = (input: CampaignInput): Omit<Campaign, "id" | "status"> => ({
  name: input.name.trim(),
  channel: input.channel,
  audienceId: input.audienceId,
  selectedCustomerIds: input.audienceId === "selected" ? [...(input.selectedCustomerIds ?? [])] : undefined,
  recipients: getAudienceCount(input.audienceId, input.selectedCustomerIds),
  // An email has a subject; a text message does not.
  subject: input.channel === "email" ? input.subject?.trim() || undefined : undefined,
  message: input.message?.trim() || undefined,
});

const mapCampaign = (data: MarketingData, id: string, change: (campaign: Campaign) => Campaign): MarketingData => ({
  ...data,
  campaigns: data.campaigns.map((campaign) => (campaign.id === id ? change(campaign) : campaign)),
});

/** A new Draft. */
export function createDraft(data: MarketingData, input: CampaignInput): { data: MarketingData; campaign: Campaign } {
  const id = uniqueId(`cmp-${slugify(input.name) || "campaign"}`, data.campaigns.map((campaign) => campaign.id));
  const campaign: Campaign = { ...fromInput(input), id, status: "draft" };
  return { data: { ...data, campaigns: [...data.campaigns, campaign] }, campaign };
}

/** Saves edits to a Draft or Scheduled campaign. A Sent campaign is left exactly as it was. */
export function updateCampaign(data: MarketingData, id: string, input: CampaignInput): MarketingData {
  return mapCampaign(data, id, (campaign) => (campaign.status === "sent" ? campaign : { ...campaign, ...fromInput(input) }));
}

/** Saves a campaign as a Draft: any schedule is cleared. */
export function saveAsDraft(data: MarketingData, id: string, input: CampaignInput): MarketingData {
  return mapCampaign(data, id, (campaign) =>
    campaign.status === "sent" ? campaign : { ...campaign, ...fromInput(input), status: "draft", scheduledFor: undefined },
  );
}

/** Schedules a campaign for a business-local time such as "2024-10-30T09:00". */
export function scheduleCampaign(data: MarketingData, id: string, scheduledFor: string): MarketingData {
  return mapCampaign(data, id, (campaign) => (campaign.status === "sent" ? campaign : { ...campaign, status: "scheduled", scheduledFor }));
}

/** Marks a campaign as sent now. Nothing is delivered; no delivery records exist for it. */
export function sendCampaign(data: MarketingData, id: string): MarketingData {
  return mapCampaign(data, id, (campaign) =>
    campaign.status === "sent" ? campaign : { ...campaign, status: "sent", scheduledFor: undefined, sentAt: PROTOTYPE_NOW },
  );
}

/** Cancels a scheduled send. The campaign becomes a Draft and keeps its content and recipients; it is not deleted. */
export function cancelSchedule(data: MarketingData, id: string): MarketingData {
  return mapCampaign(data, id, (campaign) => (campaign.status === "scheduled" ? { ...campaign, status: "draft", scheduledFor: undefined } : campaign));
}

/** A new Draft with the same channel, audience and message. The original is untouched, whatever its status. */
export function duplicateCampaign(data: MarketingData, id: string): { data: MarketingData; campaign?: Campaign } {
  const original = data.campaigns.find((campaign) => campaign.id === id);
  if (!original) return { data };
  const name = `${original.name} (copy)`;
  const campaign: Campaign = {
    id: uniqueId(`cmp-${slugify(name)}`, data.campaigns.map((item) => item.id)),
    name,
    summary: original.summary,
    channel: original.channel,
    audienceId: original.audienceId,
    selectedCustomerIds: original.selectedCustomerIds ? [...original.selectedCustomerIds] : undefined,
    recipients: original.recipients,
    subject: original.subject,
    message: original.message,
    status: "draft",
  };
  return { data: { ...data, campaigns: [...data.campaigns, campaign] }, campaign };
}
