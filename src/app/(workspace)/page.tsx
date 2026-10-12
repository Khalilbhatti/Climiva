import type { Metadata } from "next";
import { BusinessInfoCard } from "@/components/overview/BusinessInfoCard";
import { NewWorkspaceOverview } from "@/components/overview/NewWorkspaceOverview";
import { OverviewHeader } from "@/components/overview/OverviewHeader";
import { OverviewKpis } from "@/components/overview/OverviewKpis";
import { WorkflowActions } from "@/components/overview/WorkflowActions";
import { getMonthTotals } from "@/server/reporting";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Workspace Overview" };

export default async function OverviewPage() {
  const { snapshot } = await requireWorkspaceContext();
  // The totals and quick actions are the sample business's. Any other workspace has no such records yet.
  if (!snapshot.hasSampleData) return <NewWorkspaceOverview business={snapshot.organization.name} />;

  return (
    <>
      <OverviewHeader />

      <OverviewKpis month={await getMonthTotals()} />

      <WorkflowActions />
      <BusinessInfoCard />
    </>
  );
}
