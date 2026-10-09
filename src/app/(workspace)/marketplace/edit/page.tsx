import type { Metadata } from "next";
import { Suspense } from "react";
import { ListingEditor } from "@/components/marketplace/ListingEditor";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Edit Marketplace listing" };

export default async function EditMarketplaceListingPage() {
  const gate = await fixtureGate("Marketplace");
  if (gate) return gate;
  // ?setup=1 opens the first-time setup, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <ListingEditor />
    </Suspense>
  );
}
