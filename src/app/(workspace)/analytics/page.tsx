import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { getAnalytics } from "@/server/reporting";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Analytics" };

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : (value?.[0] ?? null));

/**
 * The report is worked out here, on the server, for the active business and the date range in the URL (the range parameters are
 * parsed against the approved presets and the custom bounds; anything else is this month). The tab lives in the URL too and is
 * read by the screen. Nothing about the business comes from the URL: the workspace is resolved from the session and a verified
 * membership, so an anonymous visitor is redirected and no business's figures are ever read for another.
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  await requireWorkspaceContext();
  const params = await searchParams;
  const report = await getAnalytics(first(params.range), first(params.from), first(params.to));
  // The tab lives in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <AnalyticsView report={report} />
    </Suspense>
  );
}
