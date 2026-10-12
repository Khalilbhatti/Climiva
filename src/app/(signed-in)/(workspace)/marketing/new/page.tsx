import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/marketing/CampaignBuilder";
import { getAudienceSizes } from "@/server/marketing-data";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Create campaign" };

// The one campaign editor. The Overview "Create campaign" quick action and the Marketing page both open it.
export default async function NewCampaignPage() {
  await requireWorkspaceContext();
  return <CampaignBuilder audienceSizes={await getAudienceSizes()} />;
}
