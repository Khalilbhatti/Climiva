import type { Metadata } from "next";
import { BusinessHoursForm } from "@/components/settings/BusinessHoursForm";

export const metadata: Metadata = { title: "Business hours · Settings" };

export default function BusinessHoursPage() {
  return <BusinessHoursForm />;
}
