import type { Metadata } from "next";
import { PublicListing } from "@/components/marketplace/PublicListing";
import { requireWorkspaceContext } from "@/server/workspace";

// The saved listing as the directory would show it, for someone signed in to the business. Outside the (workspace) group on purpose: no
// sidebar and no workspace header. The page a visitor opens is /listings/<address>.
export const metadata: Metadata = { title: "Marketplace listing preview", robots: { index: false } };

export default async function MarketplacePreviewPage() {
  await requireWorkspaceContext();
  return <PublicListing />;
}
