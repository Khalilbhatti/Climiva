import { JobWorkDetailsTab } from "@/components/jobs/JobTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function JobWorkDetailsPage() {
  await requireWorkspaceContext();
  return <JobWorkDetailsTab />;
}
