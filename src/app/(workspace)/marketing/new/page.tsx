import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/marketing/CampaignBuilder";

export const metadata: Metadata = { title: "Create campaign" };

// The one campaign editor. The Overview "Create campaign" quick action and the Marketing page both open it.
export default function NewCampaignPage() {
  return <CampaignBuilder />;
}
