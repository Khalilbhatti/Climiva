import type { Metadata } from "next";
import { InvoiceDetail } from "@/components/financials/InvoiceDetail";
import { INVOICES } from "@/data/financials";

// The fixture invoices are prerendered. An invoice created during a demo session (INV-1052…) is rendered on
// demand and resolved against the in-memory financial data on the client.
export function generateStaticParams() {
  return INVOICES.map((invoice) => ({ invoiceId: invoice.id }));
}

export async function generateMetadata({ params }: PageProps<"/quotes-invoices/invoices/[invoiceId]">): Promise<Metadata> {
  const { invoiceId } = await params;
  return { title: `Invoice #${invoiceId}` };
}

export default async function InvoicePage({ params }: PageProps<"/quotes-invoices/invoices/[invoiceId]">) {
  const { invoiceId } = await params;
  return <InvoiceDetail invoiceId={invoiceId} />;
}
