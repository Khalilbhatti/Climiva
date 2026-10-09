import type { Metadata } from "next";
import { PublicListing } from "@/components/marketplace/PublicListing";
import { publicGate } from "@/server/fixture-gate";

// The public directory page. It lives outside the (workspace) group on purpose: no sidebar and no workspace header.
export const metadata: Metadata = { title: "Marketplace listing preview", robots: { index: false } };

export default async function MarketplacePreviewPage() {
  const gate = await publicGate();
  if (gate) return gate;
  return <PublicListing />;
}
