import { JobFilesTab } from "@/components/jobs/JobTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function JobFilesPage() {
  const gate = await fixtureGate("Jobs");
  if (gate) return gate;
  return <JobFilesTab />;
}
