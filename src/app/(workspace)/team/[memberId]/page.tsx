import { MemberOverview } from "@/components/team/MemberOverview";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function MemberOverviewPage() {
  await requireWorkspaceContext();
  return <MemberOverview />;
}
