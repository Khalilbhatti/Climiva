import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingsView } from "@/components/bookings/BookingsView";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage() {
  await requireWorkspaceContext();
  // BookingsView keeps its tab, selected booking and create flow in the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <BookingsView />
    </Suspense>
  );
}
