import type { Metadata } from "next";
import { InvoiceDetail } from "@/components/financials/InvoiceDetail";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The fixture invoices are prerendered. An invoice created during a demo session (INV-1052…) is rendered on
// demand and resolved against the in-memory financial data on the client.
export async function generateMetadata({ params }: PageProps<"/quotes-invoices/invoices/[invoiceId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { invoiceId } = await params;
  return { title: `Invoice #${invoiceId}` };
}

export default async function InvoicePage({ params }: PageProps<"/quotes-invoices/invoices/[invoiceId]">) {
  const gate = await fixtureGate("Quotes & Invoices");
  if (gate) return gate;
  const { invoiceId } = await params;
  return <InvoiceDetail invoiceId={invoiceId} />;
}
