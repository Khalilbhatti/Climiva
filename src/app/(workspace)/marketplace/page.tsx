import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketplaceOverview } from "@/components/marketplace/MarketplaceOverview";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Marketplace" };

export default async function MarketplacePage() {
  const gate = await fixtureGate("Marketplace");
  if (gate) return gate;
  // ?state=empty previews the first-time state, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <MarketplaceOverview />
    </Suspense>
  );
}
