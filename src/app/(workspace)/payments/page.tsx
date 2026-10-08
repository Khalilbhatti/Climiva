import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsView } from "@/components/financials/PaymentsView";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  // PaymentsView keeps its tab and the Record payment flow in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <PaymentsView />
    </Suspense>
  );
}
