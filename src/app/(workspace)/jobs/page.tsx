import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsView } from "@/components/jobs/JobsView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
  const gate = await fixtureGate("Jobs");
  if (gate) return gate;
  // JobsView keeps its tab and the ?state=empty preview in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <JobsView />
    </Suspense>
  );
}
