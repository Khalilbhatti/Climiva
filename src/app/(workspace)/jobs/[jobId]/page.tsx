import { JobOverviewTab } from "@/components/jobs/JobTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function JobOverviewPage() {
  await requireWorkspaceContext();
  return <JobOverviewTab />;
}
