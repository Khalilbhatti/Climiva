import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const gate = await fixtureGate("Analytics");
  if (gate) return gate;
  // The tab and the date range live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <AnalyticsView />
    </Suspense>
  );
}
