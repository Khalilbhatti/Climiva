import type { Metadata } from "next";
import { BusinessInformationForm } from "@/components/settings/BusinessInformationForm";

export const metadata: Metadata = { title: "Business information · Settings" };

export default function SettingsPage() {
  return <BusinessInformationForm />;
}
