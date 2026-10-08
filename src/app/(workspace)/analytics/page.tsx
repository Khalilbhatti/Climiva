import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  // The tab and the date range live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <AnalyticsView />
    </Suspense>
  );
}
