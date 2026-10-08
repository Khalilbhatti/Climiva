import type { Metadata } from "next";
import { BrandingForm } from "@/components/settings/BrandingForm";

export const metadata: Metadata = { title: "Branding · Settings" };

export default function BrandingPage() {
  return <BrandingForm />;
}
