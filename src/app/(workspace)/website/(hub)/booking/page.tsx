import type { Metadata } from "next";
import { BookingSetup } from "@/components/website/BookingSetup";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Website booking" };

export default async function WebsiteBookingPage() {
  await requireWorkspaceContext();
  return <BookingSetup />;
}
