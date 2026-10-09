import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingsView } from "@/components/bookings/BookingsView";
import { fixtureGate } from "@/server/fixture-gate";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage() {
  const gate = await fixtureGate("Bookings");
  if (gate) return gate;
  // BookingsView keeps its tab, selected booking and create flow in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <BookingsView />
    </Suspense>
  );
}
