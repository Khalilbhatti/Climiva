import type { Metadata } from "next";
import { Suspense } from "react";
import { MaintenancePlansView } from "@/components/maintenance-plans/MaintenancePlansView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Maintenance Plans" };

export default async function MaintenancePlansPage() {
  const gate = await fixtureGate("Maintenance Plans");
  if (gate) return gate;
  // The view tab and the Create plan flow live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <MaintenancePlansView />
    </Suspense>
  );
}
