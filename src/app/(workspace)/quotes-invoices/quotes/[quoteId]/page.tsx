import type { Metadata } from "next";
import { QuoteDetail } from "@/components/financials/QuoteDetail";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

export async function generateMetadata({ params }: PageProps<"/quotes-invoices/quotes/[quoteId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { quoteId } = await params;
  return { title: `Quote #${quoteId}` };
}

export default async function QuotePage({ params }: PageProps<"/quotes-invoices/quotes/[quoteId]">) {
  const gate = await fixtureGate("Quotes & Invoices");
  if (gate) return gate;
  const { quoteId } = await params;
  return <QuoteDetail quoteId={quoteId} />;
}
