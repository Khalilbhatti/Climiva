import { MemberServices } from "@/components/team/MemberServices";
import { fixtureGate } from "@/server/fixture-gate";

export default async function MemberServicesPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  return <MemberServices />;
}
