import { JobOverviewTab } from "@/components/jobs/JobTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function JobOverviewPage() {
  const gate = await fixtureGate("Jobs");
  if (gate) return gate;
  return <JobOverviewTab />;
}
