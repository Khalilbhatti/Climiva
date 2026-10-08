import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingsView } from "@/components/bookings/BookingsView";

export const metadata: Metadata = { title: "Bookings" };

export default function BookingsPage() {
  // BookingsView keeps its tab, selected booking and create flow in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <BookingsView />
    </Suspense>
  );
}
