import type { Metadata } from "next";
import { RolesList } from "@/components/team/RolesList";
import { requireWorkspaceContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requireWorkspaceContext();
  return <RolesList />;
}
