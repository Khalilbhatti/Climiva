import { CustomerIntakeTab } from "@/components/services/ServiceTabs";
import { fixtureGate } from "@/server/fixture-gate";

export default async function ServiceCustomerIntakePage() {
  const gate = await fixtureGate("Services");
  if (gate) return gate;
  return <CustomerIntakeTab />;
}
