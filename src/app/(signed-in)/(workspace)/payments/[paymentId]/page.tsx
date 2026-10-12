import type { Metadata } from "next";
import { PaymentDetail } from "@/components/financials/PaymentDetail";
import { getPaymentById } from "@/data/financials";
import { getCoreSnapshot } from "@/server/core-data";
import { requireWorkspaceContext } from "@/server/workspace";

// A payment belongs to one business. The title names a payment only when it exists in the ACTIVE business; another business's
// number and a number that never existed both read as an unknown payment.
export async function generateMetadata({ params }: PageProps<"/payments/[paymentId]">): Promise<Metadata> {
  const { paymentId } = await params;
  const core = await getCoreSnapshot();
  return { title: core && getPaymentById(paymentId, core.financials) ? `Payment #${paymentId}` : "Payment" };
}

export default async function PaymentPage({ params }: PageProps<"/payments/[paymentId]">) {
  await requireWorkspaceContext();
  const { paymentId } = await params;
  return <PaymentDetail paymentId={paymentId} />;
}
