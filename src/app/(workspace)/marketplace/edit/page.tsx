import type { Metadata } from "next";
import { Suspense } from "react";
import { ListingEditor } from "@/components/marketplace/ListingEditor";

export const metadata: Metadata = { title: "Edit Marketplace listing" };

export default function EditMarketplaceListingPage() {
  // ?setup=1 opens the first-time setup, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <ListingEditor />
    </Suspense>
  );
}
