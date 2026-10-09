import type { Metadata } from "next";
import { CampaignDetail } from "@/components/marketing/CampaignDetail";
import { fixtureGate } from "@/server/fixture-gate";

// The sample campaigns are prerendered. Any other id (a campaign made during a demo session) is resolved on the client.
export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/marketing/[campaignId]">) {
  const gate = await fixtureGate("Marketing");
  if (gate) return gate;
  const { campaignId } = await params;
  return <CampaignDetail campaignId={campaignId} />;
}
