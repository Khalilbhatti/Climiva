import { MemberAvailability } from "@/components/team/MemberAvailability";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function MemberAvailabilityPage() {
  await requireWorkspaceContext();
  return <MemberAvailability />;
}
