import type { Metadata } from "next";
import { CampaignDetail } from "@/components/marketing/CampaignDetail";
import { campaignRef } from "@/lib/marketing-rules";
import { getCampaignWithRecipients } from "@/server/marketing-data";
import { requireWorkspaceContext } from "@/server/workspace";

// A campaign belongs to one business and is looked up in the ACTIVE business's campaigns; the title names none.
export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/marketing/[campaignId]">) {
  await requireWorkspaceContext();
  const { campaignId } = await params;
  const slug = campaignRef(campaignId);
  // A Sent campaign whose delivery result was recorded lists its recipients with the result for each: read here, for this page only.
  const found = slug ? await getCampaignWithRecipients(slug) : null;
  const records = found?.campaign.status === "sent" && found.campaign.delivery ? found.recipients : [];
  return <CampaignDetail campaignId={campaignId} deliveryRecords={records} />;
}
