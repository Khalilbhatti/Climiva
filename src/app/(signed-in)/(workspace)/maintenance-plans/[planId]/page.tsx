import type { Metadata } from "next";
import { PlanDetail } from "@/components/maintenance-plans/PlanDetail";
import { getPlanById } from "@/data/maintenance-plans";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// A plan belongs to one business. The title names a plan only when it exists in the ACTIVE business; another business's plan and a
// plan that never existed both read as an unknown plan.
export async function generateMetadata({ params }: PageProps<"/maintenance-plans/[planId]">): Promise<Metadata> {
  const { planId } = await params;
  const core = await getCoreSnapshot();
  return { title: (core && getPlanById(planId, core.maintenance)?.name) || "Maintenance plan" };
}

export default async function PlanPage({ params }: PageProps<"/maintenance-plans/[planId]">) {
  await requireWorkspaceContext();
  const { planId } = await params;
  return <PlanDetail planId={planId} />;
}
