import { MemberServices } from "@/components/team/MemberServices";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function MemberServicesPage() {
  await requireWorkspaceContext();
  return <MemberServices />;
}
