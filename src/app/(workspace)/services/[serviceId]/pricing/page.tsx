import { PricingTab } from "@/components/services/ServiceTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function ServicePricingPage() {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  return <PricingTab />;
}
