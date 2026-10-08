import type { Metadata } from "next";
import { QuoteDetail } from "@/components/financials/QuoteDetail";
import { QUOTES } from "@/data/financials";

export function generateStaticParams() {
  return QUOTES.map((quote) => ({ quoteId: quote.id }));
}

export async function generateMetadata({ params }: PageProps<"/quotes-invoices/quotes/[quoteId]">): Promise<Metadata> {
  const { quoteId } = await params;
  return { title: `Quote #${quoteId}` };
}

export default async function QuotePage({ params }: PageProps<"/quotes-invoices/quotes/[quoteId]">) {
  const { quoteId } = await params;
  return <QuoteDetail quoteId={quoteId} />;
}
