import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListingEditor } from "@/components/marketplace/ListingEditor";
import { can } from "@/lib/policy";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Edit Marketplace listing" };

export default async function EditMarketplaceListingPage() {
  const { role } = await requireWorkspaceContext();
  // Members read the listing; changing it is for owners and admins (the server checks again on every save).
  if (!can(role, "marketplace:manage")) redirect("/marketplace");
  // ?setup=1 opens the first-time setup, which reads the URL and so needs a Suspense boundary.
  return (
    <Suspense>
      <ListingEditor />
    </Suspense>
  );
}
