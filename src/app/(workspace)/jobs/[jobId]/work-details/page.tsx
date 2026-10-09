import { JobWorkDetailsTab } from "@/components/jobs/JobTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function JobWorkDetailsPage() {
  const gate = await fixtureGate("Jobs");
  if (gate) return gate;
  return <JobWorkDetailsTab />;
}
