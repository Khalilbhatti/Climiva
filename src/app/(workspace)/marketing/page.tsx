import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingView } from "@/components/marketing/MarketingView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Marketing" };

export default async function MarketingPage() {
  const gate = await fixtureGate("Marketing");
  if (gate) return gate;
  // The tab and the empty-state preview live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <MarketingView />
    </Suspense>
  );
}
