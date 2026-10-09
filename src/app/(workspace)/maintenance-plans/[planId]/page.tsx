import type { Metadata } from "next";
import { PlanDetail } from "@/components/maintenance-plans/PlanDetail";
import { getPlanById } from "@/data/maintenance-plans";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The fixture plans are prerendered. A plan created during a demo session is rendered on demand and resolved
// against the in-memory data on the client.
export async function generateMetadata({ params }: PageProps<"/maintenance-plans/[planId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { planId } = await params;
  return { title: getPlanById(planId)?.name ?? "Maintenance plan" };
}

export default async function PlanPage({ params }: PageProps<"/maintenance-plans/[planId]">) {
  const gate = await fixtureGate("Maintenance Plans");
  if (gate) return gate;
  const { planId } = await params;
  return <PlanDetail planId={planId} />;
}
