import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketplaceOverview } from "@/components/marketplace/MarketplaceOverview";

export const metadata: Metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  // ?state=empty previews the first-time state, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <MarketplaceOverview />
    </Suspense>
  );
}
