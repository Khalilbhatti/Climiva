import type { Metadata } from "next";
import { RolesList } from "@/components/team/RolesList";

export const metadata: Metadata = { title: "Roles & permissions" };

export default function RolesPage() {
  return <RolesList />;
}
