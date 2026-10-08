import type { Metadata } from "next";
import { Suspense } from "react";
import { MaintenancePlansView } from "@/components/maintenance-plans/MaintenancePlansView";

export const metadata: Metadata = { title: "Maintenance Plans" };

export default function MaintenancePlansPage() {
  // The view tab and the Create plan flow live in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <MaintenancePlansView />
    </Suspense>
  );
}
