import { MemberActivity } from "@/components/team/MemberActivity";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function MemberActivityPage() {
  await requireWorkspaceContext();
  return <MemberActivity />;
}
