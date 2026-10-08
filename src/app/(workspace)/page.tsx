import type { Metadata } from "next";
import { BusinessInfoCard } from "@/components/overview/BusinessInfoCard";
import { OverviewHeader } from "@/components/overview/OverviewHeader";
import { OverviewKpis } from "@/components/overview/OverviewKpis";
import { WorkflowActions } from "@/components/overview/WorkflowActions";

export const metadata: Metadata = { title: "Workspace Overview" };

export default function OverviewPage() {
  return (
    <>
      <OverviewHeader />

      <OverviewKpis />

      <WorkflowActions />
      <BusinessInfoCard />
    </>
  );
}
