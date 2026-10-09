import type { Metadata } from "next";
import { QuoteDetail } from "@/components/financials/QuoteDetail";
import { getQuoteById } from "@/data/financials";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// A quote belongs to one business; see the payment page.
export async function generateMetadata({ params }: PageProps<"/quotes-invoices/quotes/[quoteId]">): Promise<Metadata> {
  const { quoteId } = await params;
  const core = await getCoreSnapshot();
  return { title: core && getQuoteById(quoteId, core.financials) ? `Quote #${quoteId}` : "Quote" };
}

export default async function QuotePage({ params }: PageProps<"/quotes-invoices/quotes/[quoteId]">) {
  await requireWorkspaceContext();
  const { quoteId } = await params;
  return <QuoteDetail quoteId={quoteId} />;
}
