import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/marketing/CampaignBuilder";
import { CAMPAIGNS } from "@/data/marketing";

export function generateStaticParams() {
  return CAMPAIGNS.map((campaign) => ({ campaignId: campaign.id }));
}

export const metadata: Metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({ params }: PageProps<"/marketing/[campaignId]/edit">) {
  const { campaignId } = await params;
  return <CampaignBuilder campaignId={campaignId} />;
}
