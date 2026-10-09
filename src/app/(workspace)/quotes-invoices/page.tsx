import type { Metadata } from "next";
import { Suspense } from "react";
import { QuotesInvoicesView } from "@/components/financials/QuotesInvoicesView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Quotes & Invoices" };

export default async function QuotesInvoicesPage() {
  const gate = await fixtureGate("Quotes & Invoices");
  if (gate) return gate;
  // QuotesInvoicesView keeps its tab in the URL (?tab=invoices), which needs a Suspense boundary.
  return (
    <Suspense>
      <QuotesInvoicesView />
    </Suspense>
  );
}
