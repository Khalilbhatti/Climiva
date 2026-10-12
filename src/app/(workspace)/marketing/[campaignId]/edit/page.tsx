import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/marketing/CampaignBuilder";
import { getAudienceSizes } from "@/server/marketing-data";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({ params }: PageProps<"/marketing/[campaignId]/edit">) {
  await requireWorkspaceContext();
  const { campaignId } = await params;
  return <CampaignBuilder campaignId={campaignId} audienceSizes={await getAudienceSizes()} />;
}
