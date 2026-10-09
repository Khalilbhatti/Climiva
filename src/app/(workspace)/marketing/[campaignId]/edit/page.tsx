import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/marketing/CampaignBuilder";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({ params }: PageProps<"/marketing/[campaignId]/edit">) {
  const gate = await fixtureGate("Marketing");
  if (gate) return gate;
  const { campaignId } = await params;
  return <CampaignBuilder campaignId={campaignId} />;
}
