import { OverviewTab } from "@/components/services/ServiceTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function ServiceOverviewPage() {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  return <OverviewTab />;
}
