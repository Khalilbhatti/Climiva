import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsView } from "@/components/jobs/JobsView";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  // JobsView keeps its tab and the ?state=empty preview in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <JobsView />
    </Suspense>
  );
}
