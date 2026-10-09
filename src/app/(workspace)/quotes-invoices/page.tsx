import type { Metadata } from "next";
import { Suspense } from "react";
import { QuotesInvoicesView } from "@/components/financials/QuotesInvoicesView";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Quotes & Invoices" };

export default async function QuotesInvoicesPage() {
  await requireWorkspaceContext();
  // QuotesInvoicesView keeps its tab in the URL (?tab=invoices), which needs a Suspense boundary.
  return (
    <Suspense>
      <QuotesInvoicesView />
    </Suspense>
  );
}
