import { MemberPermissions } from "@/components/team/MemberPermissions";
import { fixtureGate } from "@/server/fixture-gate";

export default async function MemberPermissionsPage() {
  const gate = await fixtureGate("Team");
  if (gate) return gate;
  return <MemberPermissions />;
}
