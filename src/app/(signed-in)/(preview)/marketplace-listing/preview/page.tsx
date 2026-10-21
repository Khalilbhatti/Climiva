import type { Metadata } from "next";
import { PublicListing } from "@/components/marketplace/PublicListing";
import { requireWorkspaceContext } from "@/server/workspace";

// The saved listing as the directory would show it, for someone signed in to the business. In the (preview) group on purpose: the
// workspace's providers but no sidebar and no workspace header. The page a visitor opens is /listings/<address>.
export const metadata: Metadata = { title: "Marketplace Listing preview", robots: { index: false } };

export default async function MarketplacePreviewPage() {
  await requireWorkspaceContext();
  return <PublicListing />;
}
