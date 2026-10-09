import { MemberOverview } from "@/components/team/MemberOverview";
import { fixtureGate } from "@/server/fixture-gate";

export default async function MemberOverviewPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  return <MemberOverview />;
}
