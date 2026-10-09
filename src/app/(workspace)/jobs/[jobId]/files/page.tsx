import { JobFilesTab } from "@/components/jobs/JobTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function JobFilesPage() {
  await requireWorkspaceContext();
  return <JobFilesTab />;
}
