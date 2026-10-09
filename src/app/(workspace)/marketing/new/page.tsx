import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/marketing/CampaignBuilder";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Create campaign" };

// The one campaign editor. The Overview "Create campaign" quick action and the Marketing page both open it.
export default async function NewCampaignPage() {
  const gate = await fixtureGate("Marketing");
  if (gate) return gate;
  return <CampaignBuilder />;
}
