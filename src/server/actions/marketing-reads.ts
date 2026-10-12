"use server";

import type { AudienceId, CampaignChannel } from "@/data/marketing";
import { RECIPIENT_LIST_LIMIT, loadCampaignRecipients, resolveAudience } from "@/db/marketing-queries";
import { withTenant } from "@/db/tenant";
import { failure, ok, type ActionResult } from "@/lib/action-result";
import { campaignRef, parseCampaignContent } from "@/lib/marketing-rules";
import { isRecord } from "@/lib/validation";
import { requireMember } from "../authorize";

/**
 * Marketing reads that need the server on demand: who a campaign is for. Any member of the workspace may ask (they can read the
 * campaigns and the customers anyway); nothing here changes anything. Each read resolves the caller and the active organization
 * from the session and a verified membership, never from the arguments, and runs inside the tenant transaction.
 *
 * A Scheduled or Sent campaign answers with its recipient SNAPSHOT (the people and contact details it was scheduled or sent with,
 * not the customers as they are now). Anything else answers with the audience as it resolves right now, for the builder's preview.
 */

export type RecipientList = {
  /** The people listed (at most 200 at a time), each with the destination the campaign's channel uses. */
  people: { name: string; destination: string; customerId?: string }[];
  /** How many recipients the campaign has or would have: can exceed the people listed. */
  total: number;
  /** "snapshot": taken when the campaign was scheduled or sent. "preview": the audience as it is now. */
  source: "snapshot" | "preview";
};

const destinationOf = (channel: CampaignChannel, contact: { email?: string | null; phone?: string | null }) => (channel === "email" ? contact.email : contact.phone) ?? "";

/** The recipients of a campaign, by its reference. */
export async function campaignRecipientsAction(input: unknown): Promise<ActionResult<RecipientList>> {
  const auth = await requireMember();
  if (!auth.ok) return auth.result;
  const slug = campaignRef(isRecord(input) ? input.id : undefined);
  if (!slug) return failure("The campaign was not understood.");
  const { userId, organizationId, organization } = auth.context;
  const found = await withTenant({ userId, organizationId }, (tx) => loadCampaignRecipients(tx, organizationId, organization.timezone, slug));
  if (!found) return failure("That campaign no longer exists. Reload the page and try again.");
  const { campaign, recipients, total } = found;
  return ok({
    people: recipients.map((recipient) => ({ name: recipient.name, destination: destinationOf(campaign.channel, recipient), customerId: recipient.customerId })),
    total,
    source: "snapshot",
  });
}

/** Who an audience reaches right now, for the campaign builder's "View recipients". */
export async function previewRecipientsAction(input: unknown): Promise<ActionResult<RecipientList>> {
  const auth = await requireMember();
  if (!auth.ok) return auth.result;
  const parsed = parseCampaignContent(isRecord(input) ? { name: "preview", ...input } : input, "draft");
  if (!parsed.ok) return failure("The audience was not understood.");
  const { channel, audienceId, selectedCustomerIds } = parsed.value as { channel: CampaignChannel; audienceId: AudienceId; selectedCustomerIds: string[] };
  const { userId, organizationId, snapshot } = auth.context;
  const audience = await withTenant({ userId, organizationId }, (tx) => resolveAudience(tx, organizationId, snapshot.clock.today, channel, audienceId, selectedCustomerIds));
  return ok({
    people: audience.contacts.slice(0, RECIPIENT_LIST_LIMIT).map((contact) => ({ name: contact.name, destination: destinationOf(channel, contact), customerId: contact.slug })),
    total: audience.total,
    source: "preview",
  });
}
