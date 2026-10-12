import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsView } from "@/components/financials/PaymentsView";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  await requireWorkspaceContext();
  // PaymentsView keeps its tab and the Record payment flow in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <PaymentsView />
    </Suspense>
  );
}
