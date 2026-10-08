import type { Metadata } from "next";
import { PreferencesForm } from "@/components/settings/PreferencesForm";

export const metadata: Metadata = { title: "Workspace preferences · Settings" };

export default function PreferencesPage() {
  return <PreferencesForm />;
}
