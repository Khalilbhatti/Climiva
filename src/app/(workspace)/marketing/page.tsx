import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingView } from "@/components/marketing/MarketingView";

export const metadata: Metadata = { title: "Marketing" };

export default function MarketingPage() {
  // The tab and the empty-state preview live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <MarketingView />
    </Suspense>
  );
}
