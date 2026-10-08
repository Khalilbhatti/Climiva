import type { Metadata } from "next";
import { BookingSetup } from "@/components/website/BookingSetup";

export const metadata: Metadata = { title: "Website booking" };

export default function WebsiteBookingPage() {
  return <BookingSetup />;
}
