import type { Metadata } from "next";
import { PaymentDetail } from "@/components/financials/PaymentDetail";
import { PAYMENTS } from "@/data/financials";

// The fixture payments are prerendered. A payment recorded during a demo session (PAY-1009…) is rendered on
// demand and resolved against the in-memory financial data on the client.
export function generateStaticParams() {
  return PAYMENTS.map((payment) => ({ paymentId: payment.id }));
}

export async function generateMetadata({ params }: PageProps<"/payments/[paymentId]">): Promise<Metadata> {
  const { paymentId } = await params;
  return { title: `Payment #${paymentId}` };
}

export default async function PaymentPage({ params }: PageProps<"/payments/[paymentId]">) {
  const { paymentId } = await params;
  return <PaymentDetail paymentId={paymentId} />;
}
