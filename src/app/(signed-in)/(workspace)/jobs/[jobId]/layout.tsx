import type { Metadata } from "next";
import { JobWorkspace } from "@/components/jobs/JobWorkspace";
import { getJobById } from "@/data/operations";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// A job belongs to one business. The title names a job only when it exists in the ACTIVE business; another business's job
// number and a number that never existed both read as an unknown job.
export async function generateMetadata({ params }: LayoutProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const core = await getCoreSnapshot();
  return { title: core && getJobById(jobId, core.operations) ? `Job #${jobId}` : "Job" };
}

export default async function JobLayout({ children, params }: LayoutProps<"/jobs/[jobId]">) {
  await requireWorkspaceContext();
  const { jobId } = await params;
  return <JobWorkspace jobId={jobId}>{children}</JobWorkspace>;
}
