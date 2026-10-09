import { MemberActivity } from "@/components/team/MemberActivity";
import { fixtureGate } from "@/server/fixture-gate";

export default async function MemberActivityPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  return <MemberActivity />;
}
