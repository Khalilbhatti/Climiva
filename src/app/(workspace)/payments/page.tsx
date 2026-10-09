import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsView } from "@/components/financials/PaymentsView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const gate = await fixtureGate("Payments");
  if (gate) return gate;
  // PaymentsView keeps its tab and the Record payment flow in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <PaymentsView />
    </Suspense>
  );
}
