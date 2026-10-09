import type { Metadata } from "next";
import { PaymentDetail } from "@/components/financials/PaymentDetail";
import { fixtureGate, hasSampleDataAccess } from "@/server/fixture-gate";

// The fixture payments are prerendered. A payment recorded during a demo session (PAY-1009…) is rendered on
// demand and resolved against the in-memory financial data on the client.
export async function generateMetadata({ params }: PageProps<"/payments/[paymentId]">): Promise<Metadata> {
  if (!(await hasSampleDataAccess())) return { title: "Not available" };
  const { paymentId } = await params;
  return { title: `Payment #${paymentId}` };
}

export default async function PaymentPage({ params }: PageProps<"/payments/[paymentId]">) {
  const gate = await fixtureGate("Payments");
  if (gate) return gate;
  const { paymentId } = await params;
  return <PaymentDetail paymentId={paymentId} />;
}
