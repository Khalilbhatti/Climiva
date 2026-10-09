import type { Metadata } from "next";
import { JobWorkspace } from "@/components/jobs/JobWorkspace";
import { getJobById } from "@/data/operations";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The fixture jobs are prerendered. Any other id (a job created during a demo session) is rendered on
// demand and resolved against the in-memory data on the client.
export async function generateMetadata({ params }: LayoutProps<"/jobs/[jobId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { jobId } = await params;
  return { title: getJobById(jobId) ? `Job #${jobId}` : "Job" };
}

export default async function JobLayout({ children, params }: LayoutProps<"/jobs/[jobId]">) {
  const gate = await fixtureGate("Jobs");
  if (gate) return gate;
  const { jobId } = await params;
  return <JobWorkspace jobId={jobId}>{children}</JobWorkspace>;
}
