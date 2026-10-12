import type { Metadata } from "next";
import { ProfileForm } from "@/components/settings/ProfileForm";

export const metadata: Metadata = { title: "My profile · Settings" };

export default function ProfilePage() {
  return <ProfileForm />;
}
