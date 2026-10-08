import type { Metadata } from "next";
import { PlanDetail } from "@/components/maintenance-plans/PlanDetail";
import { PLANS, getPlanById } from "@/data/maintenance-plans";

// The fixture plans are prerendered. A plan created during a demo session is rendered on demand and resolved
// against the in-memory data on the client.
export function generateStaticParams() {
  return PLANS.map((plan) => ({ planId: plan.id }));
}

export async function generateMetadata({ params }: PageProps<"/maintenance-plans/[planId]">): Promise<Metadata> {
  const { planId } = await params;
  return { title: getPlanById(planId)?.name ?? "Maintenance plan" };
}

export default async function PlanPage({ params }: PageProps<"/maintenance-plans/[planId]">) {
  const { planId } = await params;
  return <PlanDetail planId={planId} />;
}
