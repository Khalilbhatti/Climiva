import { MemberPermissions } from "@/components/team/MemberPermissions";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function MemberPermissionsPage() {
  await requireWorkspaceContext();
  return <MemberPermissions />;
}
