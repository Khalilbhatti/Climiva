import type { Metadata } from "next";
import { InvoiceDetail } from "@/components/financials/InvoiceDetail";
import { getInvoiceById } from "@/data/financials";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// An invoice belongs to one business; see the payment page.
export async function generateMetadata({ params }: PageProps<"/quotes-invoices/invoices/[invoiceId]">): Promise<Metadata> {
  const { invoiceId } = await params;
  const core = await getCoreSnapshot();
  return { title: core && getInvoiceById(invoiceId, core.financials) ? `Invoice #${invoiceId}` : "Invoice" };
}

export default async function InvoicePage({ params }: PageProps<"/quotes-invoices/invoices/[invoiceId]">) {
  await requireWorkspaceContext();
  const { invoiceId } = await params;
  return <InvoiceDetail invoiceId={invoiceId} />;
}
