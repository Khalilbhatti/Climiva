import { MemberAvailability } from "@/components/team/MemberAvailability";
import { fixtureGate } from "@/server/fixture-gate";

export default async function MemberAvailabilityPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  return <MemberAvailability />;
}
