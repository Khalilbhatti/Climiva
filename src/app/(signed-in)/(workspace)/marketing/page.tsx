import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingView } from "@/components/marketing/MarketingView";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Marketing" };

export default async function MarketingPage() {
  await requireWorkspaceContext();
  // The tab and the empty-state preview live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <MarketingView />
    </Suspense>
  );
}
