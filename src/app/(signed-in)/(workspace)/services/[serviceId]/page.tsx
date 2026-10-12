import { OverviewTab } from "@/components/services/ServiceTabs";
import { requireWorkspaceContext } from "@/server/workspace";

export default async function ServiceOverviewPage() {
  await requireWorkspaceContext();
  return <OverviewTab />;
}
