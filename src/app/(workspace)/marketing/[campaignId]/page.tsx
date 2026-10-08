import type { Metadata } from "next";
import { CampaignDetail } from "@/components/marketing/CampaignDetail";
import { CAMPAIGNS } from "@/data/marketing";

// The sample campaigns are prerendered. Any other id (a campaign made during a demo session) is resolved on the client.
export function generateStaticParams() {
  return CAMPAIGNS.map((campaign) => ({ campaignId: campaign.id }));
}

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/marketing/[campaignId]">) {
  const { campaignId } = await params;
  return <CampaignDetail campaignId={campaignId} />;
}
