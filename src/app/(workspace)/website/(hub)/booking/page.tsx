import type { Metadata } from "next";
import { BookingSetup } from "@/components/website/BookingSetup";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Website booking" };

export default async function WebsiteBookingPage() {
  const gate = await fixtureGate("Website");
  if (gate) return gate;
  return <BookingSetup />;
}
