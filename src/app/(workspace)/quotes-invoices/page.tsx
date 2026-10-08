import type { Metadata } from "next";
import { Suspense } from "react";
import { QuotesInvoicesView } from "@/components/financials/QuotesInvoicesView";

export const metadata: Metadata = { title: "Quotes & Invoices" };

export default function QuotesInvoicesPage() {
  // QuotesInvoicesView keeps its tab in the URL (?tab=invoices), which needs a Suspense boundary.
  return (
    <Suspense>
      <QuotesInvoicesView />
    </Suspense>
  );
}
