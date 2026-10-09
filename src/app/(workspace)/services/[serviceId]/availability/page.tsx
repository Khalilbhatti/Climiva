import { AvailabilityTab } from "@/components/services/ServiceTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function ServiceAvailabilityPage() {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  return <AvailabilityTab />;
}
