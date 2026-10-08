import type { Metadata } from "next";
import { JobWorkspace } from "@/components/jobs/JobWorkspace";
import { JOBS, getJobById } from "@/data/operations";

// The fixture jobs are prerendered. Any other id (a job created during a demo session) is rendered on
// demand and resolved against the in-memory data on the client.
export function generateStaticParams() {
  return JOBS.map((job) => ({ jobId: job.id }));
}

export async function generateMetadata({ params }: LayoutProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  return { title: getJobById(jobId) ? `Job #${jobId}` : "Job" };
}

export default async function JobLayout({ children, params }: LayoutProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  return <JobWorkspace jobId={jobId}>{children}</JobWorkspace>;
}
