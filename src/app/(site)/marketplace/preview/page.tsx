import type { Metadata } from "next";
import { PublicListing } from "@/components/marketplace/PublicListing";

// The public directory page. It lives outside the (workspace) group on purpose: no sidebar and no workspace header.
export const metadata: Metadata = { title: "Marketplace listing preview", robots: { index: false } };

export default function MarketplacePreviewPage() {
  return <PublicListing />;
}
